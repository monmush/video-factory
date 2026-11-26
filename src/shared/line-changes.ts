import { cleanCues } from "./cues";
import type { ScriptLine } from "./ipc";

export type Speaker = Pick<ScriptLine, "characterId" | "speaker">;

export type LineChange =
  | { op: "replace"; line: number; text: string; speaker?: Speaker }
  | { op: "insert"; after: number; text: string; speaker: Speaker }
  | { op: "delete"; line: number };

export interface ChangedLines {
  lines: ScriptLine[];
  replaced: number[];
  inserted: number;
  deleted: number[];
}

const spoken = (text: string) => {
  const cleaned = cleanCues(text);
  if (!cleaned) throw new Error("Lời thoại không được để trống.");
  return cleaned;
};

const sameLine = (a: ScriptLine, b: ScriptLine) =>
  a.text === b.text && a.characterId === b.characterId && a.speaker === b.speaker;

const ascending = (numbers: Iterable<number>) => [...numbers].sort((a, b) => a - b);

export function applyLineChanges(
  lines: readonly ScriptLine[],
  changes: readonly LineChange[],
): ChangedLines {
  const count = lines.length;
  const missing = (n: number, lowest: number) => !Number.isInteger(n) || n < lowest || n > count;
  const touched = new Set<number>();
  const replacements = new Map<number, ScriptLine>();
  const deleted = new Set<number>();
  const inserts = new Map<number, ScriptLine[]>();
  let inserted = 0;
  for (const change of changes) {
    if (change.op === "insert") {
      if (missing(change.after, 0)) {
        throw new Error(`Không chèn được sau câu ${change.after}: kịch bản có ${count} câu.`);
      }
      const line = { ...change.speaker, text: spoken(change.text) };
      inserts.set(change.after, [...(inserts.get(change.after) ?? []), line]);
      inserted += 1;
      continue;
    }
    if (missing(change.line, 1)) {
      throw new Error(`Không có câu ${change.line}: kịch bản có ${count} câu.`);
    }
    if (touched.has(change.line)) {
      throw new Error(`Câu ${change.line} được sửa hai lần trong cùng một lần gọi.`);
    }
    touched.add(change.line);
    if (change.op === "delete") {
      deleted.add(change.line);
      continue;
    }
    const old = lines[change.line - 1] as ScriptLine;
    const next = { ...old, ...change.speaker, text: spoken(change.text) };
    if (!sameLine(old, next)) replacements.set(change.line, next);
  }
  const result = [...(inserts.get(0) ?? [])];
  lines.forEach((line, i) => {
    const number = i + 1;
    if (!deleted.has(number)) result.push(replacements.get(number) ?? line);
    result.push(...(inserts.get(number) ?? []));
  });
  if (result.length === 0) {
    throw new Error("Không xóa được câu cuối cùng: kịch bản cần ít nhất một câu thoại.");
  }
  return {
    lines: result,
    replaced: ascending(replacements.keys()),
    inserted,
    deleted: ascending(deleted),
  };
}
