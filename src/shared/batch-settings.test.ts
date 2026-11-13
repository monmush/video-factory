import { describe, expect, it } from "vitest";
import { batchResolution, batchVideoModel, outputSize } from "./batch-settings";
import { DEFAULT_VIDEO_MODEL } from "./video-models";

describe("batch settings", () => {
  it("the batch's own model first, then the series', then the default", () => {
    const series = { videoModel: "kling-avatar-v2-pro" };
    expect(batchVideoModel({ settings: { videoModel: "omnihuman-v2" } }, series)).toEqual({
      id: "omnihuman-v2",
      inherited: false,
    });
    expect(batchVideoModel({}, series)).toEqual({ id: "kling-avatar-v2-pro", inherited: true });
    expect(batchVideoModel({ settings: {} }, {})).toEqual({
      id: DEFAULT_VIDEO_MODEL,
      inherited: true,
    });
    expect(batchVideoModel(undefined, undefined).id).toBe(DEFAULT_VIDEO_MODEL);
  });

  it("unknown ids read as the default", () => {
    expect(batchVideoModel({ settings: { videoModel: "gone" } }, {}).id).toBe(DEFAULT_VIDEO_MODEL);
    expect(batchVideoModel({}, { videoModel: "gone" }).id).toBe(DEFAULT_VIDEO_MODEL);
  });
});

describe("output resolution", () => {
  it("batch first, then series, then 720p; old jobs and unknown values read as 720p", () => {
    expect(batchResolution({ settings: { resolution: "1080p" } }, {})).toEqual({
      id: "1080p",
      inherited: false,
    });
    expect(batchResolution({}, { resolution: "1080p" })).toEqual({ id: "1080p", inherited: true });
    expect(batchResolution(undefined, undefined).id).toBe("720p");
    expect(batchResolution({ settings: { resolution: "4k" } }, {}).id).toBe("720p");
    expect(outputSize(undefined)).toEqual({ width: 720, height: 1280 });
    expect(outputSize("1080p")).toEqual({ width: 1080, height: 1920 });
  });
});

describe("resolution fitted to the model", () => {
  const series = { resolution: "1080p" };
  it("keeps 1080p for a model that makes it", () => {
    expect(batchResolution(undefined, series, "kling-avatar-v2-pro").id).toBe("1080p");
  });
  it("makes 720p with a model that cannot make 1080p, keeping the saved choice", () => {
    expect(batchResolution(undefined, series, DEFAULT_VIDEO_MODEL).id).toBe("720p");
    expect(batchResolution(undefined, series).id).toBe("1080p");
  });
});
