import { describe, expect, it } from "vitest";
import type { ScriptLine } from "./ipc";
import { MERGE_WISH, mergeAt, mergeSideOf, sceneAction, scriptLineOf } from "./scene-actions";
import type { JobShot } from "./video-job";

const T = "2026-11-23T10:00:00.000Z";
const line = (characterId: string | null, text: string): ScriptLine => ({
  characterId,
  speaker: characterId ?? "",
  text,
});
const shot = (index: number, lineIndex: number, text: string) =>
  ({ index, lineIndex, text }) as JobShot;

const SCRIPT = [
  line("an", "Chào ông."),
  line(null, "(cảnh vườn)"),
  line("ong", "  Chào cháu, cháu ăn cơm chưa?  "),
];
const JOB = {
  lines: [line("an", "Chào ông."), line("ong", "Chào cháu, cháu ăn cơm chưa?")],
  shots: [shot(0, 0, "Chào ông."), shot(1, 1, "Chào cháu,"), shot(2, 1, "cháu ăn cơm chưa?")],
  direction: [],
};

describe("scene actions", () => {
  it("merges a scene that shares its line, into the next one when it opens its line", () => {
    expect(sceneAction(JOB, SCRIPT, JOB.shots[2] as JobShot)).toEqual({
      kind: "merge",
      into: "previous",
    });
    expect(sceneAction(JOB, SCRIPT, JOB.shots[1] as JobShot)).toEqual({
      kind: "merge",
      into: "next",
    });
    const opening = {
      ...JOB,
      shots: [shot(0, 0, "Chào"), shot(1, 0, "ông."), shot(2, 1, "Chào cháu, cháu ăn cơm chưa?")],
    };
    expect(sceneAction(opening, SCRIPT, opening.shots[0] as JobShot)).toEqual({
      kind: "merge",
      into: "next",
    });
  });

  it("removes the script line of a scene that is its line's only scene", () => {
    expect(sceneAction(JOB, SCRIPT, JOB.shots[0] as JobShot)).toEqual({
      kind: "remove",
      index: 0,
      was: "Chào ông.",
    });
  });

  it("maps a spoken line past unspoken lines, keeping the script's exact text", () => {
    expect(scriptLineOf(JOB, SCRIPT, { lineIndex: 1 })).toBe(2);
  });

  it("refuses when the spoken line cannot be matched exactly once", () => {
    const twice = [...SCRIPT, line("an", "Chào ông.")];
    expect(scriptLineOf(JOB, twice, { lineIndex: 0 })).toBeNull();
    expect(sceneAction(JOB, twice, JOB.shots[0] as JobShot)).toBeNull();
    expect(scriptLineOf(JOB, [line("ong", "Chào ông.")], { lineIndex: 0 })).toBeNull();
  });

  it("offers no removal when it would leave no spoken line", () => {
    const single = { lines: [JOB.lines[0] as ScriptLine], shots: [shot(0, 0, "Chào ông.")] };
    const withNarration = [line("an", "Chào ông."), line(null, "(cảnh vườn)")];
    expect(
      sceneAction({ ...single, direction: [] }, withNarration, single.shots[0] as JobShot),
    ).toBeNull();
  });

  it("offers nothing on a scene already set to merge", () => {
    const direction = [{ words: "cháu ăn cơm chưa?", want: MERGE_WISH.previous, at: T }];
    expect(sceneAction({ ...JOB, direction }, SCRIPT, JOB.shots[2] as JobShot)).toBeNull();
  });
});

describe("merge wishes", () => {
  it("recognises the fixed sentences however they were spaced or cased", () => {
    expect(mergeSideOf(`  ${MERGE_WISH.next.toUpperCase()} `)).toBe("next");
    expect(mergeSideOf("Cắt cảnh riêng ở đây")).toBeNull();
    const direction = [{ words: "Chào cháu,", want: MERGE_WISH.previous, at: T }];
    expect(mergeAt(direction, { text: "chào cháu," })).toBe("previous");
  });
});
