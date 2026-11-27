import { describe, expect, it } from "vitest";
import type { ActivityRecord } from "./activity";
import {
  type CostReport,
  type CurrentVideos,
  costReport,
  type Table,
  toCsv,
  type UsageLine,
} from "./cost-report";
import type { Workspace } from "./ipc";
import { finished, plannedJob } from "./job.fixture";
import { AUTO_MODELS } from "./models";
import type { VideoJob } from "./video-job";

const AT = "2026-11-27T09:00:00.000Z";

const done = (
  sessionId: string,
  scriptId: string,
  usedRequestIds: string[],
  title = "Video",
): ActivityRecord =>
  ({
    at: AT,
    run: "r",
    name: "video-done",
    sessionId,
    scriptId,
    seriesId: "series-1",
    rev: 0,
    title,
    finalSec: 30,
    tempo: 1,
    estimatedSec: 28,
    phaseSec: { shots: 100 },
    totalSec: 100,
    spentUsd: 0,
    costByKind: {},
    cutCostUsd: 0,
    usedRequestIds,
    mishaps: {},
    autoRedos: 0,
    frames: 1,
    shots: 1,
    segments: 0,
    models: AUTO_MODELS,
  }) as ActivityRecord;

const fal = (fields: UsageLine): UsageLine => ({ at: AT, provider: "fal", ...fields });

const workspace: Pick<Workspace, "series" | "sessions"> = {
  series: [{ id: "series-1", name: "Chuyện nhà" } as Workspace["series"][number]],
  sessions: [
    { id: "s1", seriesId: "series-1", name: "Lô 1" } as Workspace["sessions"][number],
    { id: "s2", seriesId: "series-1", name: "Lô 2" } as Workspace["sessions"][number],
  ],
};

const usage: UsageLine[] = [
  fal({ purpose: "video-shot", cost: 0.5, requestId: "kept", sessionId: "s1", scriptId: "a" }),
  fal({ purpose: "video-shot", cost: 0.5, requestId: "old", sessionId: "s1", scriptId: "a" }),
  fal({ purpose: "video-frame", cost: 0.1, requestId: "f", sessionId: "s2", scriptId: "b" }),
  fal({ purpose: "video-abandoned", cost: 0.2, requestId: "x", sessionId: "s2", scriptId: "b" }),
  fal({ purpose: "generate-angle", cost: 0.04, requestId: "g" }),
  { at: AT, provider: "claude-code", purpose: "video-plan", sessionId: "s1", notionalCostUsd: 3 },
  { at: AT, provider: "claude-code", purpose: "draft-series-guide", notionalCostUsd: 2 },
];

const NOTHING_CURRENT: CurrentVideos = { jobs: [], scripts: [] };

const report = () => costReport(usage, [done("s1", "a", ["kept"])], workspace, NOTHING_CURRENT);

const column = (table: Table, name: string) => {
  const at = table.header.indexOf(name);
  return table.rows.map((row) => row[at]);
};

const total = (table: Table, name: string) =>
  column(table, name).reduce<number>((n, cell) => n + (typeof cell === "number" ? cell : 0), 0);

describe("costReport", () => {
  it("tells whether each call ended up in the video", () => {
    expect(column(report().calls, "outcome")).toEqual([
      "used",
      "redone",
      "unfinished",
      "abandoned",
      "",
      "",
      "",
    ]);
  });

  it("calls a request redone once a later fix finishes without it", () => {
    const fixed = costReport(
      usage,
      [done("s1", "a", ["old"]), done("s1", "a", ["kept"])],
      workspace,
      NOTHING_CURRENT,
    );
    expect(column(fixed.calls, "outcome").slice(0, 2)).toEqual(["used", "redone"]);
  });

  it("adds up to the same paid total in every table, library work included", () => {
    const tables: CostReport = report();
    const calls = total(tables.calls, "paid_usd");
    expect(calls).toBeCloseTo(1.34);
    expect(total(tables.batches, "paid_usd")).toBeCloseTo(calls);
    expect(total(tables.series, "paid_usd")).toBeCloseTo(calls);
    expect(total(tables.videos, "paid_usd")).toBeCloseTo(calls - 0.04);
  });

  it("keeps the notional cost of the user's own Claude out of paid totals", () => {
    const tables = report();
    expect(total(tables.calls, "notional_usd")).toBe(5);
    expect(total(tables.batches, "paid_text-ai_usd")).toBe(0);
    expect(total(tables.batches, "notional_text_ai_usd")).toBe(5);
  });

  it("names series and batches from the record even after they are deleted", () => {
    const events = [
      {
        at: AT,
        run: "r",
        name: "series-saved",
        seriesId: "gone",
        seriesName: "Đã xóa",
      } as ActivityRecord,
      {
        at: AT,
        run: "r",
        name: "session-created",
        sessionId: "s9",
        seriesId: "gone",
        sessionName: "Lô cũ",
        request: "",
      } as ActivityRecord,
    ];
    const tables = costReport(
      [fal({ purpose: "video-shot", cost: 1, sessionId: "s9", scriptId: "z" })],
      events,
      { series: [], sessions: [] },
      NOTHING_CURRENT,
    );
    expect(column(tables.batches, "session_name")).toEqual(["Lô cũ"]);
    expect(column(tables.series, "series_name")).toEqual(["Đã xóa"]);
  });
});

describe("costReport for videos made before the activity record", () => {
  const madeEarlier = (fields: Partial<VideoJob> = {}): VideoJob => {
    const job = finished(plannedJob());
    return {
      ...job,
      sessionId: "s1",
      scriptId: "a",
      seriesId: "series-1",
      title: "Sếp họp toàn nói không làm",
      finalSec: 31,
      phaseSec: { shots: 200, assemble: 10 },
      shots: job.shots.map((s) => (s.index === 0 ? { ...s, requestId: "kept", costUsd: 0.5 } : s)),
      charges: [
        { at: AT, kind: "clip", step: "shot:0", usd: 0.5, billed: true, requestId: "old" },
        { at: AT, kind: "clip", step: "shot:0", usd: 0.5, billed: true, requestId: "kept" },
      ],
      ...fields,
    };
  };
  const shots = usage.slice(0, 2);

  it("takes a finished video, its title, length and kept requests from its saved job", () => {
    const tables = costReport(shots, [], workspace, { jobs: [madeEarlier()], scripts: [] });
    expect(column(tables.calls, "outcome")).toEqual(["used", "redone"]);
    expect(column(tables.videos, "title")).toEqual(["Sếp họp toàn nói không làm"]);
    expect(column(tables.videos, "finished")).toEqual(["yes"]);
    expect(column(tables.videos, "final_sec")).toEqual([31]);
    expect(column(tables.videos, "total_making_sec")).toEqual([210]);
    expect(column(tables.series, "videos_finished")).toEqual([1]);
  });

  it("keeps what the activity record says when there is one", () => {
    const tables = costReport(shots, [done("s1", "a", ["old"], "Tên đã ghi")], workspace, {
      jobs: [madeEarlier()],
      scripts: [],
    });
    expect(column(tables.calls, "outcome")).toEqual(["redone", "used"]);
    expect(column(tables.videos, "title")).toEqual(["Tên đã ghi"]);
    expect(column(tables.videos, "final_sec")).toEqual([30]);
  });

  it("names an unfinished video by its job, then by its script", () => {
    const tables = costReport(
      [...shots, fal({ purpose: "video-frame", cost: 0.1, sessionId: "s2", scriptId: "b" })],
      [],
      workspace,
      {
        jobs: [madeEarlier({ status: "running" })],
        scripts: [
          { sessionId: "s1", scriptId: "a", title: "Tên kịch bản cũ" },
          { sessionId: "s2", scriptId: "b", title: "Chỉ có kịch bản" },
        ],
      },
    );
    expect(column(tables.videos, "title")).toEqual([
      "Sếp họp toàn nói không làm",
      "Chỉ có kịch bản",
    ]);
    expect(column(tables.videos, "finished")).toEqual(["no", "no"]);
  });
});

describe("toCsv", () => {
  it("keeps a title with a comma, a quote and a line break in one field", () => {
    const csv = toCsv({ header: ["title", "usd"], rows: [['Mẹ, "con" và\nbố', 0.1]] });
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.slice(1)).toBe('title,usd\r\n"Mẹ, ""con"" và\nbố",0.1\r\n');
  });
});
