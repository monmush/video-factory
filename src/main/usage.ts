import { appendFile, readFile } from "node:fs/promises";
import type { ClaudeLimits, UsageEntry } from "../shared/ipc";
import { openRequests, parseLines, type RequestRecord } from "../shared/request-reconcile";
import { dataFile, writeJsonAtomic } from "./paths";

// Every AI request the app makes is appended to usage.jsonl (one JSON object
// per line, USD) for later cost-per-video analysis. Claude's plan limits arrive
// with each Claude Code call; the latest reading is kept in claude-limits.json.

const LOG = "usage.jsonl";
const LIMITS = "claude-limits.json";
const REQUESTS = "requests.jsonl";

export async function logUsage(entry: Omit<UsageEntry, "at"> & Record<string, unknown>) {
  await appendFile(
    dataFile(LOG),
    `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
  );
}

/** A paid request the provider accepted; written before its result is known. */
export async function recordSubmitted(
  entry: { provider: string; requestId: string } & Record<string, unknown>,
) {
  await appendFile(
    dataFile(REQUESTS),
    `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
  );
}

/** The provider reported that a recorded request failed: nothing to collect from it on start. */
export async function recordFailed(entry: { provider: string; requestId: string }) {
  await recordSubmitted({ ...entry, failed: true });
}

/**
 * fal requests accepted but never read: recorded in requests.jsonl, with no
 * result in usage.jsonl and no failure recorded (src/shared/request-reconcile.ts).
 */
export async function openFalRequests(): Promise<RequestRecord[]> {
  const read = (name: string) => readFile(dataFile(name), "utf8").catch(() => "");
  const requests = parseLines<RequestRecord>(await read(REQUESTS)).filter(
    (r) => r.provider === "fal",
  );
  return openRequests(requests, parseLines<{ requestId?: string }>(await read(LOG)));
}

export async function saveClaudeLimits(limits: ClaudeLimits) {
  await writeJsonAtomic(dataFile(LIMITS), limits);
}

export async function readClaudeLimits(): Promise<ClaudeLimits | null> {
  try {
    return JSON.parse(await readFile(dataFile(LIMITS), "utf8"));
  } catch {
    return null;
  }
}
