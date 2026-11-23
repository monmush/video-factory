import { describe, expect, it } from "vitest";
import { tempoOf } from "./tempo";

describe("tempoOf", () => {
  it("keeps the offered speeds", () => {
    expect(tempoOf(1.25)).toBe(1.25);
    expect(tempoOf(1.5)).toBe(1.5);
    expect(tempoOf(2)).toBe(2);
  });

  it("plays anything else from the renderer at normal speed", () => {
    for (const value of ["1.5", 3, 1.75, 0, -1, Number.NaN, Infinity, null, undefined, {}]) {
      expect(tempoOf(value)).toBe(1);
    }
  });
});
