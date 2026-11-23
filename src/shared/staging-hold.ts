import { sameSpokenLines } from "./direction";
import type { ScriptLine } from "./ipc";

export const MAX_STAGING_HOLD_MS = 15 * 60 * 1000;

export interface StagingHold {
  scripts: ReadonlySet<string>;
  since: number;
}

export const stagingHeld = (holds: Iterable<StagingHold>, scriptId: string, now: number) =>
  [...holds].some((h) => h.scripts.has(scriptId) && now - h.since < MAX_STAGING_HOLD_MS);

export const stagingOutdated = (
  staged: { lines: ScriptLine[] },
  script: { lines: ScriptLine[]; deletedAt?: string | null } | undefined,
) => !script || Boolean(script.deletedAt) || !sameSpokenLines(staged.lines, script.lines);
