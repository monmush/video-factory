import { describe, expect, it } from "vitest";
import { outputSize, videoLevel, withBatchLevel, withVideoLevel } from "./batch-settings";

describe("output resolution", () => {
  it("old jobs and unknown values read as 720p", () => {
    expect(outputSize(undefined)).toEqual({ width: 720, height: 1280 });
    expect(outputSize("4k")).toEqual({ width: 720, height: 1280 });
    expect(outputSize("1080p")).toEqual({ width: 1080, height: 1920 });
  });
});

describe("quality per video before it is made", () => {
  const series = { mediaLevel: "balanced" };

  it("a video follows the batch until it is given its own level", () => {
    const session = { settings: { mediaLevel: "fast" } };
    expect(videoLevel(session, series, "x")).toBe("fast");
    const own = { settings: withVideoLevel(session, series, "x", "high") };
    expect(videoLevel(own, series, "x")).toBe("high");
    expect(videoLevel(own, series, "y")).toBe("fast");
    expect(withVideoLevel(own, series, "x", "fast")).toEqual({ mediaLevel: "fast" });
  });

  it("the batch chip sets every video, also those given their own level", () => {
    const session = { settings: withVideoLevel({}, series, "x", "high") };
    const next = { settings: withBatchLevel(session.settings, "fast") };
    expect(videoLevel(next, series, "x")).toBe("fast");
    expect(videoLevel({ settings: withBatchLevel(next.settings, null) }, series, "x")).toBe(
      "balanced",
    );
  });
});
