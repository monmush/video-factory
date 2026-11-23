import { describe, expect, it } from "vitest";
import { mediaLevel } from "./media-level";
import {
  askedSpeechSec,
  type SpeechModel,
  speechModel,
  speechModelToTry,
  speechUsd,
} from "./speech-models";

const billedFor = (model: SpeechModel | null, wantedSec: number) => {
  const asked = model && askedSpeechSec(model, wantedSec);
  return model && asked ? speechUsd(model, asked) : null;
};

describe("speaking models that make their own voice", () => {
  it("each level has its own; the request asks for a length the model takes", () => {
    expect(["fast", "balanced", "high"].map((l) => mediaLevel(l).speech)).toEqual([
      "minimax-h3-max",
      "wan-3",
      "veo-3.1-fast",
    ]);
    expect(askedSpeechSec(speechModel("minimax-h3-max"), 3.2)).toBe(4);
    expect(askedSpeechSec(speechModel("minimax-h3-max"), 0.4)).toBe(1);
    expect(askedSpeechSec(speechModel("wan-3"), 1.1)).toBe(2);
    expect(askedSpeechSec(speechModel("wan-3"), 7)).toBe(7);
    expect(askedSpeechSec(speechModel("veo-3.1-fast"), 4.1)).toBe(6);
    expect(askedSpeechSec(speechModel("veo-3.1-fast"), 9)).toBe(null);
  });

  it("bills the rounded length", () => {
    expect(billedFor(speechModel("veo-3.1-fast"), 4.1)).toBeCloseTo(6 * 0.15);
    expect(billedFor(speechModel("minimax-h3-max"), 3.2)).toBeCloseTo(4 * 0.0375);
  });

  it("prices a Wan 3.0 speaking clip at the two units a second fal billed for 720p with audio", () => {
    expect(billedFor(speechModel("wan-3"), 9)).toBeCloseTo(18 * 0.045);
    expect(billedFor(speechModel("wan-3"), 4)).toBeCloseTo(8 * 0.045);
  });

  it("a segment too long for the level's model goes to the next that takes it", () => {
    expect(speechModelToTry("veo-3.1-fast", [], 9)?.id).toBe("wan-3");
    expect(speechModelToTry("minimax-h3-max", [], 16)?.id).toBe("wan-3");
    expect(speechModelToTry("minimax-h3-max", [], 31)).toBe(null);
    expect(billedFor(speechModelToTry("veo-3.1-fast", [], 9), 9)).toBeCloseTo(18 * 0.045);
  });

  it("after a rejection: the level's model, then Wan 3.0, Veo 3.1 Fast and H3 Max", () => {
    expect(speechModelToTry("veo-3.1-fast", ["veo-3.1-fast"], 5)?.id).toBe("wan-3");
    expect(speechModelToTry("minimax-h3-max", ["minimax-h3-max", "wan-3"], 5)?.id).toBe(
      "veo-3.1-fast",
    );
    expect(speechModelToTry("wan-3", ["wan-3"], 12)?.id).toBe("minimax-h3-max");
    expect(speechModelToTry("wan-3", ["wan-3", "veo-3.1-fast", "minimax-h3-max"], 5)).toBe(null);
  });
});
