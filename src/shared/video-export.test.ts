import { describe, expect, it } from "vitest";
import type { Script } from "./ipc";
import { AUTO_MODELS } from "./models";
import {
  allPicks,
  defaultPicks,
  exportableVideos,
  exportPlan,
  freeFileName,
  offeredFiles,
  sameFileName,
} from "./video-export";
import { type JobStatus, newJob, type VideoJob } from "./video-job";

const script = (id: string, title: string, extra: Partial<Script> = {}): Script =>
  ({ id, title, status: "ready", pinned: false, deletedAt: null, ...extra }) as Script;

function job(scriptId: string, status: JobStatus, final?: string, finalSec?: number): VideoJob {
  const base = newJob({
    sessionId: "s",
    seriesId: "series",
    scriptId,
    title: `job ${scriptId}`,
    lines: [],
    useEnvironment: false,
    models: AUTO_MODELS,
    now: "2026-11-20T10:00:00.000Z",
  });
  return { ...base, status, final, finalSec };
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
    ["a", job("a", "running")],
    ["b", job("b", "done", "b.mp4", 47)],
    ["c", job("c", "done", "c.mp4", 62)],
    ["d", job("d", "done", "d.mp4")],
    ["e", job("e", "done", "e.mp4")],
  ]);
  const videos = exportableVideos(scripts, jobs);

  it("lists only finished videos, numbered like the board, one file each", () => {
    expect(videos.map((v) => [v.number, v.title, v.seconds])).toEqual([
      [1, "Ba", 62],
      [3, "Hai", 47],
    ]);
    expect(offeredFiles(videos)).toBe(2);
    expect(allPicks(videos)).toEqual(defaultPicks(videos));
  });
});

describe("file names", () => {
  const videos = exportableVideos(
    [script("x", "x"), script("a", 'Trà đạo: rót trà / cho "khách"'), script("b", "Hai")],
    new Map([
      ["a", job("a", "done", "a.mp4")],
      ["b", job("b", "done", "b.mp4")],
    ]),
  );

  it("names by board number and title", () => {
    const plan = exportPlan(videos, defaultPicks(videos));
    expect(plan.files.map((f) => [f.base, f.final])).toEqual([
      ["02 Trà đạo rót trà cho khách", "a.mp4"],
      ["03 Hai", "b.mp4"],
    ]);
  });

  it("refuses a video that is not finished or does not exist", () => {
    const [pick] = defaultPicks(videos);
    const plan = exportPlan(videos, [
      { scriptId: "zz", version: pick?.version ?? "" },
      { scriptId: "b", version: pick?.version ?? "" },
    ]);
    expect(plan.files.map((f) => f.scriptId)).toEqual(["b"]);
    expect(plan.unknown).toEqual([{ scriptId: "zz", version: pick?.version }]);
  });

  it("never reuses a name already in the folder, whatever its case or accent encoding", () => {
    const taken = new Set(["02 trà.mp4".normalize("NFD"), "02 TRÀ 2.mp4"].map(sameFileName));
    expect(freeFileName("02 Trà", taken)).toBe("02 Trà 3.mp4");
    expect(freeFileName("03 Hai", taken)).toBe("03 Hai.mp4");
  });
});
