import { appendFile, readFile } from "node:fs/promises";
import type { ClaudeLimits, UsageEntry } from "../shared/ipc";
import { dataFile, writeJsonAtomic } from "./paths";

// Every AI request the app makes is appended to usage.jsonl (one JSON object
// per line, USD) for later cost-per-video analysis. Claude's plan limits arrive
// with each Claude Code call; the latest reading is kept in claude-limits.json.

const LOG = "usage.jsonl";
const LIMITS = "claude-limits.json";

export async function logUsage(entry: Omit<UsageEntry, "at"> & Record<string, unknown>) {
  await appendFile(
    dataFile(LOG),
    `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
  );
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
