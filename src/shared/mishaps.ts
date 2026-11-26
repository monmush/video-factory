export const MISHAP_KINDS = [
  "lettering",
  "packaging",
  "people",
  "gaze",
  "cut",
  "cut-kept",
  "silent",
  "too-long",
  "refused",
  "error",
  "timeout",
  "app",
  "still-instead",
  "simpler",
] as const;

export type MishapKind = (typeof MISHAP_KINDS)[number];

export interface Mishap {
  kind: MishapKind;
  at: string;
  model?: string;
}

export interface WithMishaps {
  mishaps?: Mishap[];
}

export function withMishaps<T extends WithMishaps>(
  item: T,
  kinds: readonly MishapKind[],
  at: string,
  model?: string,
): T {
  if (!kinds.length) return item;
  const added = kinds.map((kind) => ({ kind, at, ...(model ? { model } : {}) }));
  return { ...item, mishaps: [...(item.mishaps ?? []), ...added] };
}

export const NO_SPEECH_HEARD = "Không nghe thấy lời nói trong cảnh quay";
export const SPEECH_CUT_OFF = "Lời nói bị cắt ở cuối";
export const TOO_LONG_TO_SAY = "Câu thoại dài quá mức tạo được";
const TIMED_OUT = /phút không có kết quả/;
const REFUSED =
  /content[ _-]?policy|moderat|nsfw|safety|flagged|inappropriate|not allowed|prohibited|violat|refus/i;

export function mishapOfMessage(message: string): MishapKind {
  if (message === SPEECH_CUT_OFF) return "cut";
  if (message === NO_SPEECH_HEARD) return "silent";
  if (message === TOO_LONG_TO_SAY) return "too-long";
  if (TIMED_OUT.test(message)) return "timeout";
  if (REFUSED.test(message)) return "refused";
  return "error";
}

export function mishapOfError(error: unknown): MishapKind {
  const message = error instanceof Error ? error.message : String(error);
  const answeredByTheProvider = typeof (error as { status?: unknown })?.status === "number";
  return answeredByTheProvider || REFUSED.test(message) ? mishapOfMessage(message) : "app";
}

const STILL_PROBLEMS: readonly [RegExp, MishapKind][] = [
  [/^unexpected text/, "lettering"],
  [/^packaging/, "packaging"],
  [/people/, "people"],
  [/^looks/, "gaze"],
];

export function stillProblemMishaps(problem: string): MishapKind[] {
  const kinds = problem
    .split(";")
    .map((part) => part.trim())
    .flatMap((part) => STILL_PROBLEMS.find(([pattern]) => pattern.test(part))?.[1] ?? []);
  return [...new Set(kinds)];
}

const times = (n: number | undefined, kind: MishapKind): MishapKind[] =>
  Array.from({ length: Math.max(0, n ?? 0) }, () => kind);

function failuresOf(failures: number, error: string | undefined): MishapKind[] {
  if (failures <= 0) return [];
  const last = error ? mishapOfMessage(error) : "error";
  return [...times(failures - 1, "error"), last];
}

const entries = (kinds: readonly MishapKind[], at: string, model?: string): Mishap[] =>
  kinds.map((kind) => ({ kind, at, ...(model ? { model } : {}) }));

export function frameMishapsFromCounters(
  frame: { redone?: boolean; check?: string; fallback?: boolean; retried: boolean; error?: string },
  at: string,
  model: string,
): Mishap[] {
  const redrawn = frame.redone && frame.check ? stillProblemMishaps(frame.check) : [];
  const failed = failuresOf((frame.retried ? 1 : 0) + (frame.error ? 1 : 0), frame.error);
  return entries(
    [...redrawn, ...failed, ...(frame.fallback ? ["simpler" as const] : [])],
    at,
    model,
  );
}

export function shotMishapsFromCounters(
  shot: { rejectedClips?: number; failures: number; error?: string; fallback?: boolean },
  at: string,
  model?: string,
): Mishap[] {
  return entries(
    [
      ...times(shot.rejectedClips, "lettering"),
      ...failuresOf(shot.failures, shot.error),
      ...(shot.fallback ? ["still-instead" as const] : []),
    ],
    at,
    model,
  );
}

export function segmentMishapsFromCounters(
  seg: {
    rejectedClips?: number;
    rejectedModels?: string[];
    cutOffs?: number;
    failures: number;
    error?: string;
  },
  at: string,
): Mishap[] {
  const lettering = times(seg.rejectedClips, "lettering").map((kind, i) => ({
    kind,
    at,
    ...(seg.rejectedModels?.[i] ? { model: seg.rejectedModels[i] } : {}),
  }));
  const cutOffs = seg.cutOffs ?? 0;
  const lastOther = seg.error === SPEECH_CUT_OFF ? undefined : seg.error;
  const others = failuresOf(seg.failures - cutOffs, lastOther);
  return [...lettering, ...entries([...times(cutOffs, "cut"), ...others], at)];
}

export function withMishapsFromCounters<T extends WithMishaps>(
  item: T,
  derive: (item: T) => Mishap[],
): T {
  if (item.mishaps) return item;
  const derived = derive(item);
  return derived.length ? { ...item, mishaps: derived } : item;
}
