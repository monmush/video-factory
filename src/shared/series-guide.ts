import { clampTarget, DEFAULT_TARGET_SEC } from "./board";
import type { Series } from "./ipc";

export const GUIDE_SLOTS = [
  "people",
  "story",
  "tone",
  "closing",
  "look",
  "never",
  "other",
] as const;
export type GuideSlot = (typeof GUIDE_SLOTS)[number];

export const PRODUCT_MENTIONS = ["none", "natural", "closing"] as const;
export type ProductMention = (typeof PRODUCT_MENTIONS)[number];

export interface GuideLine {
  text: string;
  guessed?: true;
}

export interface GuideQuestion {
  id: string;
  slot: GuideSlot;
  ask: string;
  options: { label: string; text: string }[];
}

export interface SeriesGuide {
  lines: Partial<Record<GuideSlot, GuideLine>>;
  productMention: ProductMention;
  productMentionGuessed?: true;
  targetSec: number;
  targetSecGuessed?: true;
  castMentioned?: number;
  questions?: GuideQuestion[];
  confirmedAt?: string;
}

export interface GuideEdit {
  lines?: Partial<Record<GuideSlot, string>>;
  productMention?: ProductMention;
  targetSec?: number;
  confirm?: boolean;
}

export const GUIDE_SLOT_LABEL: Record<GuideSlot, string> = {
  people: "Nhân vật",
  story: "Câu chuyện",
  tone: "Giọng điệu",
  closing: "Câu kết",
  look: "Hình và nhịp",
  never: "Tránh",
  other: "Khác",
};

export const PRODUCT_MENTION_LABEL: Record<ProductMention, string> = {
  none: "Không nhắc",
  natural: "Nhắc tự nhiên",
  closing: "Giới thiệu cuối video",
};

export const GUIDE_LENGTH_CHOICES = [15, 30, 45, 60] as const;

export const GUIDE_LINE_MAX = 4000;
const MAX_QUESTIONS = 2;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 3;

const cleanText = (value: unknown) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, GUIDE_LINE_MAX) : "";

const cleanParagraphs = (value: unknown) =>
  typeof value === "string"
    ? value
        .split("\n")
        .map((line) => line.replace(/\s+/g, " ").trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, GUIDE_LINE_MAX)
    : "";

const isSlot = (value: unknown): value is GuideSlot =>
  typeof value === "string" && (GUIDE_SLOTS as readonly string[]).includes(value);

const isMention = (value: unknown): value is ProductMention =>
  typeof value === "string" && (PRODUCT_MENTIONS as readonly string[]).includes(value);

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function lineFromAnswer(value: unknown): GuideLine | null {
  const raw = typeof value === "string" ? { text: value } : record(value);
  const text = cleanParagraphs(raw.text);
  if (!text) return null;
  return raw.guessed === true ? { text, guessed: true } : { text };
}

function questionFromAnswer(value: unknown): Omit<GuideQuestion, "id"> | null {
  const raw = record(value);
  const ask = cleanText(raw.ask);
  if (!isSlot(raw.slot) || !ask) return null;
  const options = (Array.isArray(raw.options) ? raw.options : [])
    .map((o) => ({ label: cleanText(record(o).label), text: cleanParagraphs(record(o).text) }))
    .filter((o) => o.label && o.text)
    .slice(0, MAX_OPTIONS);
  if (options.length < MIN_OPTIONS) return null;
  return { slot: raw.slot, ask, options };
}

function targetFromAnswer(value: unknown): number | null {
  return typeof value === "number" || typeof value === "string" ? clampTarget(value) : null;
}

export function guideFromAnswer(answer: unknown): { guide: SeriesGuide; title: string } {
  const raw = record(answer);
  const lines: SeriesGuide["lines"] = {};
  for (const slot of GUIDE_SLOTS) {
    const line = lineFromAnswer(raw[slot]);
    if (line) lines[slot] = line;
  }
  if (Object.keys(lines).length === 0) throw new Error("AI không trả về định hướng");
  const targetSec = targetFromAnswer(raw.targetSec);
  const mentionKnown = isMention(raw.productMention);
  const questions = (Array.isArray(raw.questions) ? raw.questions : [])
    .flatMap((q) => questionFromAnswer(q) ?? [])
    .slice(0, MAX_QUESTIONS)
    .map((q, i) => ({ id: `q${i + 1}`, ...q }));
  const cast = raw.castMentioned;
  const guide: SeriesGuide = {
    lines,
    productMention: mentionKnown ? (raw.productMention as ProductMention) : "natural",
    ...(!mentionKnown || raw.productMentionGuessed === true
      ? { productMentionGuessed: true as const }
      : {}),
    targetSec: targetSec ?? DEFAULT_TARGET_SEC,
    ...(targetSec === null ? { targetSecGuessed: true as const } : {}),
    ...(typeof cast === "number" && Number.isInteger(cast) && cast >= 0
      ? { castMentioned: cast }
      : {}),
    ...(questions.length ? { questions } : {}),
  };
  return { guide, title: cleanText(raw.title) };
}

export function guideFromText(guidance: string): SeriesGuide {
  const story = cleanParagraphs(guidance);
  return {
    lines: story ? { story: { text: story } } : {},
    productMention: "natural",
    targetSec: DEFAULT_TARGET_SEC,
  };
}

const filledLines = (guide: SeriesGuide) =>
  GUIDE_SLOTS.flatMap((slot) => {
    const text = guide.lines[slot]?.text.trim();
    return text ? [{ slot, text }] : [];
  });

export function directionText(series: Pick<Series, "guide" | "guidance">): string {
  if (!series.guide) return series.guidance.trim();
  return filledLines(series.guide)
    .map(({ slot, text }) => `${GUIDE_SLOT_LABEL[slot]}: ${text}`)
    .join("\n");
}

const SUMMARY_ORDER: readonly GuideSlot[] = [
  "story",
  "people",
  "tone",
  ...GUIDE_SLOTS.filter((s) => s !== "story" && s !== "people" && s !== "tone"),
];

export function summaryLine(series: Pick<Series, "guide" | "guidance">): string {
  const { guide } = series;
  if (!guide)
    return (
      series.guidance
        .split("\n")
        .find((line) => line.trim())
        ?.trim() ?? ""
    );
  for (const slot of SUMMARY_ORDER) {
    const text = guide.lines[slot]?.text.trim();
    if (text) return text;
  }
  return "";
}

export function directionStates(guide: SeriesGuide | undefined): {
  storyOrTone: boolean;
  closing: boolean;
} {
  const has = (slot: GuideSlot) => Boolean(guide?.lines[slot]?.text.trim());
  return { storyOrTone: has("story") || has("tone"), closing: has("closing") };
}

export function effectiveMention(
  guide: SeriesGuide | undefined,
  productCount: number,
): ProductMention {
  if (productCount === 0) return "none";
  return guide?.productMention ?? "natural";
}

export const seriesTargetSec = (series: Pick<Series, "guide">) =>
  series.guide?.targetSec ?? DEFAULT_TARGET_SEC;

export const missingCast = (guide: SeriesGuide | undefined, castCount: number) =>
  Math.max(0, (guide?.castMentioned ?? 0) - castCount);

function withoutQuestionsOn(guide: SeriesGuide, slot: GuideSlot): SeriesGuide {
  const questions = guide.questions?.filter((q) => q.slot !== slot) ?? [];
  const { questions: _dropped, ...rest } = guide;
  return questions.length ? { ...rest, questions } : rest;
}

function withLine(guide: SeriesGuide, slot: GuideSlot, text: string): SeriesGuide {
  const lines = { ...guide.lines };
  if (text) lines[slot] = { text };
  else delete lines[slot];
  return withoutQuestionsOn({ ...guide, lines }, slot);
}

export function editGuide(guide: SeriesGuide, edit: GuideEdit): SeriesGuide {
  let next: SeriesGuide = guide;
  for (const [slot, value] of Object.entries(record(edit.lines))) {
    if (!isSlot(slot) || typeof value !== "string") continue;
    const text = cleanParagraphs(value);
    if (text === (next.lines[slot]?.text ?? "")) continue;
    next = withLine(next, slot, text);
  }
  if (isMention(edit.productMention) && edit.productMention !== next.productMention) {
    const { productMentionGuessed: _guess, ...rest } = next;
    next = { ...rest, productMention: edit.productMention };
  }
  const targetSec = clampTarget(edit.targetSec);
  if (targetSec !== null && targetSec !== next.targetSec) {
    const { targetSecGuessed: _guess, ...rest } = next;
    next = { ...rest, targetSec };
  }
  return next;
}

export function confirmGuide(guide: SeriesGuide, now: string): SeriesGuide {
  const lines: SeriesGuide["lines"] = {};
  for (const slot of GUIDE_SLOTS) {
    const text = guide.lines[slot]?.text;
    if (text) lines[slot] = { text };
  }
  const {
    productMentionGuessed: _mention,
    targetSecGuessed: _target,
    questions: _questions,
    ...rest
  } = guide;
  return { ...rest, lines, confirmedAt: now };
}

export function answerQuestion(
  guide: SeriesGuide,
  questionId: string,
  optionIndex: number | null,
): SeriesGuide {
  const question = guide.questions?.find((q) => q.id === questionId);
  if (!question) return guide;
  if (optionIndex !== null) {
    const option = question.options[optionIndex];
    if (!option) throw new Error("Không có lựa chọn này");
    return withLine(guide, question.slot, option.text);
  }
  const questions = guide.questions?.filter((q) => q.id !== questionId) ?? [];
  const { questions: _dropped, ...rest } = guide;
  return questions.length ? { ...rest, questions } : rest;
}
