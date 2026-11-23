import { describe, expect, it } from "vitest";
import type { Script } from "./ipc";
import {
  allPicks,
  defaultPicks,
  exportableVideos,
  exportPlan,
  freeFileName,
  offeredFiles,
  sameFileName,
} from "./video-export";
import { type JobCut, type JobStatus, newJob, type VideoJob } from "./video-job";

const script = (id: string, title: string, extra: Partial<Script> = {}): Script =>
  ({ id, title, status: "ready", pinned: false, deletedAt: null, ...extra }) as Script;

const cut = (final?: string, finalSec?: number): JobCut => ({
  frames: [],
  shots: [],
  final,
  finalSec,
});

function job(
  scriptId: string,
  working: { level: string; status: JobStatus; final?: string; finalSec?: number },
  takes: { level: string; status: JobStatus; final?: string; finalSec?: number }[] = [],
  chosen?: string,
): VideoJob {
  const base = newJob({
    sessionId: "s",
    seriesId: "series",
    scriptId,
    title: `job ${scriptId}`,
    lines: [],
    useEnvironment: false,
    now: "2026-11-20T10:00:00.000Z",
  });
  return {
    ...base,
    level: working.level,
    status: working.status,
    final: working.final,
    finalSec: working.finalSec,
    ...(takes.length
      ? {
          takes: takes.map((t) => ({
            model: "m",
            level: t.level,
            status: t.status,
            cut: cut(t.final, t.finalSec),
          })),
        }
      : {}),
    ...(chosen ? { chosen } : {}),
  };
}

describe("which finished videos are offered for saving", () => {
  const scripts = [
    script("a", "Một"),
    script("b", "Hai"),
    script("c", "Ba", { pinned: true }),
    script("d", "Bốn", { status: "writing" }),
    script("e", "Năm", { deletedAt: "2026-11-01" }),
  ];
  const jobs = new Map([
    ["a", job("a", { level: "balanced", status: "running" })],
    [
      "b",
      job(
        "b",
        { level: "high", status: "running" },
        [{ level: "balanced", status: "done", final: "b.mp4", finalSec: 47 }],
        "balanced",
      ),
    ],
    ["c", job("c", { level: "balanced", status: "done", final: "c.mp4", finalSec: 62 })],
    ["d", job("d", { level: "balanced", status: "done", final: "d.mp4" })],
    ["e", job("e", { level: "balanced", status: "done", final: "e.mp4" })],
  ]);
  const videos = exportableVideos(scripts, jobs);

  it("lists only finished videos and versions, numbered like the board", () => {
    expect(videos.map((v) => [v.number, v.title, v.seconds])).toEqual([
      [1, "Ba", 62],
      [3, "Hai", 47],
    ]);
    expect(videos[1]?.versions.map((v) => v.version)).toEqual(["balanced"]);
    expect(offeredFiles(videos)).toBe(2);
  });
});

describe("default selection", () => {
  it("ticks the version in use, or the first finished one when that is not finished", () => {
    const videos = exportableVideos(
      [script("a", "A"), script("b", "B")],
      new Map([
        [
          "a",
          job(
            "a",
            { level: "balanced", status: "done", final: "a1.mp4" },
            [{ level: "high", status: "done", final: "a2.mp4" }],
            "high",
          ),
        ],
        [
          "b",
          job(
            "b",
            { level: "high", status: "failed" },
            [
              { level: "fast", status: "done", final: "b1.mp4" },
              { level: "balanced", status: "done", final: "b2.mp4" },
            ],
            "high",
          ),
        ],
      ]),
    );
    expect(defaultPicks(videos)).toEqual([
      { scriptId: "a", version: "high" },
      { scriptId: "b", version: "fast" },
    ]);
    expect(allPicks(videos)).toHaveLength(4);
  });
});

describe("file names", () => {
  const videos = exportableVideos(
    [script("x", "x"), script("a", 'Trà đạo: rót trà / cho "khách"'), script("b", "Hai")],
    new Map([
      [
        "a",
        job("a", { level: "balanced", status: "done", final: "a1.mp4" }, [
          { level: "high", status: "done", final: "a2.mp4" },
        ]),
      ],
      ["b", job("b", { level: "balanced", status: "done", final: "b.mp4" })],
    ]),
  );

  it("names by board number and title, adding the level only when two versions of one video go", () => {
    const one = exportPlan(videos, [
      { scriptId: "a", version: "high" },
      { scriptId: "b", version: "balanced" },
    ]);
    expect(one.files.map((f) => [f.base, f.final])).toEqual([
      ["02 Trà đạo rót trà cho khách", "a2.mp4"],
      ["03 Hai", "b.mp4"],
    ]);
    const both = exportPlan(videos, allPicks(videos));
    expect(both.files.map((f) => f.base)).toEqual([
      "02 Trà đạo rót trà cho khách (Cân bằng)",
      "02 Trà đạo rót trà cho khách (Cao cấp)",
      "03 Hai",
    ]);
  });

  it("refuses a version that is not finished or does not exist", () => {
    const plan = exportPlan(videos, [
      { scriptId: "b", version: "high" },
      { scriptId: "zz", version: "balanced" },
      { scriptId: "b", version: "balanced" },
    ]);
    expect(plan.files.map((f) => f.scriptId)).toEqual(["b"]);
    expect(plan.unknown).toEqual([
      { scriptId: "b", version: "high" },
      { scriptId: "zz", version: "balanced" },
    ]);
  });

  it("never reuses a name already in the folder, whatever its case or accent encoding", () => {
    const taken = new Set(["02 trà.mp4".normalize("NFD"), "02 TRÀ 2.mp4"].map(sameFileName));
    expect(freeFileName("02 Trà", taken)).toBe("02 Trà 3.mp4");
    expect(freeFileName("03 Hai", taken)).toBe("03 Hai.mp4");
  });
});
