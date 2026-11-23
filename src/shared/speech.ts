import { SPEECH_RATE } from "./board";
import { splitTrailingCue } from "./cues";
import { type Alignment, estimatePartSec, type LineChars } from "./shot-plan";
import {
  askedSpeechSec,
  longerSpeechSec,
  SPEECH_MARGIN_SEC,
  type SpeechModel,
  speechModel,
  speechModelToTry,
  speechUsd,
} from "./speech-models";
import type { JobShot } from "./video-job";

export type SegmentState = "queued" | "rendering" | "done" | "failed" | "stopped";

export interface SpeechSegment {
  id: string;
  line: number;
  shots: number[];
  speakerShot: number | null;
  characterId: string;
  text: string;
  frame: string;
  hold: number;
}

export interface SpeechBounds {
  start: number;
  end: number;
}

export interface JobSegment extends SpeechSegment {
  state: SegmentState;
  model?: string;
  seconds?: number;
  atLeastSec?: number;
  requestId?: string;
  submittedAt?: string;
  sending?: string;
  resultUrl?: string;
  costUsd?: number | null;
  costBilled?: boolean;
  busyAnswers?: number;
  retried: boolean;
  failures: number;
  autoRedos?: number;
  rejectedClips?: number;
  cutOffs?: number;
  rejectedModels?: string[];
  clip?: string;
  clipSec?: number;
  speech?: SpeechBounds;
  error?: string;
}

export type GroupedShot = Pick<
  JobShot,
  "index" | "kind" | "lineIndex" | "characterId" | "text" | "hold"
>;

const norm = (text: string) => text.replace(/\s+/g, " ").trim();

export function speechSegments<S extends GroupedShot>(
  lines: readonly { characterId: string | null }[],
  shots: readonly S[],
  frameOf: (shot: S) => string,
  pictureOfSpeaker: (characterId: string) => string | null,
): SpeechSegment[] {
  const segments: SpeechSegment[] = [];
  lines.forEach((line, lineIndex) => {
    const speaker = line.characterId;
    const own = shots.filter((s) => s.lineIndex === lineIndex);
    if (!speaker || !own.length) return;
    const starts = own.flatMap((s, i) => (s.kind === "speaker" ? [i] : []));
    const groups = starts.length
      ? starts.map((at, k) => own.slice(k === 0 ? 0 : at, starts[k + 1] ?? own.length))
      : [own];
    groups.forEach((group, k) => {
      const speakerShot = group.find((s) => s.kind === "speaker") ?? null;
      const frame = speakerShot ? frameOf(speakerShot) : pictureOfSpeaker(speaker);
      if (!frame) return;
      segments.push({
        id: `line-${lineIndex + 1}-${k + 1}`,
        line: lineIndex,
        shots: group.map((s) => s.index),
        speakerShot: speakerShot?.index ?? null,
        characterId: speaker,
        text: norm(group.map((s) => s.text).join(" ")),
        frame,
        hold: group.at(-1)?.hold ?? 0,
      });
    });
  });
  return segments;
}

export const newSegment = (segment: SpeechSegment): JobSegment => ({
  ...segment,
  state: "queued",
  retried: false,
  failures: 0,
});

const samePlan = (a: SpeechSegment, b: SpeechSegment) =>
  a.id === b.id &&
  a.text === b.text &&
  a.frame === b.frame &&
  a.characterId === b.characterId &&
  a.hold === b.hold &&
  a.shots.join() === b.shots.join();

export function withSegments(
  made: readonly JobSegment[] | undefined,
  planned: readonly SpeechSegment[],
): JobSegment[] {
  return planned.map((p) => made?.find((m) => samePlan(m, p)) ?? newSegment(p));
}

export const CUE_SEC = 1;

export const SYLLABLES_A_SECOND_SPOKEN_BY_A_VIDEO_MODEL = 2.7;

export const speakingSec = (text: string) =>
  (estimatePartSec(text) * SPEECH_RATE) / SYLLABLES_A_SECOND_SPOKEN_BY_A_VIDEO_MODEL +
  (splitTrailingCue(text).cue ? CUE_SEC : 0);

export const wantedSec = (seg: Pick<JobSegment, "text" | "hold" | "atLeastSec">) =>
  Math.max(speakingSec(seg.text) + seg.hold + SPEECH_MARGIN_SEC, seg.atLeastSec ?? 0);

const sentOrMade = (seg: JobSegment) =>
  Boolean(seg.requestId || seg.state === "rendering" || seg.state === "done");

export function segmentModel(levelSpeech: string, seg: JobSegment): SpeechModel | null {
  if (seg.model && sentOrMade(seg)) return speechModel(seg.model);
  return speechModelToTry(levelSpeech, seg.rejectedModels ?? [], wantedSec(seg));
}

export function segmentAskedSec(levelSpeech: string, seg: JobSegment): number | null {
  if (seg.seconds && sentOrMade(seg)) return seg.seconds;
  const model = segmentModel(levelSpeech, seg);
  return model ? askedSpeechSec(model, wantedSec(seg)) : null;
}

export function segmentEstimateUsd(levelSpeech: string, seg: JobSegment): number | null {
  const model = segmentModel(levelSpeech, seg);
  const asked = segmentAskedSec(levelSpeech, seg);
  return model && asked ? speechUsd(model, asked) : null;
}

const clearedRequest = (seg: JobSegment): JobSegment => ({
  ...seg,
  requestId: undefined,
  submittedAt: undefined,
  sending: undefined,
  resultUrl: undefined,
  busyAnswers: undefined,
  model: undefined,
  seconds: undefined,
});

export function segmentAttemptFailed(seg: JobSegment, message: string): JobSegment {
  const base = { ...clearedRequest(seg), failures: seg.failures + 1 };
  return seg.retried
    ? { ...base, state: "failed", error: message }
    : { ...base, state: "queued", retried: true, error: undefined };
}

export const segmentWithdrawn = (seg: JobSegment, state: "queued" | "stopped"): JobSegment => ({
  ...clearedRequest(seg),
  state,
});

export const SPEECH_CUT_OFF = "Lời nói bị cắt ở cuối";

export function segmentCutOff(seg: JobSegment, levelSpeech: string): JobSegment {
  const model = segmentModel(levelSpeech, seg);
  const asked = segmentAskedSec(levelSpeech, seg) ?? wantedSec(seg);
  return {
    ...segmentAttemptFailed(seg, SPEECH_CUT_OFF),
    costUsd: undefined,
    costBilled: undefined,
    cutOffs: (seg.cutOffs ?? 0) + 1,
    atLeastSec: model ? longerSpeechSec(model, asked) : asked,
  };
}

export const segmentOpen = (s: JobSegment) => s.state === "queued" || s.state === "rendering";

export const SILENCE_NOISE_DB = -35;
export const SILENCE_MIN_SEC = 0.3;
const EDGE_SEC = 0.05;
const SOUND_THIS_SHORT_AFTER_THE_LAST_QUIET_IS_NOT_SPEECH_SEC = 0.3;

export function speechBounds(silenceLog: string, clipSec: number): SpeechBounds | null {
  const quiet: { start: number; end: number }[] = [];
  let open: number | null = null;
  for (const m of silenceLog.matchAll(/silence_(start|end):\s*(-?[\d.]+)/g)) {
    const at = Math.min(clipSec, Math.max(0, Number(m[2])));
    if (!Number.isFinite(at)) continue;
    if (m[1] === "start") open = at;
    else {
      quiet.push({ start: open ?? 0, end: at });
      open = null;
    }
  }
  if (open !== null) quiet.push({ start: open, end: clipSec });
  const first = quiet[0];
  const last = quiet.at(-1);
  const start = first && first.start <= EDGE_SEC ? first.end : 0;
  const end =
    last && last.end >= clipSec - SOUND_THIS_SHORT_AFTER_THE_LAST_QUIET_IS_NOT_SPEECH_SEC
      ? last.start
      : clipSec;
  return end - start > EDGE_SEC ? { start, end } : null;
}

export const speechCutOff = (bounds: SpeechBounds, clipSec: number) =>
  clipSec - bounds.end < SILENCE_MIN_SEC;

export const SPEECH_LEAD_SEC = 0.15;

export interface HeardSegment {
  id: string;
  line: number;
  text: string;
  clipSec: number;
  speech: SpeechBounds;
}

export interface SpokenPiece {
  segment: string;
  from: number;
  to: number;
  at: number;
}

export interface SpeechTimeline {
  pieces: SpokenPiece[];
  dialogueSec: number;
  lineSpans: { start: number; end: number }[];
  timing: { alignment: Alignment; lineChars: LineChars[] };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function speechTimeline(
  segments: readonly HeardSegment[],
  lineCount: number,
): SpeechTimeline {
  const ordered = segments
    .map((s, order) => ({ s, order }))
    .sort((a, b) => a.s.line - b.s.line || a.order - b.order)
    .map(({ s }) => s);
  const pieces: SpokenPiece[] = [];
  const heard = new Map<string, SpeechBounds>();
  let cursor = 0;
  for (const s of ordered) {
    const from = Math.max(0, s.speech.start - SPEECH_LEAD_SEC);
    const to = Math.min(s.clipSec, s.speech.end + SPEECH_LEAD_SEC);
    pieces.push({ segment: s.id, from: round3(from), to: round3(to), at: round3(cursor) });
    heard.set(s.id, {
      start: round3(cursor + s.speech.start - from),
      end: round3(cursor + s.speech.end - from),
    });
    cursor += to - from;
  }
  const characters: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  const lineChars: LineChars[] = [];
  const lineSpans: { start: number; end: number }[] = [];
  for (let line = 0; line < lineCount; line++) {
    const mine = ordered.filter((s) => s.line === line);
    const begin = characters.length;
    mine.forEach((s, k) => {
      const span = heard.get(s.id) as SpeechBounds;
      if (k > 0) {
        characters.push(" ");
        starts.push(span.start);
        ends.push(span.start);
      }
      const chars = norm(s.text).split("");
      const step = (span.end - span.start) / Math.max(1, chars.length);
      chars.forEach((c, i) => {
        characters.push(c);
        starts.push(round3(span.start + step * i));
        ends.push(round3(span.start + step * (i + 1)));
      });
    });
    lineChars.push({ start: begin, end: characters.length });
    const spans = mine.map((s) => heard.get(s.id) as SpeechBounds);
    lineSpans.push(
      spans.length
        ? {
            start: Math.min(...spans.map((x) => x.start)),
            end: Math.max(...spans.map((x) => x.end)),
          }
        : { start: round3(cursor), end: round3(cursor) },
    );
  }
  return {
    pieces,
    dialogueSec: round3(cursor),
    lineSpans,
    timing: {
      alignment: {
        characters,
        characterStartTimesSeconds: starts,
        characterEndTimesSeconds: ends,
      },
      lineChars,
    },
  };
}

export const cutFrom = (piece: SpokenPiece, spokenStart: number) =>
  round3(piece.from + spokenStart - piece.at);
