import { describe, expect, it } from "vitest";
import { outputSize } from "./batch-settings";

describe("output resolution", () => {
  it("old jobs and unknown values read as 720p", () => {
    expect(outputSize(undefined)).toEqual({ width: 720, height: 1280 });
    expect(outputSize("4k")).toEqual({ width: 720, height: 1280 });
    expect(outputSize("1080p")).toEqual({ width: 1080, height: 1920 });
  });
});
