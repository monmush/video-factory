import { clearMarks } from "./board";
import { cleanCues } from "./cues";
import type { Board, Script, ScriptLine } from "./ipc";
import { copyScript } from "./versions";

export interface LineEdit {
  index: number;
  was: string;
  text: string;
}

export interface LineRemoval {
  index: number;
  was: string;
}

export const SCRIPT_CHANGED_MEANWHILE = "Kịch bản vừa thay đổi, hãy thử lại";

function lineStillReads(lines: readonly ScriptLine[], at: LineRemoval): ScriptLine {
  const line = lines[at.index];
  if (!line || line.text !== at.was) throw new Error(SCRIPT_CHANGED_MEANWHILE);
  return line;
}

export function editedLines(lines: readonly ScriptLine[], edit: LineEdit): ScriptLine[] | null {
  const line = lineStillReads(lines, edit);
  const text = cleanCues(edit.text);
  if (!text) throw new Error("Lời thoại không được để trống");
  if (text === line.text) return null;
  return lines.map((l, i) => (i === edit.index ? { ...l, text } : { ...l }));
}

export function withoutLine(lines: readonly ScriptLine[], removal: LineRemoval): ScriptLine[] {
  lineStillReads(lines, removal);
  if (lines.length <= 1) throw new Error("Kịch bản cần ít nhất một lời thoại");
  return lines.filter((_, i) => i !== removal.index).map((l) => ({ ...l }));
}

export function rememberHandEdit(board: Board, scriptId: string) {
  board.handEdited = [...new Set([...(board.handEdited ?? []), scriptId])];
}

type HandChangeOptions = { copy: boolean; id: string; now: string };
type HandChangeResult = { scriptId: string; copied: boolean };

function refuseWhileWriting(script: Script) {
  if (script.status !== "ready" || script.changing) {
    throw new Error("Kịch bản đang được viết, thử lại sau");
  }
}

function saveHandLines(
  board: Board,
  script: Script,
  lines: ScriptLine[],
  opts: HandChangeOptions,
): HandChangeResult {
  clearMarks(board);
  if (opts.copy) {
    const { copy, index } = copyScript(board.scripts, script, opts);
    copy.lines = lines;
    copy.changeUndo = { copy: true };
    board.scripts.splice(index, 0, copy);
    rememberHandEdit(board, copy.id);
    return { scriptId: copy.id, copied: true };
  }
  script.changeUndo = {
    productIds: [...script.productIds],
    lines: structuredClone(script.lines),
    staging: script.staging,
  };
  script.lines = lines;
  script.mark = "edited";
  script.updatedAt = opts.now;
  rememberHandEdit(board, script.id);
  return { scriptId: script.id, copied: false };
}

export function applyLineEdit(
  board: Board,
  script: Script,
  edit: LineEdit,
  opts: HandChangeOptions,
): HandChangeResult | null {
  refuseWhileWriting(script);
  const lines = editedLines(script.lines, edit);
  if (!lines) return null;
  return saveHandLines(board, script, lines, opts);
}

export function applyLineRemoval(
  board: Board,
  script: Script,
  removal: LineRemoval,
  opts: HandChangeOptions,
): HandChangeResult {
  refuseWhileWriting(script);
  return saveHandLines(board, script, withoutLine(script.lines, removal), opts);
}
