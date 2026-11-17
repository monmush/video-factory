import type { ScriptLine } from "./ipc";
import { spokenLines, type VideoJob } from "./video-job";

// The operator's direction (docs/PLAN_PHASE_PROPOSAL.md): what they want at a
// moment of the video, in their own words, kept on the job and given to the
// director whenever it plans. A wish names the exact words of the shot it was
// written on, so it still finds its moment when the plan is made again; one
// without words is for the whole video. Pure, so it is tested.

export interface DirectionEntry {
  /** The exact words of the shot it was written on; absent: the whole video. */
  words?: string;
  want: string;
  at: string;
}

export const MAX_DIRECTIONS = 20;
/** Longest wish kept. */
export const WANT_MAX = 300;

const norm = (s: unknown) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
const key = (s: unknown) => norm(s).toLocaleLowerCase("vi");

/**
 * The list with one wish saved. At a shot's words it replaces the wish there;
 * an empty `want` removes it. A whole-video wish is added (the same text once);
 * `at` names the whole-video wish it replaces or, with an empty `want`, removes.
 * The newest are kept when there are too many.
 */
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

/** The wish written on a shot with these words, if any. */
export const directionAt = (list: readonly DirectionEntry[] | undefined, words: string) =>
  list?.find((d) => d.words && key(d.words) === key(words));

/** The `{{direction}}` slot of the shot-list prompt. */
export function directionSlot(list: readonly DirectionEntry[] | undefined): string {
  if (!list?.length) return "none";
  return list
    .map((d) =>
      d.words ? `- At the words "${d.words}": ${d.want}` : `- For the whole video: ${d.want}`,
    )
    .join("\n");
}

/** Wishes that still find their moment in these lines; whole-video ones always do. */
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

/**
 * Whether a job no longer fits its script: the lines it would voice, or the
 * products, changed since it was made. Products are only compared on jobs that
 * recorded them. The caller decides whether the job may still change.
 */
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
