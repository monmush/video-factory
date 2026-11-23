import { describe, expect, it } from "vitest";
import type { Board, Script } from "./ipc";
import {
  applyLineEdit,
  applyLineRemoval,
  editedLines,
  SCRIPT_CHANGED_MEANWHILE,
  withoutLine,
} from "./line-edit";

const script = (id: string, fields: Partial<Script> = {}): Script => ({
  id,
  title: id,
  hook: "",
  lines: [
    { characterId: "an", speaker: "An", text: "Trà này thơm quá" },
    { characterId: null, speaker: "Khách", text: "Cho tôi một ấm" },
  ],
  productIds: ["p"],
  staging: "Quán trà",
  status: "ready",
  brief: { kind: "topic", targetSec: 45 },
  mark: null,
  pinned: false,
  deletedAt: null,
  createdAt: "",
  updatedAt: "",
  ...fields,
});

const boardOf = (...scripts: Script[]): Board => ({ version: 1, scripts, messages: [] });
const opts = (copy: boolean) => ({ copy, id: "copy", now: "later" });

describe("editing one line by hand", () => {
  it("cleans the text the way written lines are cleaned, keeping the speaker", () => {
    const lines = script("a").lines;
    const next = editedLines(lines, {
      index: 1,
      was: "Cho tôi một ấm",
      text: "  Cho tôi\nhai ấm [nhạc] nhé [Cười] ",
    });
    expect(next?.[1]).toEqual({
      characterId: null,
      speaker: "Khách",
      text: "Cho tôi hai ấm nhé [cười]",
    });
    expect(next?.[0]).toEqual(lines[0]);
  });

  it("refuses when the line changed since the editor opened", () => {
    const lines = script("a").lines;
    expect(() => editedLines(lines, { index: 0, was: "Trà cũ", text: "Trà mới" })).toThrow(
      SCRIPT_CHANGED_MEANWHILE,
    );
    expect(() => editedLines(lines, { index: 5, was: "", text: "Trà mới" })).toThrow(
      SCRIPT_CHANGED_MEANWHILE,
    );
  });

  it("refuses an empty line and ignores an unchanged one", () => {
    const lines = script("a").lines;
    expect(() =>
      editedLines(lines, { index: 0, was: lines[0]?.text ?? "", text: " [ ] " }),
    ).toThrow();
    expect(
      editedLines(lines, { index: 0, was: "Trà này thơm quá", text: " Trà này  thơm quá" }),
    ).toBeNull();
  });

  it("edits in place with one undo for the board and remembers it for the chat", () => {
    const a = script("a");
    const b = script("b", { mark: "new", changeUndo: { copy: true } });
    const board = boardOf(a, b);
    const result = applyLineEdit(
      board,
      a,
      { index: 0, was: "Trà này thơm quá", text: "Trà này ngon quá" },
      opts(false),
    );
    expect(result).toEqual({ scriptId: "a", copied: false });
    expect(a.lines[0]?.text).toBe("Trà này ngon quá");
    expect(a.changeUndo).toEqual({
      productIds: ["p"],
      lines: script("a").lines,
      staging: "Quán trà",
    });
    expect(a).toMatchObject({ mark: "edited", updatedAt: "later" });
    expect(b.changeUndo).toBeUndefined();
    expect(b.mark).toBeNull();
    expect(board.handEdited).toEqual(["a"]);
  });

  it("saves a script with a video as a new version and leaves the original alone", () => {
    const a = script("a");
    const board = boardOf(a, script("b"));
    const result = applyLineEdit(
      board,
      a,
      { index: 0, was: "Trà này thơm quá", text: "Trà này ngon quá" },
      opts(true),
    );
    expect(result).toEqual({ scriptId: "copy", copied: true });
    expect(board.scripts.map((s) => s.id)).toEqual(["a", "copy", "b"]);
    expect(a).toEqual(script("a"));
    expect(board.scripts[1]).toMatchObject({
      lines: [{ text: "Trà này ngon quá" }, { text: "Cho tôi một ấm" }],
      brief: { kind: "copy", sourceId: "a" },
      version: 2,
      mark: "new",
      changeUndo: { copy: true },
    });
    expect(board.handEdited).toEqual(["copy"]);
  });

  it("creates nothing when the text did not change", () => {
    const board = boardOf(script("a"));
    const a = board.scripts[0] as Script;
    expect(
      applyLineEdit(
        board,
        a,
        { index: 0, was: "Trà này thơm quá", text: "Trà này thơm quá" },
        opts(true),
      ),
    ).toBeNull();
    expect(board.scripts).toHaveLength(1);
    expect(board.handEdited).toBeUndefined();
  });

  it("refuses while the script is being written", () => {
    const a = script("a", { status: "writing" });
    expect(() =>
      applyLineEdit(
        boardOf(a),
        a,
        { index: 0, was: "Trà này thơm quá", text: "Khác" },
        opts(false),
      ),
    ).toThrow();
  });
});

describe("removing one line by hand", () => {
  it("removes the line in place and keeps the one undo for the board", () => {
    const a = script("a");
    const board = boardOf(a);
    const result = applyLineRemoval(board, a, { index: 0, was: "Trà này thơm quá" }, opts(false));
    expect(result).toEqual({ scriptId: "a", copied: false });
    expect(a.lines).toEqual([script("a").lines[1]]);
    expect(a).toMatchObject({ mark: "edited", updatedAt: "later" });
    expect(a.changeUndo).toEqual({
      productIds: ["p"],
      lines: script("a").lines,
      staging: "Quán trà",
    });
    expect(board.handEdited).toEqual(["a"]);
  });

  it("refuses when the line changed since the editor opened", () => {
    const lines = script("a").lines;
    expect(() => withoutLine(lines, { index: 1, was: "Cho tôi hai ấm" })).toThrow(
      SCRIPT_CHANGED_MEANWHILE,
    );
  });

  it("keeps the only line of a script", () => {
    const only = script("a").lines.slice(0, 1);
    expect(() => withoutLine(only, { index: 0, was: "Trà này thơm quá" })).toThrow();
  });

  it("saves a script with a video as a new version and leaves the original alone", () => {
    const a = script("a");
    const board = boardOf(a);
    const result = applyLineRemoval(board, a, { index: 1, was: "Cho tôi một ấm" }, opts(true));
    expect(result).toEqual({ scriptId: "copy", copied: true });
    expect(a).toEqual(script("a"));
    expect(board.scripts[1]).toMatchObject({
      lines: [{ text: "Trà này thơm quá" }],
      brief: { kind: "copy", sourceId: "a" },
      changeUndo: { copy: true },
    });
  });
});
