import { describe, expect, it } from "vitest";
import { estimateSeconds, estimateUsd, levelEstimateUsd, TYPICAL_LINES } from "./board";
import {
  DEFAULT_MEDIA_LEVEL,
  levelMediaUsd,
  MEDIA_LEVELS,
  mediaLevel,
  OFFERED_LEVELS,
} from "./media-level";
import { builtinRecipe } from "./recipe";

describe("mediaLevel", () => {
  it("reads a level no longer offered as the one that makes the same video", () => {
    expect(mediaLevel("fastest").id).toBe("fast");
    expect(mediaLevel("detailed").id).toBe("balanced");
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

describe("levelEstimateUsd", () => {
  it("prices a typical 45-second video from the recipe's rates", () => {
    const fast = mediaLevel("fast");
    const balanced = mediaLevel("balanced");
    const r = builtinRecipe(balanced);
    // 7 pictures, 38 s speaking, 7 s motion (balanced only), plus a typical voice.
    const media = 7 * (r.stills.rate.usd ?? 0) + 38 * (r.speak.rate.usd ?? 0);
    const motion = 7 * (r.motion?.rate.usd ?? 0);
    expect(levelMediaUsd(fast, 45)).toBeCloseTo(media);
    expect(levelMediaUsd(balanced, 45)).toBeCloseTo(media + motion);
    const voice = levelEstimateUsd(fast) - levelMediaUsd(fast, 45);
    expect(voice).toBeGreaterThan(0.02);
    expect(voice).toBeLessThan(0.1);
    // Near what real "Cân bằng" videos cost (about $2.9–3.3 for 45–48 s).
    expect(levelEstimateUsd(balanced)).toBeGreaterThan(2.9);
    expect(levelEstimateUsd(balanced)).toBeLessThan(3.4);
    expect(levelEstimateUsd(fast)).toBeCloseTo(levelEstimateUsd(balanced) - motion);
  });

  it("scales with the length", () => {
    const level = mediaLevel("balanced");
    expect(levelEstimateUsd(level, 90)).toBeCloseTo(2 * levelEstimateUsd(level, 45));
  });

  it("is what the batch button shows for a typical script, and follows the level", () => {
    const opts = (level: string) => ({ frames: true, level });
    for (const level of OFFERED_LEVELS) {
      expect(estimateUsd(TYPICAL_LINES, opts(level.id))).toBeCloseTo(
        levelEstimateUsd(level, estimateSeconds(TYPICAL_LINES)),
      );
    }
    expect(estimateUsd(TYPICAL_LINES, opts("balanced"))).toBeGreaterThan(
      estimateUsd(TYPICAL_LINES, opts("fast")),
    );
    // A hidden level prices as the offered one it reads as.
    expect(estimateUsd(TYPICAL_LINES, opts("most-detailed"))).toBeCloseTo(
      estimateUsd(TYPICAL_LINES, opts("balanced")),
    );
  });
});
