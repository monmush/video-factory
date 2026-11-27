import { describe, expect, it } from "vitest";
import { type CurvePoint, monotonePath, monotoneSegments } from "./monotone-curve";

const within = (value: number, a: number, b: number) =>
  value >= Math.min(a, b) - 1e-9 && value <= Math.max(a, b) + 1e-9;

describe("monotoneSegments", () => {
  it("keeps each piece between the values it joins, so a day never dips below zero", () => {
    const points: CurvePoint[] = [0, 0, 9.5, 0, 0, 1, 7, 7.2, 0].map((y, x) => ({ x, y }));
    for (const s of monotoneSegments(points)) {
      for (const c of s.controls ?? []) expect(within(c.y, s.from.y, s.to.y)).toBe(true);
    }
  });

  it("joins two points at the same moment with a straight piece", () => {
    const path = monotonePath([
      { x: 0, y: 1 },
      { x: 0, y: 3 },
      { x: 5, y: 2 },
    ]);
    expect(path).not.toContain("NaN");
    expect(path).not.toContain("Infinity");
  });
});
