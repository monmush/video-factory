import { describe, expect, it } from "vitest";
import { splitTrailingCue } from "./cues";
import { CLEAN_FOOTAGE, plannedMotion, speakPrompt, speechPrompt } from "./prompt-text";

describe("the prompt of a clip that speaks for itself", () => {
  it("quotes the words without the sound after them, and describes the sound as an action", () => {
    const { words, cue } = splitTrailingCue("Ông pha trà ngon lắm ạ. [cười khẽ]");
    const prompt = speechPrompt({ people: 1, words, cue, voice: "A voice." });
    expect(prompt).toContain('They say: "Ông pha trà ngon lắm ạ.", then they laugh softly.');
    expect(prompt).not.toContain("[");
    expect(prompt).toContain("no music");
    expect(prompt.endsWith(CLEAN_FOOTAGE)).toBe(true);
  });

  it("has the speaker say the line once and then stay silent, so a long clip is not filled with invented words", () => {
    const prompt = speechPrompt({ people: 1, words: "Thật á?", cue: null, voice: "A voice." });
    const line = prompt.indexOf('They say: "Thật á?"');
    const after = prompt.indexOf("with no other word and no repetition");
    expect(line).toBeGreaterThan(-1);
    expect(after).toBeGreaterThan(line);
    expect(prompt).toMatch(/stay silent, holding their expression, until the clip ends/);
  });

  it("with several people in the picture, only the main person speaks", () => {
    const together = speechPrompt({ people: 2, words: "Ừ.", cue: null, voice: "A voice." });
    const alone = speechPrompt({ people: 1, words: "Ừ.", cue: null, voice: "A voice." });
    expect(together).toMatch(/everyone else stays silent and still/);
    expect(alone).not.toMatch(/everyone else/);
  });

  it("keeps the motion the plan wrote for the shot", () => {
    const ambient = "steam drifts from the pot";
    const planned = speakPrompt(false, ambient, "nods slightly");
    expect(plannedMotion(planned, false, ambient)).toBe("nods slightly");
    expect(plannedMotion(speakPrompt(false, ambient), false, ambient)).toBe("");
  });
});

describe("the voice of a clip that speaks for itself", () => {
  const prompt = speechPrompt({
    people: 1,
    words: "Ừ.",
    cue: null,
    voice: 'Giọng nam lớn tuổi, miền Trung, "trầm"',
  });

  it("binds the speaker to the attached voice sample and forbids repeating the sample's words", () => {
    expect(prompt).toMatch(/voice heard in Audio 1/);
    expect(prompt).toMatch(/never repeat its words/);
  });

  it("quotes the character's own voice text as the description of that voice", () => {
    expect(prompt).toContain("described as: \"Giọng nam lớn tuổi, miền Trung, 'trầm'\".");
  });
});

describe("the voice of a clip whose sample is an uploaded recording", () => {
  it("binds the speaker to Audio 1 without a description the recording may contradict", () => {
    const prompt = speechPrompt({ people: 1, words: "Ừ.", cue: null, voice: "" });
    expect(prompt).toMatch(/voice heard in Audio 1/);
    expect(prompt).not.toMatch(/described as/);
  });
});
