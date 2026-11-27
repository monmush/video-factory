import type { MediaBalance } from "./ipc";

export type ShownBalance = { usd: number } | null;

const FRESH_FOR_MS = 60_000;

export function shownBalance(previous: ShownBalance, result: MediaBalance): ShownBalance {
  if (result.status === "error") return previous;
  if (result.status !== "ok" || result.currency !== "USD") return null;
  return { usd: result.balance };
}

export function isStale(readAtMs: number | null, nowMs: number): boolean {
  return readAtMs === null || nowMs - readAtMs >= FRESH_FOR_MS;
}
