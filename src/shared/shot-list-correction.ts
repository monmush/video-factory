import type { ShotListAnswer } from "./shot-list";

type RawShot = NonNullable<ShotListAnswer["shots"]>[number];
type RawPicture = NonNullable<ShotListAnswer["pictures"]>[number];

export interface ShotListCorrection {
  pictures?: RawPicture[];
  remove_pictures?: string[];
  shots?: (RawShot & { n?: number })[];
  add_shots?: (RawShot & { after?: number })[];
  remove_shots?: number[];
  seats?: ShotListAnswer["seats"];
  props?: ShotListAnswer["props"];
  state_changes?: ShotListAnswer["state_changes"];
  ambience?: ShotListAnswer["ambience"];
}

const WHOLE_FIELDS = ["seats", "props", "state_changes", "ambience"] as const;
const KNOWN_KEYS = new Set<string>([
  "pictures",
  "remove_pictures",
  "shots",
  "add_shots",
  "remove_shots",
  ...WHOLE_FIELDS,
]);

export type CorrectionResult = { answer: ShotListAnswer } | { unusable: string };

class Unusable extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function listOf<T>(value: unknown, field: string, check: (item: unknown) => item is T): T[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every(check)) {
    throw new Unusable(`"${field}" is not a list of the expected entries.`);
  }
  return value;
}

const isShotNumber = (count: number, from: number) => (v: unknown) =>
  Number.isInteger(v) && (v as number) >= from && (v as number) <= count;

function pictureIdOf(p: unknown): string {
  return isObject(p) && typeof p.id === "string" ? p.id.trim() : "";
}

function correctedPictures(previous: RawPicture[], c: ShotListCorrection): RawPicture[] {
  const known = new Set(previous.map(pictureIdOf));
  const removed = listOf(c.remove_pictures, "remove_pictures", (v): v is string =>
    known.has(typeof v === "string" ? v.trim() : ""),
  ).map((id) => id.trim());
  const written = listOf(c.pictures, "pictures", (v): v is RawPicture => Boolean(pictureIdOf(v)));
  const byId = new Map<string, RawPicture>();
  for (const p of written) {
    const id = pictureIdOf(p);
    if (byId.has(id)) throw new Unusable(`Picture "${id}" is written twice.`);
    if (removed.includes(id)) throw new Unusable(`Picture "${id}" is both written and removed.`);
    byId.set(id, p);
  }
  const kept = previous
    .filter((p) => !removed.includes(pictureIdOf(p)))
    .map((p) => byId.get(pictureIdOf(p)) ?? p);
  const added = written.filter((p) => !known.has(pictureIdOf(p)));
  const masters = added.filter((p) => p.kind === "master");
  return [...masters, ...kept, ...added.filter((p) => p.kind !== "master")];
}

function correctedShots(
  previous: RawShot[],
  c: ShotListCorrection,
): { shots: RawShot[]; newNumber: (old: number) => number | null } {
  const count = previous.length;
  const removed = new Set(
    listOf(c.remove_shots, "remove_shots", (v): v is number => isShotNumber(count, 1)(v)),
  );
  const replaced = new Map<number, RawShot>();
  for (const s of listOf(c.shots, "shots", (v): v is RawShot & { n: number } =>
    isObject(v) ? isShotNumber(count, 1)(v.n) : false,
  )) {
    if (replaced.has(s.n)) throw new Unusable(`Shot ${s.n} is written twice.`);
    if (removed.has(s.n)) throw new Unusable(`Shot ${s.n} is both written and removed.`);
    replaced.set(s.n, s);
  }
  const added = listOf(c.add_shots, "add_shots", (v): v is RawShot & { after: number } =>
    isObject(v) ? isShotNumber(count, 0)(v.after) : false,
  );
  const shots: RawShot[] = [];
  const position = new Map<number, number>();
  const addAfter = (n: number) => {
    for (const { after: _, ...shot } of added.filter((a) => a.after === n)) shots.push(shot);
  };
  addAfter(0);
  previous.forEach((shot, i) => {
    const n = i + 1;
    if (!removed.has(n)) {
      position.set(n, shots.length + 1);
      shots.push(replaced.get(n) ?? shot);
    }
    addAfter(n);
  });
  const newNumber = (old: number) => {
    for (let n = old; n <= count; n++) {
      const at = position.get(n);
      if (at) return at;
    }
    return null;
  };
  return { shots: shots.map((s, i) => ({ ...s, n: i + 1 })), newNumber };
}

function renumberedStateChanges(
  changes: ShotListAnswer["state_changes"],
  newNumber: (old: number) => number | null,
): ShotListAnswer["state_changes"] {
  return (changes ?? []).flatMap((change) => {
    const at = newNumber(Number(change.from_shot));
    return at ? [{ ...change, from_shot: at }] : [];
  });
}

export function applyCorrection(previous: ShotListAnswer, correction: unknown): CorrectionResult {
  try {
    if (!isObject(correction)) throw new Unusable("The correction is not a JSON object.");
    const unknown = Object.keys(correction).filter((k) => !KNOWN_KEYS.has(k));
    if (unknown.length) throw new Unusable(`Unknown fields: ${unknown.join(", ")}.`);
    if (!Object.keys(correction).length) throw new Unusable("The correction changes nothing.");
    const c = correction as ShotListCorrection;
    const pictures = correctedPictures(previous.pictures ?? [], c);
    const { shots, newNumber } = correctedShots(previous.shots ?? [], c);
    const answer: ShotListAnswer = { ...previous, pictures, shots };
    for (const field of WHOLE_FIELDS) {
      if (field in c) Object.assign(answer, { [field]: c[field] });
    }
    if (!("state_changes" in c) && previous.state_changes) {
      answer.state_changes = renumberedStateChanges(previous.state_changes, newNumber);
    }
    return { answer };
  } catch (error) {
    if (error instanceof Unusable) return { unusable: error.message };
    throw error;
  }
}
