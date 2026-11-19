import { withoutCues } from "./cues";
import type { Script, ScriptLine } from "./ipc";
import { levelMediaUsd, type MediaLevel, mediaLevel } from "./media-level";
import { videoModel, videoUsd } from "./video-models";

export function boardOrder(scripts: Script[]): Script[] {
  const live = scripts.filter((s) => !s.deletedAt);
  return [...live.filter((s) => s.pinned), ...live.filter((s) => !s.pinned)];
}

export const DEFAULT_TARGET_SEC = 45;
export const SPEECH_RATE = 3.7;
const BREATH_BETWEEN_LINES_SEC = 0.3;
export const MAX_HOLDS_SEC = 4;
const HOLDS_PRICED_AT_THEIR_CAP_BEFORE_PLAN_SEC = MAX_HOLDS_SEC;
const TYPICAL_LINE_COUNT = 10;
const TYPICAL_SYLLABLES_PER_LINE = 14;
const SMALLEST_SYLLABLE_BUDGET = 20;

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
  return (
    syllables(lines) / SPEECH_RATE +
    lines.length * BREATH_BETWEEN_LINES_SEC +
    HOLDS_PRICED_AT_THEIR_CAP_BEFORE_PLAN_SEC
  );
}

export function syllableBudget(seconds: number): number {
  return Math.max(
    SMALLEST_SYLLABLE_BUDGET,
    Math.round(
      (seconds -
        HOLDS_PRICED_AT_THEIR_CAP_BEFORE_PLAN_SEC -
        TYPICAL_LINE_COUNT * BREATH_BETWEEN_LINES_SEC) *
        SPEECH_RATE,
    ),
  );
}

export const VOICE_USD_PER_CHAR = 0.08 / 1000;

export const FRAME_USD = 0.12;

const speakingCharacters = (lines: Partial<Pick<ScriptLine, "characterId">>[]) => [
  ...new Set(lines.flatMap((l) => l.characterId ?? [])),
];

const lineSeconds = (line: Pick<ScriptLine, "text">) =>
  syllables([line]) / SPEECH_RATE + BREATH_BETWEEN_LINES_SEC;

export interface EstimateOpts {
  frames?: boolean;
  model?: string | null;
  resolution?: string | null;
  cutoutUsd?: number;
  level?: string | null;
}

const estimateVideoUsd = (
  lines: Pick<ScriptLine, "text">[],
  model?: string | null,
  resolution?: string | null,
) =>
  lines.length
    ? videoUsd(videoModel(model), estimateSeconds(lines), lines.map(lineSeconds), resolution)
    : 0;

const spokenChars = (lines: Pick<ScriptLine, "text">[]) =>
  lines.reduce((n, line) => n + line.text.trim().length, 0);

export const estimateVoiceUsd = (lines: Pick<ScriptLine, "text">[]) =>
  spokenChars(lines) * VOICE_USD_PER_CHAR;

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

export const TYPICAL_LINES: (Pick<ScriptLine, "text"> & Pick<ScriptLine, "characterId">)[] =
  Array.from({ length: TYPICAL_LINE_COUNT }, (_, i) => ({
    characterId: i % 2 ? "b" : "a",
    text: Array(TYPICAL_SYLLABLES_PER_LINE).fill("trà").join(" "),
  }));

export function levelEstimateUsd(level: MediaLevel, seconds = DEFAULT_TARGET_SEC): number {
  const voicePerSec = estimateVoiceUsd(TYPICAL_LINES) / estimateSeconds(TYPICAL_LINES);
  return levelMediaUsd(level, seconds) + voicePerSec * Math.max(1, seconds);
}

export function formatSeconds(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} giây`;
  return s % 60 ? `${Math.floor(s / 60)} phút ${s % 60} giây` : `${s / 60} phút`;
}

export const formatSecondsShort = (seconds: number) => `${Math.round(seconds)}s`;
