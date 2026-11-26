import { describe, expect, it } from "vitest";
import { syllables } from "./board";
import { cleanCues } from "./cues";
import { estimateSeconds } from "./pace";
import { lineWords } from "./subtitles";

describe("sounds without words", () => {
  it("a script keeps one known sound, only at the end of a line", () => {
    expect(cleanCues("Ông nói đùa thôi, cháu đừng chặn ông. [Cười]")).toBe(
      "Ông nói đùa thôi, cháu đừng chặn ông. [cười]",
    );
    expect(cleanCues("[nói nhỏ] Ông nói đùa thôi. [cười]")).toBe("Ông nói đùa thôi. [cười]");
    expect(cleanCues("Ông [cười] nói đùa thôi.")).toBe("Ông nói đùa thôi.");
    expect(cleanCues("Ông nói đùa thôi. [hát]")).toBe("Ông nói đùa thôi.");
    expect(cleanCues("[cười]")).toBe("");
  });

  it("is never subtitled or counted as a word", () => {
    expect(lineWords("Đùa thôi. [cười]")).toEqual(["Đùa", "thôi."]);
    expect(syllables([{ text: "Đùa thôi. [cười khẽ]" }])).toBe(2);
    expect(estimateSeconds([{ text: "Đùa thôi. [cười]" }], 45)).toBe(
      estimateSeconds([{ text: "Đùa thôi." }], 45),
    );
  });
});
