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
const MIN_TARGET_SEC = 10;
const MAX_TARGET_SEC = 180;

export function clampTarget(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(MAX_TARGET_SEC, Math.max(MIN_TARGET_SEC, Math.round(n)));
}

export function statedLength(text: string): { seconds: number | null; phrase: string } | null {
  const found = text.match(/(\d+)\s*(giây|s\b|phút)/i);
  if (!found) return null;
  const perUnit = found[2]?.toLowerCase() === "phút" ? 60 : 1;
  return { seconds: clampTarget(Number(found[1]) * perUnit), phrase: found[0] };
}

export const MAX_HOLDS_SEC = 4;

export const syllables = (lines: readonly Pick<ScriptLine, "text">[]) =>
  lines.reduce(
    (n, line) =>
      n +
      withoutCues(line.text)
        .split(/\s+/)
        .filter((w) => /\p{L}/u.test(w)).length,
    0,
  );

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
