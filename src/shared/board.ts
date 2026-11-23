import { VOICE_USD_PER_CHAR } from "./cost/rates";
import { withoutCues } from "./cues";
import type { Board, Script, ScriptLine } from "./ipc";

export function boardOrder(scripts: Script[]): Script[] {
  const live = scripts.filter((s) => !s.deletedAt);
  return [...live.filter((s) => s.pinned), ...live.filter((s) => !s.pinned)];
}

export function clearMarks(board: Board) {
  for (const s of board.scripts) {
    s.mark = null;
    delete s.changeUndo;
  }
}

export const DEFAULT_TARGET_SEC = 45;
export const SPEECH_RATE = 3.7;
const BREATH_BETWEEN_LINES_SEC = 0.3;
export const MAX_HOLDS_SEC = 4;
const HOLDS_PRICED_AT_THEIR_CAP_BEFORE_PLAN_SEC = MAX_HOLDS_SEC;
const TYPICAL_LINE_COUNT = 10;
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

const spokenChars = (lines: Pick<ScriptLine, "text">[]) =>
  lines.reduce((n, line) => n + line.text.trim().length, 0);

export const estimateVoiceUsd = (lines: Pick<ScriptLine, "text">[]) =>
  spokenChars(lines) * VOICE_USD_PER_CHAR;

export function formatSeconds(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} giây`;
  return s % 60 ? `${Math.floor(s / 60)} phút ${s % 60} giây` : `${s / 60} phút`;
}

export const formatSecondsShort = (seconds: number) => `${Math.round(seconds)}s`;

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
