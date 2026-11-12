import type { Script, ScriptLine } from "./ipc";

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
const SPEECH_RATE = 3.7;
/** Breath between lines. */
const LINE_GAP_SEC = 0.3;
/** Silent beats: product moment and ending. */
const SILENT_SEC = 4;
/**
 * Fully generated speaking video, per second: the Kling Avatar v2 Standard
 * test. Excludes voice, images and retries; replace when the route is chosen.
 */
const VIDEO_USD_PER_SEC = 0.0562;

/** Vietnamese syllables are written as separate words. */
export const syllables = (lines: Pick<ScriptLine, "text">[]) =>
  lines.reduce((n, line) => n + line.text.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length, 0);

export function estimateSeconds(lines: Pick<ScriptLine, "text">[]): number {
  if (lines.length === 0) return 0;
  return syllables(lines) / SPEECH_RATE + lines.length * LINE_GAP_SEC + SILENT_SEC;
}

/** Spoken syllables that fill a video of `seconds`, assuming about ten lines. */
export function syllableBudget(seconds: number): number {
  return Math.max(20, Math.round((seconds - SILENT_SEC - 10 * LINE_GAP_SEC) * SPEECH_RATE));
}

export const estimateVideoUsd = (seconds: number) => seconds * VIDEO_USD_PER_SEC;

/** "42 giây", "1 phút 5 giây". */
export function formatSeconds(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} giây`;
  return s % 60 ? `${Math.floor(s / 60)} phút ${s % 60} giây` : `${s / 60} phút`;
}

/** "43s", for tight rows. */
export const formatSecondsShort = (seconds: number) => `${Math.round(seconds)}s`;
