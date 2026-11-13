// Learned preferences ("Ghi nhớ", docs/VIDEO_REVIEW_DECISIONS.md, "Learned
// preferences"): short sentences the operator asked the app to keep. Series
// notes live on the Series, all-series notes on the workspace. Each prompt
// receives only the areas it can act on, all-series notes first.

export type NoteArea = "script" | "picture" | "voice" | "editing";

export const NOTE_AREAS: NoteArea[] = ["script", "picture", "voice", "editing"];

export const NOTE_AREA_LABEL: Record<NoteArea, string> = {
  script: "Kịch bản",
  picture: "Hình",
  voice: "Giọng",
  editing: "Dựng",
};

export interface Note {
  id: string;
  /** One short sentence in the operator's language. */
  text: string;
  area: NoteArea;
  at: string;
  /** Where it was saved from. */
  from?: { sessionId: string; scriptId?: string; words?: string };
}

/** Active notes per scope. At the cap a save is refused until one is removed or replaced. */
export const MAX_NOTES = 30;
export const MAX_NOTE_LENGTH = 200;

/** Which prompt reads which areas. */
export const WRITER_AREAS: NoteArea[] = ["script", "voice"];
export const DIRECTOR_AREAS: NoteArea[] = ["picture", "editing"];

/** Lists a note into a scope: replaces `replaceId` (or an identical text), else appends. */
export function putNote(
  list: Note[],
  note: Note,
  replaceId?: string,
): { list: Note[]; replaced: boolean } {
  const same = (n: Note) =>
    n.id === replaceId || n.text.trim().toLowerCase() === note.text.trim().toLowerCase();
  const index = list.findIndex(same);
  if (index >= 0) {
    const kept = list[index] as Note;
    const next = list.flatMap((n, i) =>
      i === index ? [{ ...note, id: kept.id }] : same(n) ? [] : [n],
    );
    return { list: next, replaced: true };
  }
  if (list.length >= MAX_NOTES) {
    throw new Error(
      `Đã có ${MAX_NOTES} ghi nhớ ở phạm vi này. Hỏi người dùng muốn bỏ hoặc thay ghi nhớ nào (replace_id).`,
    );
  }
  return { list: [...list, note], replaced: false };
}

/** The notes one prompt follows, all-series first, as plain lines; "" when none. */
export function notesBlock(
  everySeries: Note[] | undefined,
  series: Note[] | undefined,
  areas: NoteArea[],
): string {
  const pick = (list: Note[] | undefined) => (list ?? []).filter((n) => areas.includes(n.area));
  return [...pick(everySeries), ...pick(series)].map((n) => `- ${n.text}`).join("\n");
}
