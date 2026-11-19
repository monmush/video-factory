import { describe, expect, it } from "vitest";
import type { Alignment } from "./shot-plan";
import { assTime, buildAss, lineWords, rowBreak, shownWord, wordCues } from "./subtitles";

function align(text: string, from = 0): Alignment {
  const characters = [...text];
  return {
    characters,
    characterStartTimesSeconds: characters.map((_, i) => from + i * 0.1),
    characterEndTimesSeconds: characters.map((_, i) => from + (i + 1) * 0.1),
  };
}
const texts = (cues: ReturnType<typeof wordCues>) =>
  cues.map((c) => c.words.map((w) => w.text).join(" "));

describe("words", () => {
  it("drops audio tags and lone punctuation", () => {
    expect(lineWords("[speaks quickly] Ơ… ông ơi — trà tràn!")).toEqual([
      "Ơ…",
      "ông",
      "ơi",
      "trà",
      "tràn!",
    ]);
  });

  it("shows closing ? and ! but no commas or full stops", () => {
    expect(shownWord("rồi,")).toBe("rồi");
    expect(shownWord("“Ơ…")).toBe("Ơ");
    expect(shownWord("vậy?")).toBe("vậy?");
    expect(shownWord("kìa!”")).toBe("kìa!");
  });
});

describe("phrases", () => {
  it("times words from the provider's characters, skipping the voice direction", () => {
    const tag = "[close mic] ";
    const line = "Chén đầy rồi thì rót";
    const cues = wordCues([{ text: line }], [{ start: 0, end: 3.2 }], {
      alignment: align(tag + line),
      lineChars: [{ start: 0, end: tag.length + line.length }],
    });
    expect(texts(cues)).toEqual(["Chén đầy rồi thì rót"]);
    const [cue] = cues;
    expect(cue?.start).toBe(1.2);
    expect(cue?.words[0]).toEqual({ text: "Chén", start: 1.2, end: 1.7 });
    cue?.words.slice(1).forEach((w, i) => {
      expect(w.start).toBe(cue.words[i]?.end);
    });
    expect(cue?.words.at(-1)?.end).toBe(cue?.end);
    expect(cue?.end).toBe(3.5);
  });

  it("splits at sentence ends, at commas after three words, and balances long runs", () => {
    const line = "Ừ, con cứ nói. Ông pha ấm Bạch Trà Shan Tuyết, con uống thử đi.";
    const cues = wordCues([{ text: line }], [{ start: 0, end: 6 }]);
    expect(texts(cues)).toEqual([
      "Ừ con cứ nói",
      "Ông pha ấm Bạch",
      "Trà Shan Tuyết",
      "con uống thử đi",
    ]);
  });

  it("never holds a phrase into the next line", () => {
    const a = "Một hai.";
    const b = "Ba bốn";
    const cues = wordCues(
      [{ text: a }, { text: b }],
      [
        { start: 0, end: 0.8 },
        { start: 0.9, end: 1.5 },
      ],
      {
        alignment: align(a + b),
        lineChars: [
          { start: 0, end: a.length },
          { start: a.length, end: a.length + b.length },
        ],
      },
    );
    expect(texts(cues)).toEqual(["Một hai", "Ba bốn"]);
    expect(cues[0]?.end).toBeLessThanOrEqual(cues[1]?.start ?? 0);
  });

  it("spreads words over the line when the timing doesn't match, and skips lines with no span", () => {
    const cues = wordCues([{ text: "một hai" }, { text: "ba" }], [{ start: 2, end: 4 }], {
      alignment: align("something else"),
      lineChars: [{ start: 0, end: 14 }],
    });
    expect(texts(cues)).toEqual(["một hai"]);
    expect(cues[0]?.start).toBe(2);
    expect(cues[0]?.end).toBe(4.3);
  });
});

describe("ass", () => {
  it("breaks long phrases onto two balanced rows", () => {
    expect(rowBreak(["Chén", "đầy"])).toBeUndefined();
    expect(rowBreak(["Ông", "pha", "ấm", "Bạch", "Trà"])).toBe(3);
  });

  it("draws the still phrase and the spoken word on separate layers", () => {
    expect(assTime(65.456)).toBe("0:01:05.46");
    const ass = buildAss([
      {
        start: 0,
        end: 1,
        words: [
          { text: "Chào", start: 0, end: 0.4 },
          { text: "ông{\\b0}", start: 0.4, end: 1 },
        ],
      },
    ]);
    expect(ass).toContain("WrapStyle: 2");
    const events = ass.split("\n").filter((l) => l.startsWith("Dialogue"));
    expect(events).toHaveLength(4);
    expect(events[0]).toBe(
      "Dialogue: 0,0:00:00.00,0:00:00.40,Word,,0,0,0,,{\\alpha&HFF&}Chào {\\alpha&H00&}ông",
    );
    expect(events[1]).toMatch(
      /^Dialogue: 1,0:00:00\.00,0:00:00\.40,Word,,0,0,0,,\{\\alpha&H00&\\c&H00E6FF&.*\}Chào \{\\alpha&HFF&\}ông$/,
    );
  });
});
