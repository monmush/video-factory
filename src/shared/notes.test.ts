import { describe, expect, it } from "vitest";
import { DIRECTOR_AREAS, MAX_NOTES, type Note, notesBlock, putNote, WRITER_AREAS } from "./notes";

const note = (id: string, text: string, area: Note["area"] = "script"): Note => ({
  id,
  text,
  area,
  at: "2026-11-13T00:00:00.000Z",
});

describe("putNote", () => {
  it("appends a new note", () => {
    const { list, replaced } = putNote([note("a", "Một")], note("b", "Hai"));
    expect(list.map((n) => n.id)).toEqual(["a", "b"]);
    expect(replaced).toBe(false);
  });

  it("replaces the given note in place, keeping its id", () => {
    const { list, replaced } = putNote(
      [note("a", "Một"), note("b", "Hai")],
      note("new", "Hai, sửa lại", "picture"),
      "a",
    );
    expect(list).toMatchObject([{ id: "a", text: "Hai, sửa lại", area: "picture" }, { id: "b" }]);
    expect(replaced).toBe(true);
  });

  it("does not add the same sentence twice", () => {
    const { list } = putNote([note("a", "Ngồi đối diện")], note("b", "ngồi đối diện "));
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe("a");
  });

  it("refuses a new note at the cap, but still allows a replacement", () => {
    const full = Array.from({ length: MAX_NOTES }, (_, i) => note(`n${i}`, `Ghi ${i}`));
    expect(() => putNote(full, note("x", "Mới"))).toThrow(String(MAX_NOTES));
    expect(putNote(full, note("x", "Mới"), "n3").list).toHaveLength(MAX_NOTES);
  });
});

describe("notesBlock", () => {
  const every = [note("e1", "Không dùng từ lóng"), note("e2", "Ánh sáng ấm", "picture")];
  const series = [
    note("s1", "Bà xưng con với cháu"),
    note("s2", "Giữ 1 giây sau câu đùa", "editing"),
  ];

  it("gives the writer script and voice notes, all-series first", () => {
    expect(notesBlock(every, series, WRITER_AREAS)).toBe(
      "- Không dùng từ lóng\n- Bà xưng con với cháu",
    );
  });

  it("gives the director picture and editing notes", () => {
    expect(notesBlock(every, series, DIRECTOR_AREAS)).toBe(
      "- Ánh sáng ấm\n- Giữ 1 giây sau câu đùa",
    );
  });

  it("is empty without notes", () => {
    expect(notesBlock(undefined, [], WRITER_AREAS)).toBe("");
  });
});
