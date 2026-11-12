import { describe, expect, it } from "vitest";
import type { Board, ChatMessage, Script } from "../shared/ipc";
import { applyUndo, dropTouch, recordTouch, type TurnLog } from "./board-undo";

const script = (id: string, title: string): Script => ({
  id,
  title,
  hook: "",
  lines: [{ characterId: null, speaker: "A", text: title }],
  productIds: [],
  staging: "",
  status: "ready",
  brief: { kind: "topic" },
  mark: null,
  pinned: false,
  deletedAt: null,
  createdAt: "",
  updatedAt: "",
});

const reply = (id: string): ChatMessage => ({ id, role: "assistant", text: "", at: "" });

function board(...scripts: Script[]): Board {
  return { version: 1, scripts, messages: [] };
}

/** One agent turn that renames a script, recorded the way board.ts does. */
function turn(b: Board, messageId: string, scriptId: string, title: string) {
  b.messages.push(reply(messageId));
  const log: TurnLog = { messageId, touched: new Set() };
  const s = b.scripts.find((x) => x.id === scriptId) as Script;
  recordTouch(b, log, s);
  s.title = title;
  return log;
}

describe("applyUndo", () => {
  it("restores the script a turn changed", () => {
    const b = board(script("a", "one"));
    turn(b, "m1", "a", "two");
    applyUndo(b, "m1");
    expect(b.scripts[0]?.title).toBe("one");
    expect(b.messages[0]?.undo?.undone).toBe(true);
  });

  it("refuses an older turn when a later one changed the same script", () => {
    const b = board(script("a", "one"));
    turn(b, "m1", "a", "two");
    turn(b, "m2", "a", "three");
    expect(() => applyUndo(b, "m1")).toThrow();
    expect(b.scripts[0]?.title).toBe("three");
  });

  it("allows the older turn once the later one is undone", () => {
    const b = board(script("a", "one"));
    turn(b, "m1", "a", "two");
    turn(b, "m2", "a", "three");
    applyUndo(b, "m2");
    applyUndo(b, "m1");
    expect(b.scripts[0]?.title).toBe("one");
  });

  it("allows an older turn when later turns touched other scripts", () => {
    const b = board(script("a", "one"), script("b", "x"));
    turn(b, "m1", "a", "two");
    turn(b, "m2", "b", "y");
    applyUndo(b, "m1");
    expect(b.scripts.map((s) => s.title)).toEqual(["one", "y"]);
  });

  it("removes scripts the turn added", () => {
    const b = board(script("a", "one"));
    b.messages.push({ ...reply("m1"), undo: { before: [], added: ["a"], undone: false } });
    applyUndo(b, "m1");
    expect(b.scripts[0]?.deletedAt).not.toBeNull();
  });

  it("skips scripts still being written", () => {
    const b = board(script("a", "one"));
    turn(b, "m1", "a", "two");
    (b.scripts[0] as Script).status = "writing";
    applyUndo(b, "m1");
    expect(b.scripts[0]?.title).toBe("two");
  });
});

describe("recordTouch", () => {
  it("snapshots a script only the first time a turn touches it", () => {
    const b = board(script("a", "one"));
    const log = turn(b, "m1", "a", "two");
    const s = b.scripts[0] as Script;
    expect(recordTouch(b, log, s)).toBe(false);
    expect(b.messages[0]?.undo?.before.map((x) => x.title)).toEqual(["one"]);
  });

  it("forgets a snapshot with dropTouch", () => {
    const b = board(script("a", "one"));
    const log = turn(b, "m1", "a", "one");
    dropTouch(b, log, "a");
    expect(b.messages[0]?.undo?.before).toEqual([]);
    expect(log.touched.has("a")).toBe(false);
  });
});
