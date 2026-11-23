import type { ScriptLine } from "./ipc";
import type { LivePlan } from "./live-plan";
import {
  readShotList,
  type ShotList,
  type ShotListAnswer,
  type ShotListCaps,
  shotListAnswer,
} from "./shot-list";
import { applyCorrection } from "./shot-list-correction";
import { castOf, coverageErrors, type PlanContext } from "./shot-plan";

type Line = Pick<ScriptLine, "characterId" | "text">;

export const SMALL_EDIT = { lines: 2, shareOfScript: 1 / 3 } as const;

export const isSmallEdit = (changedLines: number, scriptLines: number) =>
  changedLines <= SMALL_EDIT.lines && changedLines <= scriptLines * SMALL_EDIT.shareOfScript;

export type ScriptEdit =
  | { kind: "same" }
  | { kind: "partial"; moved: (number | null)[]; changed: number[] }
  | { kind: "full"; why: "speaker" | "lines" | "last-line" | "cast" | "too-many" };

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const sameLine = (a: Line | undefined, b: Line | undefined) =>
  Boolean(a && b && a.characterId === b.characterId && norm(a.text) === norm(b.text));
const sameCast = (a: Line[], b: Line[]) =>
  castOf(a as ScriptLine[]).join("|") === castOf(b as ScriptLine[]).join("|");

function firstDifference(before: Line[], after: Line[]): number {
  let at = 0;
  while (at < before.length && sameLine(before[at], after[at])) at++;
  return at;
}

function inPlace(before: Line[], after: Line[]): ScriptEdit {
  const changed: number[] = [];
  for (const [i, line] of after.entries()) {
    const old = before[i] as Line;
    if (old.characterId !== line.characterId) return { kind: "full", why: "speaker" };
    if (norm(old.text) !== norm(line.text)) changed.push(i);
  }
  if (!changed.length) return { kind: "same" };
  return { kind: "partial", moved: before.map((_, i) => i), changed };
}

function oneLineMore(before: Line[], after: Line[]): ScriptEdit {
  const at = firstDifference(before, after);
  if (at >= before.length) return { kind: "full", why: "last-line" };
  const rest = before.slice(at).every((line, i) => sameLine(line, after[at + 1 + i]));
  if (!rest) return { kind: "full", why: "lines" };
  return {
    kind: "partial",
    moved: before.map((_, i) => (i < at ? i : i + 1)),
    changed: [at],
  };
}

function oneLineLess(before: Line[], after: Line[]): ScriptEdit {
  const at = firstDifference(after, before);
  if (at >= after.length) return { kind: "full", why: "last-line" };
  const rest = after.slice(at).every((line, i) => sameLine(line, before[at + 1 + i]));
  if (!rest) return { kind: "full", why: "lines" };
  return {
    kind: "partial",
    moved: before.map((_, i) => (i < at ? i : i === at ? null : i - 1)),
    changed: [],
  };
}

export function classifyScriptEdit(before: Line[], after: Line[]): ScriptEdit {
  const edit =
    before.length === after.length
      ? inPlace(before, after)
      : after.length === before.length + 1
        ? oneLineMore(before, after)
        : before.length === after.length + 1
          ? oneLineLess(before, after)
          : ({ kind: "full", why: "lines" } as const);
  if (edit.kind !== "partial") return edit;
  if (!sameCast(before, after)) return { kind: "full", why: "cast" };
  if (!isSmallEdit(edit.changed.length, after.length)) return { kind: "full", why: "too-many" };
  return edit;
}

const letters = (word: string) => word.toLocaleLowerCase("vi").replace(/[^\p{L}\p{N}]/gu, "");
const words = (text: string) => norm(text).split(" ").filter(Boolean);

export function recut(parts: string[], line: string): string[] | null {
  const next = words(line);
  const counts = parts.map((p) => words(p).length);
  const old = parts.flatMap(words);
  if (old.length !== next.length || old.some((w, i) => letters(w) !== letters(next[i] ?? ""))) {
    return null;
  }
  let at = 0;
  const cut = counts.map((count) => {
    const part = next.slice(at, at + count).join(" ");
    at += count;
    return part;
  });
  const checked = coverageErrors(
    cut.map((text) => ({ line: 0, text })),
    [{ characterId: "speaker", speaker: "", text: line }],
  );
  return checked.length ? null : cut;
}

export interface RestageBasis {
  lines: ScriptLine[];
  productIds: string[];
  level: string;
  list: ShotList;
}

export function listFitsPlan(list: ShotList, live: Pick<LivePlan, "keyframes" | "routes">) {
  const ids = (xs: { id: string }[]) =>
    xs
      .map((x) => x.id)
      .sort()
      .join("|");
  return (
    list.routes.length === list.shots.shots.length &&
    list.routes.length === live.routes.length &&
    ids(list.pictures) === ids(live.keyframes) &&
    list.routes.every(
      (r, i) => r.route === live.routes[i]?.route && r.picture === live.routes[i]?.keyframe,
    )
  );
}

export type Restage =
  | { kind: "full"; why: string }
  | { kind: "partial"; previous: ShotListAnswer; open: number[]; changes: string };

type RawShot = NonNullable<ShotListAnswer["shots"]>[number];

function carried(
  previous: ShotListAnswer,
  moved: (number | null)[],
): { answer: ShotListAnswer; removed: number[] } {
  const removed: number[] = [];
  const shots = (previous.shots ?? []).map((shot, i) => {
    const to = moved[Number(shot.line) - 1];
    if (to === null || to === undefined) removed.push(i + 1);
    return { ...shot, line: (to ?? 0) + 1 };
  });
  return { answer: { ...previous, shots }, removed };
}

function recutLines(answer: ShotListAnswer, changed: number[], after: Line[]) {
  const open: number[] = [];
  const shots = [...(answer.shots ?? [])];
  for (const index of changed) {
    const at = shots.flatMap((s, i) => (Number(s.line) === index + 1 ? [i] : []));
    const parts = recut(
      at.map((i) => String(shots[i]?.text ?? "")),
      (after[index] as Line).text,
    );
    if (!at.length || !parts) {
      open.push(index);
      continue;
    }
    at.forEach((i, j) => {
      shots[i] = { ...(shots[i] as RawShot), text: parts[j] as string };
    });
  }
  return { answer: { ...answer, shots }, open };
}

interface Wording {
  before: Line[];
  after: Line[];
  moved: (number | null)[];
  name: (line: Line) => string;
}

function changesText(answer: ShotListAnswer, open: number[], w: Wording): string {
  const shots = answer.shots ?? [];
  return open
    .map((index) => {
      const line = w.after[index] as Line;
      const n = index + 1;
      const now = `"${norm(line.text)}"`;
      const was = w.moved.indexOf(index);
      if (was < 0) {
        const following = shots.filter((s) => Number(s.line) < n).length;
        return `- Line ${n} (${w.name(line)}) is new: ${now}. Add its shots with \`add_shots\`, after shot ${following}.`;
      }
      const own = shots.flatMap((s, i) => (Number(s.line) === n ? [i + 1] : []));
      const before = `"${norm((w.before[was] as Line).text)}"`;
      return `- Line ${n} (${w.name(line)}) now reads: ${now}. Before: ${before}. Its shots in your plan: ${own.join(", ")}; write them again.`;
    })
    .join("\n");
}

export function restagePlan(
  basis: Pick<RestageBasis, "lines" | "list">,
  after: ScriptLine[],
  ctx: PlanContext,
  caps: ShotListCaps,
): Restage {
  const edit = classifyScriptEdit(basis.lines, after);
  if (edit.kind === "full") return { kind: "full", why: edit.why };
  const previous = shotListAnswer(basis.list, ctx);
  if (!previous) return { kind: "full", why: "plan" };
  const fitted = readShotList(previous, { ...ctx, lines: basis.lines }, caps);
  if (fitted.errors.length) return { kind: "full", why: fitted.errors.join(" ") };
  const moved = edit.kind === "same" ? basis.lines.map((_, i) => i) : edit.moved;
  const changed = edit.kind === "same" ? [] : edit.changed;
  const shifted = carried(previous, moved);
  let answer = shifted.answer;
  if (shifted.removed.length) {
    const result = applyCorrection(answer, { remove_shots: shifted.removed });
    if ("unusable" in result) return { kind: "full", why: result.unusable };
    answer = result.answer;
  }
  const recutDone = recutLines(answer, changed, after);
  const names = new Map(ctx.cast.map((c) => [c.id, c.name]));
  const name = (line: Line) => names.get(line.characterId ?? "") ?? "";
  return {
    kind: "partial",
    previous: recutDone.answer,
    open: recutDone.open,
    changes: changesText(recutDone.answer, recutDone.open, {
      before: basis.lines,
      after,
      moved,
      name,
    }),
  };
}

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );

const withoutNumber = ({ n: _, ...shot }: RawShot) => shot;

export function untouchedChanged(
  previous: ShotListAnswer,
  merged: ShotListAnswer,
  open: number[],
): string | null {
  const opened = new Set(open.map((i) => i + 1));
  const kept = (a: ShotListAnswer) =>
    (a.shots ?? []).filter((s) => !opened.has(Number(s.line))).map(withoutNumber);
  const before = kept(previous);
  const now = kept(merged);
  if (canonical(before) !== canonical(now)) {
    return "Only the shots of the changed lines may change; every other shot stays as it was.";
  }
  const pictureOf = (a: ShotListAnswer, id: unknown) =>
    (a.pictures ?? []).find((p) => typeof p.id === "string" && p.id.trim() === id);
  for (const id of new Set(before.map((s) => s.picture).filter(Boolean))) {
    if (canonical(pictureOf(previous, id)) !== canonical(pictureOf(merged, id))) {
      return `Picture "${id}" is used by a shot that does not change; it stays as it was.`;
    }
  }
  return null;
}
