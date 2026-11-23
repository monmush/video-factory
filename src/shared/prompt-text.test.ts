import { describe, expect, it } from "vitest";
import { splitTrailingCue } from "./cues";
import { CLEAN_FOOTAGE, plannedMotion, speakPrompt, speechPrompt } from "./prompt-text";
import { guessVoiceTraits, voiceDescription } from "./voices";

describe("the prompt of a clip that speaks for itself", () => {
  it("quotes the words without the sound after them, and describes the sound as an action", () => {
    const { words, cue } = splitTrailingCue("Ông pha trà ngon lắm ạ. [cười khẽ]");
    const prompt = speechPrompt({ people: 1, words, cue, voice: "A voice." });
    expect(prompt).toContain('They say: "Ông pha trà ngon lắm ạ.", then they laugh softly.');
    expect(prompt).not.toContain("[");
    expect(prompt).toContain("no music");
    expect(prompt.endsWith(CLEAN_FOOTAGE)).toBe(true);
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

describe("a character's voice in words", () => {
  it("follows gender and age, always with the Hanoi accent, the same every time", () => {
    const grandfather = voiceDescription(guessVoiceTraits("Ông Ba", "Ông cụ khoảng 70 tuổi"));
    const girl = voiceDescription(guessVoiceTraits("Mai", "Cô gái trẻ, 22 tuổi"));
    expect(grandfather).toMatch(/elderly Vietnamese man/);
    expect(girl).toMatch(/young Vietnamese woman/);
    expect(grandfather).toMatch(/Northern Vietnamese \(Hanoi\) accent/);
    expect(voiceDescription(guessVoiceTraits("Ông Ba", "Ông cụ khoảng 70 tuổi"))).toBe(grandfather);
  });
});
