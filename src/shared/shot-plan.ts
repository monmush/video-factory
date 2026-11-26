import { MAX_HOLDS_SEC, syllables } from "./board";
import { withoutCues } from "./cues";
import type { ScriptLine } from "./ipc";
import { cleanSoundText } from "./sound";

export type ShotKind = "speaker" | "listener" | "wide" | "detail";
export type Framing = "medium_close" | "close";
export type Side = "left" | "right" | "centre";
export type Gaze = "frame_right" | "frame_left" | "camera";

export interface PlanSeat {
  characterId: string;
  side: Side;
  looks: Gaze;
  behind: string;
  ambient?: string;
}

export interface PlannedShot {
  kind: ShotKind;
  characterId: string | null;
  framing: Framing | null;
  line: number;
  text: string;
  visual: string;
  productId: string | null;
  why: string;
  hold?: number;
  brief?: string;
  sound?: string;
}

export interface ShotPlan {
  source: "ai" | "rules" | "legacy";
  seats: PlanSeat[];
  props: { name: string; where: string }[];
  stateChanges: { fromShot: number; change: string }[];
  shots: PlannedShot[];
  ambience?: string;
  problems?: string[];
}

export interface PlanContext {
  lines: ScriptLine[];
  cast: { id: string; name: string }[];
  products: { id: string; name: string }[];
  hasPlace: boolean;
}

export function castOf(lines: ScriptLine[]): string[] {
  const ids: string[] = [];
  for (const line of lines) {
    if (line.characterId && !ids.includes(line.characterId)) ids.push(line.characterId);
  }
  return ids;
}

export function seatsFor(cast: string[]): Omit<PlanSeat, "behind">[] {
  if (cast.length === 1)
    return [{ characterId: cast[0] as string, side: "centre", looks: "camera" }];
  return cast.map((characterId, i) => {
    const side: Side = i === 0 ? "left" : i === cast.length - 1 ? "right" : "centre";
    const looks: Gaze =
      side === "left" ? "frame_right" : side === "right" ? "frame_left" : "camera";
    return { characterId, side, looks };
  });
}

export function rulesPlan(ctx: PlanContext, problems?: string[]): ShotPlan {
  const spoken = ctx.lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.characterId && line.text.trim());
  return {
    source: "rules",
    seats: seatsFor(castOf(ctx.lines)).map((s) => ({ ...s, behind: "" })),
    props: [],
    stateChanges: [],
    shots: spoken.map(({ line, index }, i) => ({
      kind: "speaker",
      characterId: line.characterId,
      framing: i === spoken.length - 1 ? "close" : "medium_close",
      line: index,
      text: line.text.trim(),
      visual: "",
      productId: null,
      why: "rules fallback",
      ...(i === spoken.length - 1 ? { hold: LAST_SHOT_MIN_HOLD_SEC } : {}),
    })),
    ...(problems?.length ? { problems } : {}),
  };
}

export const BRIEF_MAX = 300;

export function cleanBrief(raw: unknown): string {
  const text = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= BRIEF_MAX) return text;
  const cut = text.slice(0, BRIEF_MAX);
  const space = cut.lastIndexOf(" ");
  return `${(space > BRIEF_MAX / 2 ? cut.slice(0, space) : cut).trim()}…`;
}

interface RawShot {
  n?: number;
  type?: string;
  character?: string | null;
  framing?: string | null;
  line?: number;
  text?: string;
  visual?: string;
  product?: string | null;
  why?: string;
  hold?: number | null;
  brief?: string | null;
  sound?: string | null;
}
export interface DirectorAnswer {
  ambience?: string | null;
  seats?: { character?: string; behind?: string; ambient?: string | null }[];
  props?: { name?: string; where?: string }[];
  state_changes?: { from_shot?: number; change?: string }[];
  shots?: RawShot[];
}

const KINDS: ShotKind[] = ["speaker", "listener", "wide", "detail"];
const FRAMINGS: Framing[] = ["medium_close", "close"];
const LINE_SPLITS_ONLY_AFTER_PUNCTUATION = /[,.!?…;:]["”']?$/;
const MIN_PART_SYLLABLES = 4;
const HOLD_MIN_SEC = 1;
const HOLD_MAX_SEC = 2;
const LAST_SHOT_MIN_HOLD_SEC = 1;
const AMBIENT_MAX_WORDS = 14;

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const key = (s: string) => norm(s).toLowerCase();
const lookOf = (shot: PlannedShot) => `${shot.kind}|${shot.characterId}|${shot.framing}`;

export function coverageErrors(
  shots: Pick<PlannedShot, "line" | "text">[],
  lines: ScriptLine[],
): string[] {
  const errors: string[] = [];
  for (let i = 1; i < shots.length; i++) {
    if ((shots[i] as PlannedShot).line < (shots[i - 1] as PlannedShot).line) {
      errors.push(`Shot ${i + 1}: shots must follow the dialogue order.`);
      break;
    }
  }
  lines.forEach((line, index) => {
    if (!line.characterId || !line.text.trim()) return;
    const parts = shots.filter((s) => s.line === index);
    const joined = norm(parts.map((p) => p.text).join(" "));
    if (joined !== norm(line.text)) {
      errors.push(
        `Line ${index + 1}: the shots' text must reproduce the line exactly: "${norm(line.text)}".`,
      );
      return;
    }
    if (parts.length < 2) return;
    parts.forEach((part, j) => {
      if (j < parts.length - 1 && !LINE_SPLITS_ONLY_AFTER_PUNCTUATION.test(part.text)) {
        errors.push(
          `Line ${index + 1}: split "${part.text}" only right after a punctuation mark, never inside a phrase.`,
        );
      }
      if (syllables([part]) < MIN_PART_SYLLABLES) {
        errors.push(
          `Line ${index + 1}: "${part.text}" is too short to be its own shot; keep it with its neighbour.`,
        );
      }
    });
  });
  return errors;
}

function noThreeAlikeInARowErrors(shots: PlannedShot[]): string[] {
  const errors: string[] = [];
  for (let i = 2; i < shots.length; i++) {
    const a = shots[i - 2] as PlannedShot;
    const b = shots[i - 1] as PlannedShot;
    const c = shots[i] as PlannedShot;
    if (a.kind !== "detail" && lookOf(a) === lookOf(b) && lookOf(b) === lookOf(c)) {
      errors.push(`Shots ${i - 1}–${i + 1}: three alike in a row; vary the type or framing.`);
    }
  }
  return errors;
}

export function holdErrors(shots: Pick<PlannedShot, "line" | "hold">[]): string[] {
  const errors: string[] = [];
  let total = 0;
  shots.forEach((shot, i) => {
    const last = i === shots.length - 1;
    const hold = shot.hold ?? 0;
    if (hold) {
      if (!Number.isFinite(hold) || hold < HOLD_MIN_SEC || hold > HOLD_MAX_SEC) {
        errors.push(`Shot ${i + 1}: a hold lasts ${HOLD_MIN_SEC} to ${HOLD_MAX_SEC} seconds.`);
      }
      if (!last && shots[i + 1]?.line === shot.line) {
        errors.push(`Shot ${i + 1}: only the shot that ends a line may hold.`);
      }
    }
    total += last ? Math.max(LAST_SHOT_MIN_HOLD_SEC, hold) : Number.isFinite(hold) ? hold : 0;
  });
  if (total > MAX_HOLDS_SEC + 1e-9) {
    errors.push(
      `Holds add up to ${round3(total)} seconds; at most ${MAX_HOLDS_SEC}, the last shot's included.`,
    );
  }
  return errors;
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function namedProduct(text: string, names: readonly string[]): string | null {
  const haystack = ` ${fold(text)} `;
  for (const name of names) {
    const whole = fold(name);
    if (whole && haystack.includes(` ${whole} `)) return name;
  }
  return null;
}

const PACKAGING =
  /\b(packag\w*|packets?|pouch(es)?|sachets?|cartons?|labels?|label+ed|tea ?bags?|gift ?box(es)?)\b/i;

const namedPackaging = (text: string) => PACKAGING.exec(text)?.[0]?.toLowerCase() ?? null;

const sentences = (text: string) => text.split(/(?<=[.!?;])\s+/);

const rulesOut = (sentence: string) => /\b(no|not|never|without|nor|avoid)\b/i.test(sentence);

export const namedInRequest = (text: string, names: readonly string[]): string | null =>
  namedProduct(text, names) ??
  sentences(text)
    .filter((s) => !rulesOut(s))
    .map(namedPackaging)
    .find((w): w is string => Boolean(w)) ??
  null;

export const withoutProducts = (text: string, names: readonly string[]) =>
  sentences(text)
    .filter((sentence) => !namedInRequest(sentence, names))
    .join(" ")
    .trim();

export const productFreeProps = (props: ShotPlan["props"], names: readonly string[]) =>
  props.filter((p) => !propProduct(p.name, p.where, names));

const propProduct = (name: string, where: string, names: readonly string[]) =>
  namedProduct(name, names) ?? namedPackaging(name) ?? namedInRequest(where, names);

export function readDirectorAnswer(
  answer: DirectorAnswer,
  ctx: PlanContext,
): { plan: ShotPlan; errors: string[] } {
  const errors: string[] = [];
  const byName = new Map(ctx.cast.map((c) => [key(c.name), c.id]));
  const productByName = new Map(ctx.products.map((p) => [key(p.name), p.id]));
  const productNames = ctx.products.map((p) => p.name);
  const raw = Array.isArray(answer.shots) ? answer.shots : [];
  if (!raw.length) errors.push("The plan has no shots.");

  const shots: PlannedShot[] = raw.map((s, i) => {
    const n = i + 1;
    const kind = KINDS.includes(s.type as ShotKind) ? (s.type as ShotKind) : null;
    if (!kind) errors.push(`Shot ${n}: type must be one of ${KINDS.join(", ")}.`);
    const lineIndex = Number(s.line) - 1;
    const line = ctx.lines[lineIndex];
    if (!line) errors.push(`Shot ${n}: line ${s.line} does not exist.`);
    const onScreen = kind === "speaker" || kind === "listener";
    const characterId = onScreen ? (byName.get(key(s.character ?? "")) ?? null) : null;
    if (onScreen && !characterId) {
      errors.push(`Shot ${n}: character "${s.character}" is not in the cast.`);
    }
    if (kind === "speaker" && line && characterId && characterId !== line.characterId) {
      errors.push(`Shot ${n}: a speaker shot must show the person saying line ${s.line}.`);
    }
    if (kind === "listener" && line && characterId && characterId === line.characterId) {
      errors.push(`Shot ${n}: a listener shot must show someone other than the speaker.`);
    }
    const framing = onScreen
      ? FRAMINGS.includes(s.framing as Framing)
        ? (s.framing as Framing)
        : "medium_close"
      : null;
    let productId: string | null = null;
    if (kind === "detail" && s.product) {
      productId = productByName.get(key(s.product)) ?? null;
      if (!productId) errors.push(`Shot ${n}: product "${s.product}" is not in this script.`);
    }
    if ((kind === "wide" || (kind === "detail" && !productId)) && !ctx.hasPlace) {
      errors.push(
        `Shot ${n}: there is no place, so only speaker, listener and product shots exist.`,
      );
    }
    const named = productId ? null : namedInRequest(String(s.visual ?? ""), productNames);
    if (named) {
      errors.push(
        `Shot ${n}: only a product detail shot may show or name "${named}"; describe the scene without it.`,
      );
    }
    const hold = s.hold === null || s.hold === undefined ? undefined : Number(s.hold);
    const shot = { kind: kind ?? "speaker", characterId, framing, productId };
    const sound = kind && kind !== "speaker" ? cleanSoundText(s.sound) : "";
    return {
      ...shot,
      line: line ? lineIndex : 0,
      text: norm(String(s.text ?? "")),
      visual: norm(String(s.visual ?? "")),
      why: norm(String(s.why ?? "")),
      ...(hold ? { hold } : {}),
      ...(cleanBrief(s.brief) ? { brief: cleanBrief(s.brief) } : {}),
      ...(sound ? { sound } : {}),
    };
  });

  errors.push(...coverageErrors(shots, ctx.lines));
  errors.push(...holdErrors(shots));

  errors.push(...noThreeAlikeInARowErrors(shots));

  for (const prop of answer.props ?? []) {
    const named = propProduct(prop.name ?? "", prop.where ?? "", productNames);
    if (named) {
      errors.push(
        `Prop "${norm(String(prop.name ?? ""))}": products and their packaging are never props ("${named}").`,
      );
    }
  }

  const behind = new Map<string, string>();
  const ambient = new Map<string, string>();
  for (const seat of answer.seats ?? []) {
    const id = byName.get(key(seat.character ?? ""));
    if (!id) continue;
    behind.set(id, norm(String(seat.behind ?? "")));
    const motion = norm(String(seat.ambient ?? ""));
    if (!motion) continue;
    if (motion.split(" ").length > AMBIENT_MAX_WORDS) {
      errors.push(
        `Seat of ${seat.character}: ambient is one short clause of at most ${AMBIENT_MAX_WORDS} words.`,
      );
    }
    if (namedInRequest(motion, productNames) ?? namedInRequest(seat.behind ?? "", productNames)) {
      errors.push(`Seat of ${seat.character}: a product is never behind anyone.`);
    }
    ambient.set(id, motion);
  }
  const lastShot = shots.at(-1);
  if (lastShot && (lastShot.hold ?? 0) < LAST_SHOT_MIN_HOLD_SEC)
    lastShot.hold = LAST_SHOT_MIN_HOLD_SEC;
  const ambience = cleanSoundText(answer.ambience);
  const plan: ShotPlan = {
    source: "ai",
    seats: seatsFor(ctx.cast.map((c) => c.id)).map((s) => ({
      ...s,
      behind: behind.get(s.characterId) ?? "",
      ...(ambient.get(s.characterId) ? { ambient: ambient.get(s.characterId) } : {}),
    })),
    props: (answer.props ?? [])
      .filter((p) => p.name)
      .map((p) => ({ name: norm(String(p.name)), where: norm(String(p.where ?? "")) })),
    stateChanges: (answer.state_changes ?? [])
      .filter((c) => c.change && Number(c.from_shot) >= 1)
      .map((c) => ({ fromShot: Number(c.from_shot) - 1, change: norm(String(c.change)) })),
    shots,
    ...(ambience ? { ambience } : {}),
  };
  return { plan, errors };
}

export interface Alignment {
  characters: string[];
  characterStartTimesSeconds: number[];
  characterEndTimesSeconds: number[];
}
export interface LineChars {
  start: number;
  end: number;
}

export function partSplits(
  parts: string[],
  span: { start: number; end: number },
  timing?: { alignment: Alignment; chars: LineChars },
): number[] {
  if (parts.length < 2) return [];
  const proportional = () => {
    const counts = parts.map((p) => Math.max(1, syllables([{ text: p }])));
    const total = counts.reduce((a, b) => a + b, 0);
    let acc = 0;
    return counts.slice(0, -1).map((c) => {
      acc += c;
      return span.start + ((span.end - span.start) * acc) / total;
    });
  };
  if (!timing) return proportional();
  const { alignment, chars } = timing;
  const text = alignment.characters.slice(chars.start, chars.end).join("");
  const splits: number[] = [];
  let cursor = 0;
  for (let j = 0; j < parts.length; j++) {
    const part = withoutCues(parts[j] as string);
    const at = text.indexOf(part, cursor);
    if (!part || at < 0) return proportional();
    if (j > 0) {
      let prev = chars.start + at - 1;
      while (prev > chars.start && /\s/.test(alignment.characters[prev] ?? "")) prev--;
      const end = alignment.characterEndTimesSeconds[prev];
      const start = alignment.characterStartTimesSeconds[chars.start + at];
      if (end === undefined || start === undefined) return proportional();
      splits.push((end + start) / 2);
    }
    cursor = at + part.length;
  }
  return splits;
}

export function shotTimes(
  shots: Pick<PlannedShot, "line" | "text">[],
  lineSpans: { start: number; end: number }[],
  totalSec: number,
  timing?: { alignment: Alignment; lineChars: LineChars[] },
): { start: number; end: number }[] {
  const lines = [...new Set(shots.map((s) => s.line))].sort((a, b) => a - b);
  const bounds = new Map<number, { start: number; end: number }>();
  lines.forEach((line, i) => {
    const span = lineSpans[line] ?? { start: 0, end: totalSec };
    const prev = lineSpans[lines[i - 1] ?? -1];
    const next = lineSpans[lines[i + 1] ?? -1];
    bounds.set(line, {
      start: i === 0 ? 0 : prev ? (prev.end + span.start) / 2 : span.start,
      end: i === lines.length - 1 ? totalSec : next ? (span.end + next.start) / 2 : span.end,
    });
  });
  const result: { start: number; end: number }[] = [];
  for (const line of lines) {
    const parts = shots.filter((s) => s.line === line);
    const outer = bounds.get(line) as { start: number; end: number };
    const chars = timing?.lineChars[line];
    const splits = partSplits(
      parts.map((p) => p.text),
      lineSpans[line] ?? outer,
      timing && chars ? { alignment: timing.alignment, chars } : undefined,
    );
    const edges = [outer.start, ...splits, outer.end];
    parts.forEach((_, j) => {
      result.push({ start: round3(edges[j] as number), end: round3(edges[j + 1] as number) });
    });
  }
  return result;
}

export interface HoldInsert {
  line: number;
  at: number;
  sec: number;
}

export function withHolds(
  times: { start: number; end: number }[],
  shots: Pick<PlannedShot, "line" | "hold">[],
): { times: { start: number; end: number }[]; inserts: HoldInsert[] } {
  let offset = 0;
  const inserts: HoldInsert[] = [];
  const held = times.map((time, i) => {
    const hold = shots[i]?.hold ?? 0;
    const start = round3(time.start + offset);
    if (hold > 0) {
      inserts.push({ line: shots[i]?.line ?? 0, at: time.end, sec: hold });
      offset += hold;
    }
    return { start, end: round3(time.end + offset) };
  });
  return { times: held, inserts };
}

export function holdInserts(shots: { line: number; hold?: number; end?: number }[]): HoldInsert[] {
  let offset = 0;
  const inserts: HoldInsert[] = [];
  for (const shot of shots) {
    const hold = shot.hold ?? 0;
    if (!(hold > 0) || shot.end === undefined) continue;
    offset += hold;
    inserts.push({ line: shot.line, at: round3(shot.end - offset), sec: hold });
  }
  return inserts;
}

export const lineOffsets = (lineCount: number, inserts: HoldInsert[]) =>
  Array.from({ length: lineCount }, (_, line) =>
    inserts.filter((h) => h.line < line).reduce((n, h) => n + h.sec, 0),
  );

export const heldSpans = <T extends { start: number; end: number } | undefined>(
  spans: T[],
  offsets: number[],
): T[] =>
  spans.map((span, i) =>
    span
      ? ({ start: span.start + (offsets[i] ?? 0), end: span.end + (offsets[i] ?? 0) } as T)
      : span,
  );

export const estimatePartSec = (text: string, pace: number) => syllables([{ text }]) / pace;

const round3 = (n: number) => Math.round(n * 1000) / 1000;
