import { describe, expect, it } from "vitest";
import type { ActivityRecord } from "./activity";
import { costReport, type UsageLine } from "./cost-report";
import type { Workspace } from "./ipc";
import {
  type StatsCall,
  type StatsVideo,
  type UsageData,
  usageData,
  usageStats,
} from "./usage-stats";

const NOW = new Date(2026, 10, 27, 15, 0);
const day = (offset: number, hour = 12) => new Date(2026, 10, 27 + offset, hour).toISOString();

const call = (fields: Partial<StatsCall>): StatsCall => ({
  at: day(0),
  kind: "clip",
  usd: 1,
  outcome: "used",
  sessionId: "s1",
  scriptId: "a",
  seriesId: "series-1",
  ...fields,
});

const video = (fields: Partial<StatsVideo>): StatsVideo => ({
  sessionId: "s1",
  scriptId: "a",
  seriesId: "series-1",
  title: "Video A",
  doneAt: day(0),
  finalSec: 30,
  makingSec: 120,
  ...fields,
});

const data = (calls: StatsCall[], videos: StatsVideo[]): UsageData => ({
  calls,
  videos,
  series: [{ seriesId: "series-1", name: "Chuyện nhà" }],
});

describe("usageStats", () => {
  it("counts a call by its own day, the first day of a 7-day period included", () => {
    const stats = usageStats(
      data(
        [call({ at: day(-6, 0) }), call({ at: day(-7, 23), usd: 5 }), call({ at: day(0), usd: 2 })],
        [],
      ),
      "7d",
      NOW,
    );
    expect(stats.totalUsd).toBe(3);
    expect(stats.bars).toHaveLength(7);
    expect(stats.bars.reduce((n, b) => n + b.usd, 0)).toBe(3);
    expect(stats.byKind.reduce((n, k) => n + k.usd, 0)).toBe(3);
  });

  it("does not count a video finished before the period as finished in it", () => {
    const stats = usageStats(
      data(
        [call({ at: day(-40) }), call({ scriptId: "b", at: day(-1), usd: 3 })],
        [video({ doneAt: day(-40) }), video({ scriptId: "b", doneAt: day(-1), finalSec: 20 })],
      ),
      "30d",
      NOW,
    );
    expect(stats.finishedVideos).toBe(1);
    expect(stats.perVideoUsd).toBe(3);
    expect(stats.perSecondUsd).toBeCloseTo(3 / 20);
    expect(stats.videos.map((v) => v.key)).toEqual(["s1|b"]);
  });

  it("charges a finished video's whole cost per video, earlier calls included", () => {
    const stats = usageStats(
      data(
        [call({ at: day(-10), usd: 4 }), call({ at: day(-1), usd: 1 })],
        [video({ doneAt: day(-1) })],
      ),
      "7d",
      NOW,
    );
    expect(stats.totalUsd).toBe(1);
    expect(stats.perVideoUsd).toBe(5);
  });

  it("gives the share of money that did not end up in a video", () => {
    const stats = usageStats(
      data(
        [
          call({ usd: 6 }),
          call({ usd: 2, outcome: "redone" }),
          call({ usd: 1, outcome: "abandoned", kind: "abandoned" }),
          call({ usd: 1, outcome: "unfinished", scriptId: "b" }),
        ],
        [video({})],
      ),
      "all",
      NOW,
    );
    expect(stats.wastedUsd).toBe(4);
    expect(stats.wastedShare).toBeCloseTo(0.4);
  });

  it("has no per-video value when nothing finished, rather than zero", () => {
    const stats = usageStats(data([call({ outcome: "unfinished" })], []), "30d", NOW);
    expect(stats.perVideoUsd).toBeNull();
    expect(stats.perSecondUsd).toBeNull();
    expect(stats.makingSec).toBeNull();
    expect(stats.series[0]?.perVideoUsd).toBeNull();
    expect(stats.videos[0]?.finalSec).toBeNull();
  });

  it("has no share and no bars when nothing was paid", () => {
    const stats = usageStats(data([], []), "all", NOW);
    expect(stats.totalUsd).toBe(0);
    expect(stats.wastedShare).toBeNull();
    expect(stats.bars).toEqual([]);
  });

  it("switches to weekly bars over a long history", () => {
    const stats = usageStats(data([call({ at: day(-100) }), call({})], []), "all", NOW);
    expect(stats.bars.length).toBeLessThanOrEqual(60);
    expect(stats.bars[0]?.days).toBe(7);
    expect(stats.bars.reduce((n, b) => n + b.usd, 0)).toBe(2);
  });
});

describe("usageStats per finished video", () => {
  const madeOn = (costs: number[], seconds = 20) =>
    data(
      costs.flatMap((usd, at) => [
        call({ scriptId: `v${at}`, usd: usd - 0.5, at: day(at - 10) }),
        call({ scriptId: `v${at}`, usd: 0.5, outcome: "redone", at: day(at - 10) }),
      ]),
      costs.map((_, at) =>
        video({
          scriptId: `v${at}`,
          title: `Video ${at}`,
          doneAt: day(at - 10, 14),
          finalSec: seconds,
        }),
      ),
    );

  it("prices each point at every call of its script, redos included", () => {
    const [point] = usageStats(madeOn([2]), "30d", NOW).points;
    expect(point?.usd).toBe(2);
    expect(point?.usdPerSec).toBeCloseTo(0.1);
  });

  it("averages over the videos so far at the start, then over the last five", () => {
    const points = usageStats(madeOn([1, 3, 2, 4, 5, 10]), "30d", NOW).points;
    expect(points.map((p) => p.averageUsd)).toEqual([1, 2, 2, 2.5, 3, 4.8]);
    expect(points.at(-1)?.averageUsdPerSec).toBeCloseTo(4.8 / 20);
  });

  it("leaves out a video with no length from the per-second average", () => {
    const stats = usageStats(
      data(
        [call({ scriptId: "a", usd: 2 }), call({ scriptId: "b", usd: 4 })],
        [
          video({ scriptId: "a", doneAt: day(-2), finalSec: 10 }),
          video({ scriptId: "b", doneAt: day(-1), finalSec: null }),
        ],
      ),
      "30d",
      NOW,
    );
    expect(stats.points.map((p) => p.usdPerSec)).toEqual([0.2, null]);
    expect(stats.points.map((p) => p.averageUsdPerSec)).toEqual([0.2, 0.2]);
  });

  it("compares the last three videos with the three before only from six videos on", () => {
    expect(usageStats(madeOn([4, 4, 4, 3, 3]), "30d", NOW).perVideoChange).toBeNull();
    expect(usageStats(madeOn([4, 4, 4, 3, 3, 3]), "30d", NOW).perVideoChange).toBeCloseTo(-0.25);
  });
});

describe("usageData", () => {
  it("has no making time for a video whose making was never timed", () => {
    const report = costReport(
      [
        {
          at: day(-1),
          provider: "fal",
          purpose: "video-shot",
          cost: 1,
          sessionId: "s1",
          scriptId: "a",
        },
      ],
      [
        {
          at: day(0),
          run: "r",
          name: "video-done",
          sessionId: "s1",
          scriptId: "a",
          totalSec: 0,
          phaseSec: {},
          usedRequestIds: [],
          mishaps: {},
        } as unknown as ActivityRecord,
      ],
      { series: [], sessions: [] },
      { jobs: [], scripts: [] },
    );
    expect(usageData(report).videos[0]?.makingSec).toBeNull();
  });

  it("keeps paid calls only and knows when each video was finished", () => {
    const workspace = {
      series: [{ id: "series-1", name: "Chuyện nhà" } as Workspace["series"][number]],
      sessions: [{ id: "s1", seriesId: "series-1", name: "Lô 1" } as Workspace["sessions"][number]],
    };
    const usage: UsageLine[] = [
      {
        at: day(-1),
        provider: "fal",
        purpose: "video-shot",
        cost: 0.5,
        requestId: "k",
        sessionId: "s1",
        scriptId: "a",
      },
      {
        at: day(-1),
        provider: "claude-code",
        purpose: "video-plan",
        sessionId: "s1",
        notionalCostUsd: 3,
      },
    ];
    const doneEvent = {
      at: day(0),
      run: "r",
      name: "video-done",
      sessionId: "s1",
      scriptId: "a",
      seriesId: "series-1",
      title: "Video A",
      finalSec: 30,
      totalSec: 90,
      phaseSec: {},
      usedRequestIds: ["k"],
      mishaps: {},
    } as unknown as ActivityRecord;
    const result = usageData(costReport(usage, [doneEvent], workspace, { jobs: [], scripts: [] }));
    expect(result.calls).toEqual([
      expect.objectContaining({ usd: 0.5, kind: "clip", outcome: "used", seriesId: "series-1" }),
    ]);
    expect(result.videos).toEqual([
      expect.objectContaining({ doneAt: day(0), finalSec: 30, makingSec: 90, title: "Video A" }),
    ]);
    expect(result.series).toEqual([{ seriesId: "series-1", name: "Chuyện nhà" }]);
  });
});
