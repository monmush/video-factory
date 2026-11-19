import { MAX_HOLDS_SEC, SPEECH_RATE, syllables } from "./board";
import { withoutCues } from "./cues";
import type { ScriptLine } from "./ipc";

// The shot plan: what the viewer sees while each word is heard
// (docs/DIRECTING_RULES.md). The director (the user's own AI) writes it from
// built-in rules; everything here is pure so the checks, the rules-only
// fallback and the timing are tested.

export type ShotKind = "speaker" | "listener" | "wide" | "detail";
export type Framing = "medium_close" | "close";
export type Side = "left" | "right" | "centre";
export type Gaze = "frame_right" | "frame_left" | "camera";

export interface PlanSeat {
  characterId: string;
  side: Side;
  looks: Gaze;
  /** What is behind this character (English, for the still). */
  behind: string;
  /**
   * One short English clause of gentle motion behind this character
   * ("bamboo leaves stir in a light breeze"), asked of speaking-shot models
   * that take a prompt so the background is not frozen. Optional.
   */
  ambient?: string;
}

export interface PlannedShot {
  kind: ShotKind;
  /** On screen, for speaker and listener. */
  characterId: string | null;
  framing: Framing | null;
  /** 0-based dialogue line. */
  line: number;
  /** Exact words of that line heard during this shot. */
  text: string;
  /** What is in frame (English). */
  visual: string;
  /** For a detail shot of a product: shown from its own photo. */
  productId: string | null;
  /** Rule or reason, for maintainers. */
  why: string;
  /**
   * Seconds of silence after this shot's words before the next line (or the
   * end), so a line can land (C15). Only on a shot that ends its line.
   */
  hold?: number;
  /**
   * What the viewer sees, in plain Vietnamese for the operator, one or two
   * sentences with no shot size (the app shows that). From the director only.
   */
  brief?: string;
}

export interface ShotPlan {
  /** "ai": the director; "rules": built-in fallback; "legacy": jobs made before plans. */
  source: "ai" | "rules" | "legacy";
  seats: PlanSeat[];
  props: { name: string; where: string }[];
  /** From a 0-based shot index on, this stays true in the scene. */
  stateChanges: { fromShot: number; change: string }[];
  shots: PlannedShot[];
  /** Why the director's plan was not used (rules fallback only). */
  problems?: string[];
}

export interface PlanContext {
  lines: ScriptLine[];
  /** Characters with a line, in order of first speaking. */
  cast: { id: string; name: string }[];
  products: { id: string; name: string }[];
  /** A place exists, so wide and generated detail shots can be made. */
  hasPlace: boolean;
}

/** Characters with a line, in order of first speaking. */
export function castOf(lines: ScriptLine[]): string[] {
  const ids: string[] = [];
  for (const line of lines) {
    if (line.characterId && !ids.includes(line.characterId)) ids.push(line.characterId);
  }
  return ids;
}

/**
 * S1/S2, decided by code rather than the AI: the first speaker sits on the
 * left and looks toward frame right, the second sits on the right and looks
 * toward frame left. A single character faces the camera.
 */
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

// ---------------------------------------------------------------------------
// Rules-only plan: used without a place, without text AI, or when the
// director fails twice. Every line is its speaker; eyelines still hold.
// ---------------------------------------------------------------------------

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
      // The ending never cuts off at once (C15).
      ...(i === spoken.length - 1 ? { hold: LAST_HOLD_SEC } : {}),
    })),
    ...(problems?.length ? { problems } : {}),
  };
}

// ---------------------------------------------------------------------------
// Briefs: what the viewer sees, in the operator's words.
// ---------------------------------------------------------------------------

/** Longest brief kept (the director is asked for 10 to 30 words). */
export const BRIEF_MAX = 300;

/** The director's brief, one line and capped; "" when none. */
export function cleanBrief(raw: unknown): string {
  const text = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= BRIEF_MAX) return text;
  const cut = text.slice(0, BRIEF_MAX);
  const space = cut.lastIndexOf(" ");
  return `${(space > BRIEF_MAX / 2 ? cut.slice(0, space) : cut).trim()}…`;
}

// ---------------------------------------------------------------------------
// The director's answer → a plan, with mechanical checks.
// ---------------------------------------------------------------------------

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
}
export interface DirectorAnswer {
  seats?: { character?: string; behind?: string; ambient?: string | null }[];
  props?: { name?: string; where?: string }[];
  state_changes?: { from_shot?: number; change?: string }[];
  shots?: RawShot[];
}

const KINDS: ShotKind[] = ["speaker", "listener", "wide", "detail"];
const FRAMINGS: Framing[] = ["medium_close", "close"];
/** A line may only be split right after one of these. */
const SPLIT_AFTER = /[,.!?…;:]["”']?$/;
/** Shortest part of a split line, in spoken syllables. */
export const MIN_PART_SYLLABLES = 4;
/** A hold lasts this long at least and at most (C15). */
export const HOLD_MIN_SEC = 1;
export const HOLD_MAX_SEC = 2;
/** The last shot always holds at least this long, so the video never ends on the last syllable. */
export const LAST_HOLD_SEC = 1;
/** Longest ambient clause, in words. */
export const AMBIENT_MAX_WORDS = 14;

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const key = (s: string) => norm(s).toLowerCase();
const same = (shot: PlannedShot) => `${shot.kind}|${shot.characterId}|${shot.framing}`;

/**
 * C1, the rule no plan may break: shots follow the dialogue, each line's
 * parts join to the line exactly, a line is split only after punctuation,
 * and no part is too short to be a shot.
 */
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
      if (j < parts.length - 1 && !SPLIT_AFTER.test(part.text)) {
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

/**
 * C15, holds: each between 1 and 2 seconds, only on the shot that ends its
 * line, all together (the last shot's minimum included) no more than
 * MAX_HOLDS_SEC.
 */
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
    total += last ? Math.max(LAST_HOLD_SEC, hold) : Number.isFinite(hold) ? hold : 0;
  });
  if (total > MAX_HOLDS_SEC + 1e-9) {
    errors.push(
      `Holds add up to ${round3(total)} seconds; at most ${MAX_HOLDS_SEC}, the last shot's included.`,
    );
  }
  return errors;
}

/** Lowercase, no accents, words only: "Bạch Trà" → "bach tra". */
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * The product a text names, if any: its whole name, or any two of its words
 * in a row, with or without accents ("Shan Tuyet tea" names "Bạch Trà Shan
 * Tuyết"). Products are never generated, so a still request may not name one.
 */
export function namedProduct(text: string, names: readonly string[]): string | null {
  const haystack = ` ${fold(text)} `;
  for (const name of names) {
    const words = fold(name).split(" ").filter(Boolean);
    const phrases =
      words.length < 3
        ? [words.join(" ")]
        : words.slice(0, -1).map((w, i) => `${w} ${words[i + 1]}`);
    if (phrases.some((p) => p && haystack.includes(` ${p} `))) return name;
  }
  return null;
}

/** Words that only ever mean a product's packaging, whatever the product. */
const PACKAGING =
  /\b(packag\w*|packets?|pouch(es)?|sachets?|cartons?|labels?|label+ed|tea ?bags?|gift ?box(es)?)\b/i;

/** The packaging word a text uses, if any ("pouch", "label"). */
export const namedPackaging = (text: string) => PACKAGING.exec(text)?.[0]?.toLowerCase() ?? null;

/** A product by name, or packaging by kind: what a generated still may never show. */
const namesProduct = (text: string, names: readonly string[]) =>
  namedProduct(text, names) ?? namedPackaging(text);

/** The text without its sentences that name a product or packaging. */
export const withoutProducts = (text: string, names: readonly string[]) =>
  text
    .split(/(?<=[.!?;])\s+/)
    .filter((sentence) => !namesProduct(sentence, names))
    .join(" ")
    .trim();

/** Props a still may show: never a product or its packaging. */
export const productFreeProps = (props: ShotPlan["props"], names: readonly string[]) =>
  props.filter((p) => !namesProduct(`${p.name} ${p.where}`, names));

/**
 * Turns the director's JSON into a plan (names → ids, 1-based → 0-based) and
 * lists every rule it breaks that a machine can check. An empty list means
 * the plan can be used.
 */
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
    const named = productId ? null : namesProduct(String(s.visual ?? ""), productNames);
    if (named) {
      errors.push(
        `Shot ${n}: only a product detail shot may show or name "${named}"; describe the scene without it.`,
      );
    }
    const hold = s.hold === null || s.hold === undefined ? undefined : Number(s.hold);
    const shot = { kind: kind ?? "speaker", characterId, framing, productId };
    return {
      ...shot,
      line: line ? lineIndex : 0,
      text: norm(String(s.text ?? "")),
      visual: norm(String(s.visual ?? "")),
      why: norm(String(s.why ?? "")),
      ...(hold ? { hold } : {}),
      // Never a rule error: a shot without one shows "Chưa có mô tả".
      ...(cleanBrief(s.brief) ? { brief: cleanBrief(s.brief) } : {}),
    };
  });

  errors.push(...coverageErrors(shots, ctx.lines));
  errors.push(...holdErrors(shots));

  // No fixed opening, closing or wide shot (19 Nov 2026): the director decides
  // case by case how the video opens, ends and shows the place (C2, C3).
  // C9: no more than two alike in a row.
  for (let i = 2; i < shots.length; i++) {
    const a = shots[i - 2] as PlannedShot;
    const b = shots[i - 1] as PlannedShot;
    const c = shots[i] as PlannedShot;
    if (a.kind !== "detail" && same(a) === same(b) && same(b) === same(c)) {
      errors.push(`Shots ${i - 1}–${i + 1}: three alike in a row; vary the type or framing.`);
    }
  }

  // S4: products are never props, so no still is ever asked to draw one.
  for (const prop of answer.props ?? []) {
    const named = namesProduct(`${prop.name ?? ""} ${prop.where ?? ""}`, productNames);
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
    if (namesProduct(`${motion} ${seat.behind ?? ""}`, productNames)) {
      errors.push(`Seat of ${seat.character}: a product is never behind anyone.`);
    }
    ambient.set(id, motion);
  }
  // C15: the ending always lands.
  const lastShot = shots.at(-1);
  if (lastShot && (lastShot.hold ?? 0) < LAST_HOLD_SEC) lastShot.hold = LAST_HOLD_SEC;
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
  };
  return { plan, errors };
}

// ---------------------------------------------------------------------------
// Timing: where each shot starts and ends in the whole dialogue.
// ---------------------------------------------------------------------------

/** Per-character timing for the whole dialogue, as the voice provider returns it. */
export interface Alignment {
  characters: string[];
  characterStartTimesSeconds: number[];
  characterEndTimesSeconds: number[];
}
/** One line's place in the alignment (characters [start, end)). */
export interface LineChars {
  start: number;
  end: number;
}

/**
 * The moments inside one line where its parts meet: from the provider's
 * character timing when the part can be found, else in proportion to
 * syllables across the line's span.
 */
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
    // Sounds like "[cười]" are voiced as tags the timing may spell differently.
    const part = withoutCues(parts[j] as string);
    const at = text.indexOf(part, cursor);
    if (!part || at < 0) return proportional();
    if (j > 0) {
      // Between the last spoken character before this part and its first one.
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

/**
 * Every shot's [start, end) in the dialogue. The shots tile the whole audio
 * with no gap: a cut between lines sits midway through the pause, the first
 * shot starts at 0 and the last ends with the audio.
 */
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

// ---------------------------------------------------------------------------
// Holds (C15): silence after a line so it lands. The voice is never asked
// again: the silence is inserted locally into the saved dialogue, so the
// video's timeline is the voice's with every hold added after its line.
// ---------------------------------------------------------------------------

/** Silence inserted after `line`, at `at` seconds of the voice's own timeline. */
export interface HoldInsert {
  line: number;
  at: number;
  sec: number;
}

/**
 * Shot times on the video's timeline: each hold lengthens its shot by its
 * seconds of silence and moves every later shot by as much. `times` are the
 * voice's own (shotTimes).
 */
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

/** The silences a job's shot times (already on the video's timeline) were laid out with. */
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

/** Seconds every line moves on the video's timeline: the holds of the lines before it. */
export const lineOffsets = (lineCount: number, inserts: HoldInsert[]) =>
  Array.from({ length: lineCount }, (_, line) =>
    inserts.filter((h) => h.line < line).reduce((n, h) => n + h.sec, 0),
  );

/** Line spans moved onto the video's timeline. */
export const heldSpans = <T extends { start: number; end: number } | undefined>(
  spans: T[],
  offsets: number[],
): T[] =>
  spans.map((span, i) =>
    span
      ? ({ start: span.start + (offsets[i] ?? 0), end: span.end + (offsets[i] ?? 0) } as T)
      : span,
  );

/** The voice's character timing moved onto the video's timeline, line by line. */
export function heldTiming(
  timing: { alignment: Alignment; lineChars: LineChars[] },
  offsets: number[],
): { alignment: Alignment; lineChars: LineChars[] } {
  const shift = timing.alignment.characters.map(() => 0);
  timing.lineChars.forEach((chars, line) => {
    for (let c = chars.start; c < chars.end; c++) shift[c] = offsets[line] ?? 0;
  });
  return {
    lineChars: timing.lineChars,
    alignment: {
      characters: timing.alignment.characters,
      characterStartTimesSeconds: timing.alignment.characterStartTimesSeconds.map(
        (t, c) => t + (shift[c] ?? 0),
      ),
      characterEndTimesSeconds: timing.alignment.characterEndTimesSeconds.map(
        (t, c) => t + (shift[c] ?? 0),
      ),
    },
  };
}

/** Estimated seconds of a part before the voice exists. */
export const estimatePartSec = (text: string) => syllables([{ text }]) / SPEECH_RATE;

const round3 = (n: number) => Math.round(n * 1000) / 1000;
