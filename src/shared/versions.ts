import type { Script } from "./ipc";

export const versionRoot = (s: Pick<Script, "id" | "versionOf">) => s.versionOf ?? s.id;

const chainOf = (scripts: Script[], script: Pick<Script, "id" | "versionOf">) => {
  const root = versionRoot(script);
  return scripts.filter((s) => versionRoot(s) === root);
};

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
