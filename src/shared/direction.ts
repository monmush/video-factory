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

export const sameSpokenLines = (staged: readonly ScriptLine[], script: ScriptLine[]) =>
  sameLines(staged, spokenLines(script));

export const sameProducts = (a: readonly string[], b: readonly string[]) =>
  [...a].sort().join("|") === [...b].sort().join("|");

const wishKeys = (list: readonly DirectionEntry[] | undefined) =>
  (list ?? []).map((d) => `${key(d.words)}\n${key(d.want)}`).sort();

export const sameDirection = (
  a: readonly DirectionEntry[] | undefined,
  b: readonly DirectionEntry[] | undefined,
) => wishKeys(a).join("\n\n") === wishKeys(b).join("\n\n");

export const productChanged = (
  job: Pick<VideoJob, "productIds">,
  script: { productIds: string[] },
) => Boolean(job.productIds && !sameProducts(job.productIds, script.productIds));
