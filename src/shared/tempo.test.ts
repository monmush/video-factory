import { describe, expect, it } from "vitest";
import { promisedSec } from "./pace";
import { finishedLength, jobTempo, pickedTempo } from "./tempo";

const lines = Array.from({ length: 8 }, () => ({
  text: "một hai ba bốn năm sáu bảy tám chín mười",
}));
const promise = promisedSec({ lines, pace: 5 }) as number;

describe("the speed of a video", () => {
  it("is the one the operator picked, and normal speed for anything else", () => {
    expect(jobTempo({ lines, tempo: 1.5 })).toBe(1.5);
    for (const tempo of ["1.5", 3, 0, Number.NaN, null, undefined]) {
      expect(pickedTempo(tempo)).toBeUndefined();
      expect(jobTempo({ lines, tempo })).toBe(1);
    }
  });
});

describe("the length shown for a finished video", () => {
  it("is the real length, with the script's length beside it when far off", () => {
    const long = finishedLength({ lines, pace: 5, finalSec: promise * 1.6 });
    expect(long?.seconds).toBeCloseTo(promise * 1.6);
    expect(long?.offScriptSec).toBeCloseTo(promise);
  });

  it("says nothing about the script when the video landed near it", () => {
    expect(finishedLength({ lines, pace: 5, finalSec: promise * 1.1 })?.offScriptSec).toBeNull();
  });

  it("follows the speed the operator picked", () => {
    const sped = finishedLength({ lines, pace: 5, finalSec: promise * 1.5, tempo: 1.5 });
    expect(sped?.seconds).toBeCloseTo(promise);
    expect(sped?.offScriptSec).toBeNull();
  });

  it("is unknown until the video exists, and makes no comparison for a video without a pace", () => {
    expect(finishedLength({ lines, pace: 5 })).toBeNull();
    expect(finishedLength({ lines, finalSec: 55 })?.offScriptSec).toBeNull();
  });
});
