import { describe, expect, it } from "vitest";
import { costToFinishUsd } from "./cost/estimate";
import type { ScriptLine } from "./ipc";
import { finished, NOW, placed, plannedJob, running, spoken, withStills } from "./job.fixture";
import {
  frameFor,
  JOB_VERSION,
  type JobShot,
  jobPhase,
  migrateJob,
  newJob,
  nextActions,
  pickNext,
  remainingSec,
  resumeJob,
  resumesOnStart,
  retryShot,
  runThrough,
  settle,
  shotFailed,
  stopJob,
  type VideoJob,
} from "./video-job";

function patch<T>(list: T[], i: number, fields: Partial<T>) {
  list[i] = { ...(list[i] as T), ...fields };
}
const line = (characterId: string | null, text: string): ScriptLine => ({
  characterId,
  speaker: characterId ?? "Ai đó",
  text,
});

const readyForShots = (fields: Partial<VideoJob> = {}): VideoJob => ({
  ...running(placed(spoken(withStills(plannedJob())))),
  ...fields,
});

const roundTrip = (job: unknown) => migrateJob(JSON.parse(JSON.stringify(job)));

describe("a new job", () => {
  it("keeps only lines of a library speaker, and plans before anything else", () => {
    const j = newJob({
      sessionId: "s",
      seriesId: "x",
      scriptId: "1",
      title: "T",
      lines: [line("a", "Một"), line(null, "Không ai"), line("b", " "), line("b", "Hai ")],
      useEnvironment: true,
      models: { image: "gpt-image", video: "wan-3" },
      now: NOW,
    });
    expect(j.lines.map((l) => [l.characterId, l.text])).toEqual([
      ["a", "Một"],
      ["b", "Hai"],
    ]);
    expect(jobPhase({ ...j, status: "running" })).toBe("plan");
    expect(nextActions({ ...j, status: "running" }, new Set())).toEqual([{ kind: "plan" }]);
    expect(costToFinishUsd(j)).toBeNull();
  });

  it("is saved and read back unchanged", () => {
    const job = plannedJob();
    expect(roundTrip(job)).toEqual(job);
  });
});

describe("transitions", () => {
  it("stop: queued shots are never sent, rendering ones keep going", () => {
    const j = readyForShots();
    patch(j.shots, 1, { state: "rendering", requestId: "r1" });
    const stopped = stopJob(j, NOW);
    expect(stopped.status).toBe("stopped");
    expect(stopped.shots.map((s) => s.state)).toEqual([
      "stopped",
      "rendering",
      "stopped",
      "stopped",
      "stopped",
    ]);
    expect(nextActions(stopped, new Set())).toEqual([{ kind: "poll-shot", index: 1 }]);
  });

  it("resume continues from what exists and only pays for what is missing", () => {
    const j = readyForShots();
    patch(j.shots, 1, { state: "done", clip: "c1.mp4", clipSec: 1, costUsd: 0.1 });
    const resumed = resumeJob(stopJob(j, NOW), NOW);
    expect(resumed.status).toBe("waiting");
    expect(resumed.shots.map((s) => s.state)).toEqual([
      "queued",
      "done",
      "queued",
      "queued",
      "queued",
    ]);
    expect(resumed.dialogue).toBe("dialogue.mp3");
    expect(costToFinishUsd(resumed)).toBe(0);
  });

  it("making everything continues a paused, stopped or running job without stopping again", () => {
    const paused = settle({ ...withStills(plannedJob()), pause: true, status: "running" });
    expect(paused.status).toBe("review");
    const resumed = settle(runThrough(paused, NOW));
    expect([resumed.status, resumed.reviewed]).toEqual(["waiting", true]);
    const stopped = runThrough(stopJob(readyForShots(), NOW), NOW);
    expect(stopped.status).toBe("waiting");
  });

  it("stopped before the timeline: shots go back to planned", () => {
    const resumed = resumeJob(stopJob(running(plannedJob()), NOW), NOW);
    expect(resumed.shots.every((s) => s.state === "planned")).toBe(true);
  });

  it("a failed provider attempt retries once, then fails", () => {
    const s = { ...(readyForShots().shots[1] as JobShot), state: "rendering" as const };
    const first = shotFailed({ ...s, requestId: "r" }, "boom");
    expect([first.state, first.retried, first.requestId]).toEqual(["queued", true, undefined]);
    const second = shotFailed({ ...first, state: "rendering", requestId: "r2" }, "boom");
    expect([second.state, second.error]).toEqual(["failed", "boom"]);
  });

  it("a failed shot fails the job once nothing else is open; retry by hand resumes it", () => {
    const j = readyForShots();
    j.shots = j.shots.map((s, i) =>
      i === 1 ? { ...s, state: "failed", retried: true } : { ...s, state: "done" },
    );
    const failed = settle(j);
    expect(failed.status).toBe("failed");
    const retried = retryShot(failed, 1, NOW);
    expect(retried.status).toBe("waiting");
    expect(retried.shots[1]).toMatchObject({ state: "queued", retried: false });
  });

  it("a job with its final video is done", () => {
    expect(settle(readyForShots({ final: "final.mp4" })).status).toBe("done");
  });
});

describe("next actions and resume", () => {
  it("waits for a staging already in progress instead of starting a second one", () => {
    const sentWhileStaging: VideoJob = {
      ...newJob({
        sessionId: "s",
        seriesId: "x",
        scriptId: "1",
        title: "T",
        lines: [line("a", "Một")],
        useEnvironment: true,
        models: { image: "gpt-image", video: "wan-3" },
        now: NOW,
      }),
      status: "running",
      planning: true,
    };
    expect(nextActions(sentWhileStaging, new Set())).toEqual([]);
    expect(nextActions({ ...sentWhileStaging, planning: undefined }, new Set())).toEqual([
      { kind: "plan" },
    ]);
  });

  it("sends the moving shot and one local shot at a time", () => {
    const j = readyForShots();
    expect(nextActions(j, new Set())).toEqual([
      { kind: "submit-shot", index: 0 },
      { kind: "submit-shot", index: 1 },
    ]);
    patch(j.shots, 0, { state: "done", clip: "c.mp4" });
    expect(nextActions(j, new Set(["shot:1"]))).toEqual([{ kind: "submit-shot", index: 2 }]);
  });

  it("after a restart, saved requests are polled, never resubmitted", () => {
    const j = readyForShots();
    patch(j.shots, 1, { state: "rendering", requestId: "r1" });
    patch(j.frames, 0, { file: undefined, requestId: "f0" });
    const actions = nextActions(j, new Set());
    expect(actions).toContainEqual({ kind: "poll-shot", index: 1 });
    expect(actions).toContainEqual({ kind: "poll-frame", frame: "kf:master" });
    expect(actions.some((a) => a.kind === "submit-shot" && a.index === 1)).toBe(false);
    expect(actions.some((a) => a.kind === "frame")).toBe(false);
    expect(resumesOnStart(j)).toBe(true);
  });

  it("never auto-starts a job that was not started", () => {
    expect(resumesOnStart(plannedJob())).toBe(false);
    expect(nextActions(plannedJob(), new Set())).toEqual([]);
  });

  it("assembles once every shot is done", () => {
    const j = readyForShots();
    j.shots = j.shots.map((s) => ({ ...s, state: "done", clip: "c.mp4", clipSec: 3 }));
    expect(nextActions(j, new Set())).toEqual([{ kind: "assemble" }]);
  });

  it("runs one job at a time: the running one, else the earliest committed", () => {
    const a = { ...plannedJob(), scriptId: "a", status: "waiting" as const, queuedAt: "2" };
    const b = { ...plannedJob(), scriptId: "b", status: "waiting" as const, queuedAt: "1" };
    const c = { ...plannedJob(), scriptId: "c", status: "stopped" as const };
    expect(pickNext([a, b, c])?.scriptId).toBe("b");
    expect(pickNext([a, { ...b, status: "done" }, { ...c, status: "running" }])?.scriptId).toBe(
      "c",
    );
  });
});

describe("time left", () => {
  const avg = { plan: 60, frame: 40, shot: 120, assemble: 15 };
  it("counts the shots left as one round, all sent at once", () => {
    const j = readyForShots();
    expect(remainingSec(j, avg, Date.parse(NOW))).toBe(120 + 15);
    j.shots = j.shots.map((s) => ({ ...s, state: "rendering", requestId: "r", submittedAt: NOW }));
    expect(remainingSec(j, avg, Date.parse(NOW) + 30_000)).toBe(90 + 15);
  });

  it("before the stills, counts the stills, the speech and the shots", () => {
    const j = { ...running(plannedJob()), phaseStartedAt: NOW };
    expect(remainingSec(j, avg, Date.parse(NOW) + 10_000)).toBe(30 + 120 + 120 + 15);
  });
});

const savedV2 = (job: VideoJob, fields: Record<string, unknown>) => ({
  ...JSON.parse(JSON.stringify(job)),
  version: 2,
  ...fields,
});

describe("jobs saved before there was one way of making videos", () => {
  it("a video made by the video model keeps working with the model its level used", () => {
    const paid: VideoJob = {
      ...readyForShots(),
      charges: [{ at: NOW, kind: "still", step: "s", usd: 1, billed: true }],
    };
    const fast = migrateJob(savedV2(paid, { voiceMode: "native", level: "fast", model: "x" }));
    expect(fast).toMatchObject({
      version: JOB_VERSION,
      models: { image: "gpt-image", video: "minimax-h3-max" },
      modelsKept: true,
    });
    expect(fast).not.toHaveProperty("voiceMode");
    expect(fast).not.toHaveProperty("level");
    expect(jobPhase(fast)).toBe("shots");
    const high = migrateJob(savedV2(paid, { voiceMode: "native", level: "high" }));
    expect(high.models?.video).toBe("wan-3");
    const waiting = migrateJob(savedV2(plannedJob(), { voiceMode: "native", level: "balanced" }));
    expect(waiting.modelsKept).toBeUndefined();
    expect(waiting.plan).toBeDefined();
  });

  it("a finished video made the old way stays as it is, to watch and save", () => {
    const done = finished();
    const old = migrateJob(savedV2(done, { level: "balanced", model: "kling" }));
    expect(old).toMatchObject({ dubbed: true, final: "final.mp4", status: "done" });
    expect(old.shots).toEqual(done.shots);
    expect(old.models).toEqual(done.models);
    expect(jobPhase(old)).toBe("done");
  });

  it("a finished video made the old way shows the version that was in use", () => {
    const done = finished();
    const other = { ...done, final: "final-high.mp4", shots: done.shots.slice(0, 2) };
    const saved = savedV2(done, {
      level: "balanced",
      chosen: "high",
      takes: [
        {
          level: "high",
          status: "done",
          cut: { frames: other.frames, shots: other.shots, final: other.final, routes: [] },
        },
      ],
    });
    const old = migrateJob(saved) as VideoJob & { takes?: { level?: string; cut: unknown }[] };
    expect(old.final).toBe("final-high.mp4");
    expect(old.shots).toHaveLength(2);
    expect(old).not.toHaveProperty("chosen");
    expect(old.takes?.map((t) => t.level)).toEqual(["balanced"]);
    expect(old.takes?.[0]?.cut).toMatchObject({ final: "final.mp4" });
  });

  it("a video made the old way but not finished starts again, keeping the operator's wishes", () => {
    const direction = [{ at: NOW, want: "cười tươi", words: "Chào ông" }];
    const half = { ...readyForShots(), rev: 2, direction, productIds: ["p"] };
    const again = migrateJob(savedV2(half, { level: "balanced" }));
    expect(again).toMatchObject({
      version: JOB_VERSION,
      status: "idle",
      rev: 3,
      oldFiles: true,
      direction,
      productIds: ["p"],
      lines: half.lines,
    });
    expect(again.plan).toBeUndefined();
    expect(again.frames).toEqual([]);
    expect(again.dialogue).toBeUndefined();
    expect(again.charges).toBeUndefined();
  });

  it("jobs saved before shot plans read as a finished video made the old way", () => {
    const old = {
      version: 1,
      sessionId: "s",
      seriesId: "x",
      scriptId: "1",
      title: "T",
      status: "done",
      queuedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
      useEnvironment: true,
      dialogue: "dialogue.mp3",
      dialogueSec: 7,
      lineSpans: [
        { start: 0.1, end: 3 },
        { start: 3.4, end: 6.8 },
      ],
      frames: [{ characterId: "a", file: "frame-a.png", retried: false }],
      shots: [
        { index: 0, lineIndex: 0, characterId: "a", speaker: "A", text: "Một", state: "done" },
        { index: 1, lineIndex: 1, characterId: "a", speaker: "A", text: "Hai", state: "done" },
      ].map((s) => ({ ...s, clip: "shot.mp4", retried: false, failures: 0 })),
      final: "final.mp4",
    };
    const j = migrateJob(old);
    expect(j).toMatchObject({ version: JOB_VERSION, dubbed: true });
    expect(jobPhase(j)).toBe("done");
    expect(j.lines.map((l) => l.text)).toEqual(["Một", "Hai"]);
    expect(j.shots.map((s) => [s.kind, s.start, s.end])).toEqual([
      ["speaker", 0, 3.2],
      ["speaker", 3.2, 7],
    ]);
    expect(frameFor(j, j.shots[0] as JobShot)?.file).toBe("frame-a.png");
  });
});
