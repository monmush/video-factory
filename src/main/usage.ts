import { appendFile, readFile } from "node:fs/promises";
import type { ClaudeLimits, UsageEntry } from "../shared/ipc";
import { openRequests, parseLines, type RequestRecord } from "../shared/request-reconcile";
import { dataFile, writeJsonAtomic } from "./paths";

const LOG = "usage.jsonl";
const LIMITS = "claude-limits.json";
const REQUESTS = "requests.jsonl";

export async function logUsage(entry: Omit<UsageEntry, "at"> & Record<string, unknown>) {
  await appendFile(
    dataFile(LOG),
    `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
  );
}

export async function recordSubmitted(
  entry: { provider: string; requestId: string } & Record<string, unknown>,
) {
  await appendFile(
    dataFile(REQUESTS),
    `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
  );
}

export async function recordFailed(entry: { provider: string; requestId: string }) {
  await recordSubmitted({ ...entry, failed: true });
}

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
