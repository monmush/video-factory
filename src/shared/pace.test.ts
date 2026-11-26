import { describe, expect, it } from "vitest";
import {
  BRISK_SYLLABLES_A_SECOND,
  estimateSeconds,
  FASTEST_SYLLABLES_A_SECOND,
  lengthFit,
  paceFor,
  promisedSec,
  syllableBudget,
} from "./pace";

const lineOf = (count: number) => ({
  text: Array.from({ length: count }, () => "trà").join(" "),
});
const script = (lineCount: number, syllablesPerLine: number) =>
  Array.from({ length: lineCount }, () => lineOf(syllablesPerLine));

describe("pace and length", () => {
  it("speaks faster to hold the target as words are added, and grows only past the fastest pace", () => {
    const at30 = (syllablesPerLine: number) => estimateSeconds(script(6, syllablesPerLine), 30);
    expect(at30(18)).toBeCloseTo(30);
    expect(at30(20)).toBeCloseTo(30);
    expect(paceFor(script(6, 20), 30)).toBeGreaterThan(paceFor(script(6, 18), 30));
    expect(paceFor(script(6, 24), 30)).toBe(FASTEST_SYLLABLES_A_SECOND);
    expect(at30(24)).toBeGreaterThan(30);
    expect(at30(28)).toBeGreaterThan(at30(24));
  });

  it("estimates a script with few words shorter than its target, never slower than brisk", () => {
    const few = script(4, 5);
    expect(paceFor(few, 45)).toBe(BRISK_SYLLABLES_A_SECOND);
    expect(estimateSeconds(few, 45)).toBeLessThan(45 * 0.85);
  });

  it("a script written to the budget of its target is estimated at about the target", () => {
    for (const target of [30, 45, 60]) {
      const budget = syllableBudget(target);
      const lines = Array.from({ length: 10 }, (_, i) =>
        lineOf(Math.floor(budget / 10) + (i < budget % 10 ? 1 : 0)),
      );
      expect(lengthFit(estimateSeconds(lines, target), target)).toBe("fits");
      expect(estimateSeconds(lines, target)).toBeCloseTo(target, 0);
    }
  });

  it("judges 30 seconds as fitting from about 26 to 36", () => {
    expect(lengthFit(25, 30)).toBe("short");
    expect(lengthFit(26, 30)).toBe("fits");
    expect(lengthFit(36, 30)).toBe("fits");
    expect(lengthFit(37, 30)).toBe("long");
  });
});

describe("promisedSec", () => {
  it("promises what the script card estimated for the pace the video was made at", () => {
    const lines = script(6, 22);
    const target = 30;
    expect(promisedSec({ lines, pace: paceFor(lines, target) })).toBeCloseTo(
      estimateSeconds(lines, target),
    );
  });

  it("makes no promise for a video made before paces were kept", () => {
    expect(promisedSec({ lines: script(6, 22) })).toBeNull();
  });
});
