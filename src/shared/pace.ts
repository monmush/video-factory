import { MAX_HOLDS_SEC, syllables } from "./board";
import type { Script, ScriptLine } from "./ipc";

export const BRISK_SYLLABLES_A_SECOND = 4;
export const FASTEST_SYLLABLES_A_SECOND = 5;
export const PACE_OF_VIDEOS_MADE_BEFORE_PACES = 2.7;
export const FAST_FROM_SYLLABLES_A_SECOND = 4.6;

const BREATH_BETWEEN_LINES_SEC = 0.3;
const HOLDS_PRICED_AT_THEIR_CAP_BEFORE_PLAN_SEC = MAX_HOLDS_SEC;
const TYPICAL_LINE_COUNT = 10;
const SMALLEST_SYLLABLE_BUDGET = 20;
const SHORT_BELOW_SHARE_OF_TARGET = 0.85;
const LONG_ABOVE_SHARE_OF_TARGET = 1.2;

type Lines = readonly Pick<ScriptLine, "text">[];

const silenceSec = (lineCount: number) =>
  lineCount * BREATH_BETWEEN_LINES_SEC + HOLDS_PRICED_AT_THEIR_CAP_BEFORE_PLAN_SEC;

export function paceFor(lines: Lines, targetSec: number): number {
  const speakingSec = targetSec - silenceSec(lines.length);
  if (speakingSec <= 0) return FASTEST_SYLLABLES_A_SECOND;
  return Math.min(
    FASTEST_SYLLABLES_A_SECOND,
    Math.max(BRISK_SYLLABLES_A_SECOND, syllables(lines) / speakingSec),
  );
}

export function secondsAtPace(lines: Lines, pace: number): number {
  if (lines.length === 0) return 0;
  return syllables(lines) / pace + silenceSec(lines.length);
}

export const estimateSeconds = (lines: Lines, targetSec: number) =>
  secondsAtPace(lines, paceFor(lines, targetSec));

export const promisedSec = (job: { lines: Lines; pace?: number }): number | null =>
  job.pace === undefined || job.lines.length === 0 ? null : secondsAtPace(job.lines, job.pace);

export function syllableBudget(seconds: number): number {
  return Math.max(
    SMALLEST_SYLLABLE_BUDGET,
    Math.round((seconds - silenceSec(TYPICAL_LINE_COUNT)) * BRISK_SYLLABLES_A_SECOND),
  );
}

export type LengthFit = "short" | "fits" | "long";

export function lengthFit(seconds: number, targetSec: number): LengthFit {
  if (seconds < targetSec * SHORT_BELOW_SHARE_OF_TARGET) return "short";
  if (seconds > targetSec * LONG_ABOVE_SHARE_OF_TARGET) return "long";
  return "fits";
}

export const fasterThanBrisk = (pace: number) => pace > BRISK_SYLLABLES_A_SECOND + 1e-9;

export const scriptTargetSec = (script: Pick<Script, "brief">, seriesTargetSec: number) =>
  script.brief.targetSec ?? seriesTargetSec;

export const scriptPace = (script: Pick<Script, "lines" | "brief">, seriesTargetSec: number) =>
  paceFor(script.lines, scriptTargetSec(script, seriesTargetSec));

export const scriptSeconds = (script: Pick<Script, "lines" | "brief">, seriesTargetSec: number) =>
  estimateSeconds(script.lines, scriptTargetSec(script, seriesTargetSec));
