import { describe, expect, it } from "vitest";
import { DEFAULT_MEDIA_LEVEL, MEDIA_LEVELS, mediaLevel, OFFERED_LEVELS } from "./media-level";
import { builtinRecipe } from "./recipe";

describe("mediaLevel", () => {
  it("reads a level no longer offered as the one that makes the same video", () => {
    expect(mediaLevel("fastest").id).toBe("fast");
    expect(mediaLevel("detailed").id).toBe("balanced");
    expect(mediaLevel("high").id).toBe("high");
    expect(mediaLevel("most-detailed").id).toBe("balanced");
    expect(mediaLevel("fast").id).toBe("fast");
    expect(mediaLevel(null).id).toBe(DEFAULT_MEDIA_LEVEL);
    expect(mediaLevel("nonsense").id).toBe(DEFAULT_MEDIA_LEVEL);
  });

  it("every stored id resolves to an offered level whose recipe matches its motion", () => {
    for (const stored of MEDIA_LEVELS) {
      const level = mediaLevel(stored.id);
      expect(level.offered).toBe(true);
      expect(level.motion).toBe(stored.motion);
      expect(Boolean(builtinRecipe(level).motion)).toBe(level.motion);
    }
  });

  it("describes each offered level without model or provider names", () => {
    for (const level of OFFERED_LEVELS) {
      expect(level.points.length).toBeGreaterThanOrEqual(2);
      expect(level.points.join(" ")).not.toMatch(/fal|eleven|kling|wan|gpt|model/i);
    }
  });
});
