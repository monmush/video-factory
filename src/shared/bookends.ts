import { isSafeSegment } from "./safe-segment";

export const BOOKEND_SLOTS = ["intro", "outro"] as const;

export type BookendSlot = (typeof BOOKEND_SLOTS)[number];

export interface Bookend {
  file: string;
  seconds: number;
}

export type SeriesBookends = Partial<Record<BookendSlot, Bookend>>;

export type BookendChange = { staged: string } | null;

export type BookendChanges = Partial<Record<BookendSlot, BookendChange>>;

export interface StagedBookend {
  id: string;
  url: string;
  seconds: number;
}

export const BOOKEND_MAX_SEC = 60;

export const BOOKEND_LABEL: Record<BookendSlot, string> = { intro: "Intro", outro: "Outro" };

const isBookend = (raw: unknown): raw is Bookend => {
  const given = (raw ?? {}) as Record<string, unknown>;
  return (
    isSafeSegment(given.file) &&
    typeof given.seconds === "number" &&
    Number.isFinite(given.seconds) &&
    given.seconds > 0
  );
};

export function seriesBookends(raw: unknown): SeriesBookends | undefined {
  const given = (raw ?? {}) as Record<string, unknown>;
  const kept: SeriesBookends = {};
  for (const slot of BOOKEND_SLOTS) {
    const bookend = given[slot];
    if (isBookend(bookend)) kept[slot] = { file: bookend.file, seconds: bookend.seconds };
  }
  return Object.keys(kept).length ? kept : undefined;
}

export const bookendsSec = (bookends: SeriesBookends | undefined): number =>
  BOOKEND_SLOTS.reduce((sum, slot) => sum + (bookends?.[slot]?.seconds ?? 0), 0);

export const deliveredSec = (
  bodySec: number,
  tempo: number,
  bookends: SeriesBookends | undefined,
): number => bodySec / tempo + bookendsSec(bookends);

export type DeliveryInput = "intro" | "body" | "outro";

const VIDEO_FORMAT = "fps=30,setsar=1,format=yuv420p";
const AUDIO_FORMAT = "aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo";

export function deliveryGraph(input: { tempo: number; intro: boolean; outro: boolean }): {
  filter: string;
  inputs: DeliveryInput[];
} {
  const inputs: DeliveryInput[] = [
    ...(input.intro ? (["intro"] as const) : []),
    "body",
    ...(input.outro ? (["outro"] as const) : []),
  ];
  const sped = input.tempo !== 1;
  const filters = inputs.flatMap((role, i) => {
    const body = role === "body" && sped;
    return [
      `[${i}:v:0]${body ? `setpts=PTS/${input.tempo},` : ""}${VIDEO_FORMAT}[v${i}]`,
      `[${i}:a:0]${body ? `atempo=${input.tempo},` : ""}${AUDIO_FORMAT}[a${i}]`,
    ];
  });
  const pairs = inputs.map((_, i) => `[v${i}][a${i}]`).join("");
  filters.push(`${pairs}concat=n=${inputs.length}:v=1:a=1[v][a]`);
  return { filter: filters.join(";"), inputs };
}
