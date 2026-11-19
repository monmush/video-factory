import type { Script } from "./ipc";

// A script sent to video never changes (docs/VIDEO_COMMIT_DECISIONS.md,
// "Moving between Kịch bản and Video"). Changing it makes a new version: an
// independent copy placed after the last version of the same script, made
// into a video of its own at full price. Pure, so board.ts and tests share it.

/** The first script of a version chain. */
export const versionRoot = (s: Pick<Script, "id" | "versionOf">) => s.versionOf ?? s.id;

/** Every version of `script`'s chain on the board, deleted ones included, in board array order. */
const chainOf = (scripts: Script[], script: Pick<Script, "id" | "versionOf">) => {
  const root = versionRoot(script);
  return scripts.filter((s) => versionRoot(s) === root);
};

/**
 * A ready copy of `source` and where it goes in `scripts`: after the last live
 * version of its chain. Numbered after the live versions, so an undone or
 * deleted version leaves no gap ("bản 2", then "bản 3", never "bản 4").
 */
export function copyScript(
  scripts: Script[],
  source: Script,
  fields: { id: string; now: string },
): { copy: Script; index: number } {
  const live = chainOf(scripts, source).filter((s) => !s.deletedAt);
  const version = Math.max(1, ...live.map((s) => s.version ?? 1)) + 1;
  const last = live.at(-1) ?? source;
  const copy: Script = {
    ...structuredClone(source),
    id: fields.id,
    status: "ready",
    brief: {
      kind: "copy",
      sourceId: source.id,
      ...(source.brief.targetSec ? { targetSec: source.brief.targetSec } : {}),
    },
    versionOf: versionRoot(source),
    version,
    mark: "new",
    deletedAt: null,
    createdAt: fields.now,
    updatedAt: fields.now,
  };
  return { copy, index: scripts.indexOf(last) + 1 };
}
