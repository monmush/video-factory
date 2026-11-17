import { withoutCues } from "./cues";
import type { Script, ScriptLine } from "./ipc";
import { levelMediaUsd, type MediaLevel, mediaLevel } from "./media-level";
import { videoModel, videoUsd } from "./video-models";

/**
 * The scripts as the operator sees them: pinned first, each group in board
 * order, deleted ones left out. Numbers in chat (#3) refer to this order.
 */
export function boardOrder(scripts: Script[]): Script[] {
  const live = scripts.filter((s) => !s.deletedAt);
  return [...live.filter((s) => s.pinned), ...live.filter((s) => !s.pinned)];
}

// Length and cost estimates, shared by the writer (to aim for a length) and
// the board (to show it). Rough on purpose; recalibrate once a complete video
// exists (docs/FEASIBILITY_TRIAL.md).

/** Videos are about this long unless the request says otherwise. */
export const DEFAULT_TARGET_SEC = 45;
/** Vietnamese syllables per second, from one approved dialogue sample. */
export const SPEECH_RATE = 3.7;
/** Breath between lines. */
const LINE_GAP_SEC = 0.3;
/**
 * Most silence the director may add after lines so they land (holds,
 * docs/DIRECTING_RULES.md, C15), the last shot's included.
 */
export const MAX_HOLDS_SEC = 4;
/**
 * Silent beats in a video's length and price before its plan exists: the
 * holds at their cap, so the price shown before the plan is never below what
 * the plan can add. Holds on speaking shots are billed like speech; holds on
 * wide and detail shots are free, so this errs slightly high.
 */
const SILENT_SEC = MAX_HOLDS_SEC;

/** Vietnamese syllables are written as separate words; sounds like "[cười]" are not words. */
export const syllables = (lines: Pick<ScriptLine, "text">[]) =>
  lines.reduce(
    (n, line) =>
      n +
      withoutCues(line.text)
        .split(/\s+/)
        .filter((w) => /\p{L}/u.test(w)).length,
    0,
  );

export function estimateSeconds(lines: Pick<ScriptLine, "text">[]): number {
  if (lines.length === 0) return 0;
  return syllables(lines) / SPEECH_RATE + lines.length * LINE_GAP_SEC + SILENT_SEC;
}

/** Spoken syllables that fill a video of `seconds`, assuming about ten lines. */
export function syllableBudget(seconds: number): number {
  return Math.max(20, Math.round((seconds - SILENT_SEC - 10 * LINE_GAP_SEC) * SPEECH_RATE));
}

/**
 * Generated speech, per spoken character: about $0.08 per 1,000 characters for
 * the current voice model. Rough, like the video rate; replace once measured.
 */
export const VOICE_USD_PER_CHAR = 0.08 / 1000;

/**
 * One generated start frame (a 9:16 still of a character in the series'
 * environment), at the image model's fallback rate. Only series with an
 * environment need them; otherwise the character's cover photo is used.
 */
export const FRAME_USD = 0.12;

/** Characters with at least one line: each needs its own start frame. */
export const speakingCharacters = (lines: Partial<Pick<ScriptLine, "characterId">>[]) => [
  ...new Set(lines.flatMap((l) => l.characterId ?? [])),
];

/** One line alone, as its own clip. */
const lineSeconds = (line: Pick<ScriptLine, "text">) =>
  syllables([line]) / SPEECH_RATE + LINE_GAP_SEC;

/** What a video's price depends on besides its lines. */
export interface EstimateOpts {
  /** The series has a place with photos: each speaking character needs a still. */
  frames?: boolean;
  /** Speaking-shot model id; the default when absent or unknown (src/shared/video-models.ts). */
  model?: string | null;
  /** Output size ("720p" | "1080p"); some models cost more at 1080p. */
  resolution?: string | null;
  /**
   * Product cut-outs this script's products still need (once per photo,
   * ever; `cutoutUsd` in src/shared/product-shot.ts). Only with a place.
   */
  cutoutUsd?: number;
  /**
   * The Media level. With a place the video is staged, so before its plan it
   * is priced at the level's rates for a typical video (levelMediaUsd).
   */
  level?: string | null;
}

/** The picture of a video from these lines. Excludes voice, images and retries. */
export const estimateVideoUsd = (
  lines: Pick<ScriptLine, "text">[],
  model?: string | null,
  resolution?: string | null,
) =>
  lines.length
    ? videoUsd(videoModel(model), estimateSeconds(lines), lines.map(lineSeconds), resolution)
    : 0;

/** Characters the voice model reads aloud (the dialogue, nothing else). */
export const spokenChars = (lines: Pick<ScriptLine, "text">[]) =>
  lines.reduce((n, line) => n + line.text.trim().length, 0);

export const estimateVoiceUsd = (lines: Pick<ScriptLine, "text">[]) =>
  spokenChars(lines) * VOICE_USD_PER_CHAR;

/**
 * Everything one video from this script costs: video (at the series' model),
 * voice and, when the series has an environment, one start frame per
 * speaking character. Excludes redos, which are their own click.
 */
export const estimateUsd = (
  lines: (Pick<ScriptLine, "text"> & Partial<Pick<ScriptLine, "characterId">>)[],
  opts: EstimateOpts = {},
) =>
  opts.level && opts.frames
    ? estimateVoiceUsd(lines) +
      levelMediaUsd(mediaLevel(opts.level), estimateSeconds(lines)) +
      (opts.cutoutUsd ?? 0)
    : estimateVideoUsd(lines, opts.model, opts.resolution) +
      estimateVoiceUsd(lines) +
      (opts.frames ? speakingCharacters(lines).length * FRAME_USD + (opts.cutoutUsd ?? 0) : 0);

/**
 * A typical script of about 45 seconds: ten lines of fourteen syllables, two
 * speakers taking turns. Prices a video before there are scripts to price.
 */
export const TYPICAL_LINES: (Pick<ScriptLine, "text"> & Pick<ScriptLine, "characterId">)[] =
  Array.from({ length: 10 }, (_, i) => ({
    characterId: i % 2 ? "b" : "a",
    text: Array(14).fill("trà").join(" "),
  }));

/**
 * All-in price of a typical video of `seconds` at this level: pictures,
 * speaking scenes and motion at the recipe's rates (levelMediaUsd), plus the
 * voice of a typical script of that length. The "Chất lượng" menu's price,
 * and the guide budget a plan's cost table is held against.
 */
export function levelEstimateUsd(level: MediaLevel, seconds = DEFAULT_TARGET_SEC): number {
  const voicePerSec = estimateVoiceUsd(TYPICAL_LINES) / estimateSeconds(TYPICAL_LINES);
  return levelMediaUsd(level, seconds) + voicePerSec * Math.max(1, seconds);
}

/**
 * All-in price of one video for a model choice, the same estimate as the
 * make buttons, with the length it is for: the average of `scripts` when
 * there are any, else a typical 45-second video.
 */
export function perVideo(
  scripts: { lines: (Pick<ScriptLine, "text"> & Partial<Pick<ScriptLine, "characterId">>)[] }[],
  opts: EstimateOpts,
): { usd: number; seconds: number } {
  const list = scripts.length ? scripts.map((s) => s.lines) : [TYPICAL_LINES];
  const mean = (f: (lines: (typeof list)[number]) => number) =>
    list.reduce((n, lines) => n + f(lines), 0) / list.length;
  return { usd: mean((lines) => estimateUsd(lines, opts)), seconds: mean(estimateSeconds) };
}

/** "42 giây", "1 phút 5 giây". */
export function formatSeconds(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} giây`;
  return s % 60 ? `${Math.floor(s / 60)} phút ${s % 60} giây` : `${s / 60} phút`;
}

/** "43s", for tight rows. */
export const formatSecondsShort = (seconds: number) => `${Math.round(seconds)}s`;
