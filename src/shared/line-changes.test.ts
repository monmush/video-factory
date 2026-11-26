import { describe, expect, it } from "vitest";
import type { ScriptLine } from "./ipc";
import { applyLineChanges } from "./line-changes";

const an = { characterId: "an", speaker: "An" };
const ba = { characterId: "ba", speaker: "Ba" };
const LINES: ScriptLine[] = [
  { ...an, text: "Một." },
  { ...ba, text: "Hai." },
  { ...an, text: "Ba." },
  { ...ba, text: "Bốn." },
];

describe("changing some lines of a script", () => {
  it("keeps every untouched line as it was and reads every number against the script before the call", () => {
    const changed = applyLineChanges(LINES, [
      { op: "delete", line: 1 },
      { op: "replace", line: 3, text: "Ba mới." },
      { op: "insert", after: 3, speaker: ba, text: "Chen." },
      { op: "insert", after: 0, speaker: an, text: "Mở đầu." },
    ]);
    expect(changed.lines.map((l) => l.text)).toEqual([
      "Mở đầu.",
      "Hai.",
      "Ba mới.",
      "Chen.",
      "Bốn.",
    ]);
    expect(changed.lines[1]).toBe(LINES[1]);
    expect(changed.lines[4]).toBe(LINES[3]);
    expect(changed.lines[2]).toMatchObject(an);
    expect(changed).toMatchObject({ replaced: [3], inserted: 2, deleted: [1] });
  });

  it("refuses to delete the last remaining line", () => {
    expect(() => applyLineChanges(LINES.slice(0, 1), [{ op: "delete", line: 1 }])).toThrow(
      /câu cuối cùng/,
    );
  });
});
