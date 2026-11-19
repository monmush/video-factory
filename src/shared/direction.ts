import type { ScriptLine } from "./ipc";
import { spokenLines, type VideoJob } from "./video-job";

export interface DirectionEntry {
  words?: string;
  want: string;
  at: string;
}

export const MAX_DIRECTIONS = 20;
const WANT_MAX = 300;

const norm = (s: unknown) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
const key = (s: unknown) => norm(s).toLocaleLowerCase("vi");

export function setDirection(
  list: readonly DirectionEntry[] | undefined,
  change: { words?: string; want: string; at?: string },
  now: string,
): DirectionEntry[] {
  const words = norm(change.words);
  const want = norm(change.want).slice(0, WANT_MAX);
  const kept = (list ?? []).filter((d) =>
    words
      ? key(d.words) !== key(words)
      : d.words || (change.at ? d.at !== change.at : key(d.want) !== key(want)),
  );
  if (!want) return kept;
  return [...kept, { ...(words ? { words } : {}), want, at: now }].slice(-MAX_DIRECTIONS);
}

export const directionAt = (list: readonly DirectionEntry[] | undefined, words: string) =>
  list?.find((d) => d.words && key(d.words) === key(words));

export function directionSlot(list: readonly DirectionEntry[] | undefined): string {
  if (!list?.length) return "none";
  return list
    .map((d) =>
      d.words ? `- At the words "${d.words}": ${d.want}` : `- For the whole video: ${d.want}`,
    )
    .join("\n");
}

export function anchoredDirection(
  list: readonly DirectionEntry[] | undefined,
  lines: readonly Pick<ScriptLine, "text">[],
): DirectionEntry[] {
  const texts = lines.map((l) => key(l.text));
  return (list ?? []).filter((d) => !d.words || texts.some((t) => t.includes(key(d.words))));
}

const sameLines = (a: readonly ScriptLine[], b: readonly ScriptLine[]) =>
  a.length === b.length &&
  a.every((l, i) => l.characterId === b[i]?.characterId && norm(l.text) === norm(b[i]?.text));

export function jobStale(
  job: Pick<VideoJob, "lines" | "productIds">,
  script: { lines: ScriptLine[]; productIds: string[] },
): boolean {
  if (!sameLines(job.lines, spokenLines(script.lines))) return true;
  if (!job.productIds) return false;
  const a = [...job.productIds].sort().join("|");
  const b = [...script.productIds].sort().join("|");
  return a !== b;
}
