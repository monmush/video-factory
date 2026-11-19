import { describe, expect, it } from "vitest";
import type { Script } from "./ipc";
import { copyScript, versionRoot } from "./versions";

const script = (id: string, fields: Partial<Script> = {}): Script => ({
  id,
  title: id,
  hook: "",
  lines: [{ characterId: "c", speaker: "C", text: "Trà ngon" }],
  productIds: [],
  staging: "",
  status: "ready",
  brief: { kind: "topic", targetSec: 45 },
  mark: null,
  pinned: false,
  deletedAt: null,
  createdAt: "",
  updatedAt: "",
  ...fields,
});

const insert = (scripts: Script[], sourceId: string, id: string) => {
  const source = scripts.find((s) => s.id === sourceId) as Script;
  const { copy, index } = copyScript(scripts, source, { id, now: "t" });
  scripts.splice(index, 0, copy);
  return copy;
};

describe("new versions of a script sent to video", () => {
  it("copies the content as a ready card right after the original", () => {
    const scripts = [script("a"), script("b")];
    const copy = insert(scripts, "a", "a2");
    expect(scripts.map((s) => s.id)).toEqual(["a", "a2", "b"]);
    expect(copy).toMatchObject({
      status: "ready",
      lines: scripts[0]?.lines,
      versionOf: "a",
      version: 2,
      brief: { kind: "copy", sourceId: "a", targetSec: 45 },
    });
    copy.lines[0] = { characterId: "c", speaker: "C", text: "khác" };
    expect(scripts[0]?.lines[0]?.text).toBe("Trà ngon");
  });

  it("numbers versions along the chain and places them after its last live version", () => {
    const scripts = [script("a"), script("b")];
    insert(scripts, "a", "a2");
    const third = insert(scripts, "a", "a3");
    expect(third.version).toBe(3);
    expect(scripts.map((s) => s.id)).toEqual(["a", "a2", "a3", "b"]);
    const fourth = insert(scripts, "a2", "a4");
    expect(fourth).toMatchObject({ versionOf: "a", version: 4 });
    expect(versionRoot(fourth)).toBe("a");
  });

  it("leaves no gap after a deleted or undone version", () => {
    const scripts = [script("a")];
    const second = insert(scripts, "a", "a2");
    second.deletedAt = "t";
    expect(insert(scripts, "a", "a3").version).toBe(2);
    expect(scripts.map((s) => s.id)).toEqual(["a", "a3", "a2"]);
  });
});
