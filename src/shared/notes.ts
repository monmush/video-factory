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
  text: string;
  area: NoteArea;
  at: string;
  from?: { sessionId: string; scriptId?: string; words?: string };
}

export const MAX_NOTES = 30;
export const MAX_NOTE_LENGTH = 200;

export const WRITER_AREAS: NoteArea[] = ["script", "voice"];
export const DIRECTOR_AREAS: NoteArea[] = ["picture", "editing"];

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

export function notesBlock(
  everySeries: Note[] | undefined,
  series: Note[] | undefined,
  areas: NoteArea[],
): string {
  const pick = (list: Note[] | undefined) => (list ?? []).filter((n) => areas.includes(n.area));
  return [...pick(everySeries), ...pick(series)].map((n) => `- ${n.text}`).join("\n");
}
