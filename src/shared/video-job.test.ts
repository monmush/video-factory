import { describe, expect, it } from "vitest";
import { estimateUsd, estimateVoiceUsd, FRAME_USD } from "./board";
import type { ScriptLine } from "./ipc";
import { CUTOUT_USD } from "./product-shot";
import { rulesPlan, type ShotPlan } from "./shot-plan";
import {
  applyPlan,
  billedSeconds,
  costToFinishUsd,
  followBatch,
  frameFor,
  type JobShot,
  jobPhase,
  lineSpans,
  lossIfStoppedUsd,
  madeByProvider,
  migrateJob,
  modelLocked,
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
  shotModel,
  spentUsd,
  stopJob,
  type VideoJob,
  withShotAudio,
} from "./video-job";
import { modelOutput, videoModel } from "./video-models";

/** The default model's rate: every job here is made by it. */
const VIDEO_USD_PER_SEC = modelOutput(videoModel()).usdPerSec;

const NOW = "2026-11-12T10:00:00.000Z";

/** Replaces fields of one item in place (shots or frames). */
function patch<T>(list: T[], i: number, fields: Partial<T>) {
  list[i] = { ...(list[i] as T), ...fields };
}
const line = (characterId: string | null, text: string): ScriptLine => ({
  characterId,
  speaker: characterId ?? "Ai đó",
  text,
});
const LINES = [
  line("a", "Con chào ông ạ"),
  line("b", "Ừ, ngồi xuống uống chén trà đã"),
  line("a", "Trà này thơm quá"),
  line("b", "Pha chậm thì mới thơm"),
  line("a", "Dạ con hiểu rồi"),
];

const fresh = (useEnvironment = true) =>
  newJob({
    sessionId: "s",
    seriesId: "x",
    scriptId: "1",
    title: "T",
    lines: LINES,
    useEnvironment,
    now: NOW,
  });
const CTX = {
  lines: LINES,
  cast: [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
  ],
  products: [{ id: "p", name: "Trà" }],
  hasPlace: true,
};

/** A planned job: one speaker shot per line (the rules plan). */
const job = (patch: Partial<VideoJob> = {}, plan: ShotPlan = rulesPlan(CTX)): VideoJob => ({
  ...applyPlan(fresh(patch.useEnvironment ?? true), plan),
  ...patch,
});

/** A job whose voice and frames are done, all shots queued. */
const readyForShots = (patch: Partial<VideoJob> = {}) => {
  const j = withShotAudio(
    job({ status: "running", dialogue: "dialogue.mp3", voiceCostUsd: 0.01 }),
    LINES.map((_, i) => ({ start: i * 3, end: i * 3 + 3, audio: `line-${i}.mp3`, audioSec: 3 })),
  );
  return {
    ...j,
    frames: j.frames.map((f) => ({ ...f, file: `${f.id}.png`, costUsd: FRAME_USD })),
    ...patch,
  };
};

/** A director's plan with every kind of shot: wide, listener, detail, product. */
const MIXED: ShotPlan = {
  source: "ai",
  seats: [],
  props: [],
  stateChanges: [],
  shots: [
    {
      kind: "speaker",
      characterId: "a",
      framing: "medium_close",
      line: 0,
      text: "Con chào ông ạ",
      visual: "",
      productId: null,
      why: "",
    },
    {
      kind: "wide",
      characterId: null,
      framing: null,
      line: 1,
      text: "Ừ, ngồi xuống uống chén trà đã",
      visual: "",
      productId: null,
      why: "",
    },
    {
      kind: "listener",
      characterId: "b",
      framing: "close",
      line: 2,
      text: "Trà này thơm quá",
      visual: "",
      productId: null,
      why: "",
    },
    {
      kind: "detail",
      characterId: null,
      framing: null,
      line: 3,
      text: "Pha chậm thì mới thơm",
      visual: "",
      productId: "p",
      why: "",
    },
    {
      kind: "detail",
      characterId: null,
      framing: null,
      line: 4,
      text: "Dạ con hiểu rồi",
      visual: "pour",
      productId: null,
      why: "",
    },
  ],
};

describe("shot list", () => {
  it("keeps only lines of a library speaker, and plans before anything else", () => {
    const j = newJob({
      sessionId: "s",
      seriesId: "x",
      scriptId: "1",
      title: "T",
      lines: [line("a", "Một"), line(null, "Không ai"), line("b", " "), line("b", "Hai ")],
      useEnvironment: true,
      now: NOW,
    });
    expect(j.lines.map((l) => [l.characterId, l.text])).toEqual([
      ["a", "Một"],
      ["b", "Hai"],
    ]);
    expect(jobPhase({ ...j, status: "running" })).toBe("plan");
    expect(nextActions({ ...j, status: "running" }, new Set())).toEqual([{ kind: "plan" }]);
    expect(costToFinishUsd(j)).toBeCloseTo(estimateUsd(j.lines, { frames: true }));
  });

  it("makes the wide still first, one per character on screen, and one per detail", () => {
    const j = job({}, MIXED);
    expect(j.frames.map((f) => [f.id, f.kind])).toEqual([
      ["wide", "wide"],
      ["character:a", "character"],
      ["character:b", "character"],
      ["product:3", "product"],
      ["detail:4", "detail"],
    ]);
    expect(j.shots.map((s) => frameFor(j, s)?.id)).toEqual([
      "character:a",
      "wide",
      "character:b",
      "product:3",
      "detail:4",
    ]);
  });

  it("without a place: no wide still, covers only", () => {
    expect(job({ useEnvironment: false }).frames.map((f) => f.id)).toEqual([
      "character:a",
      "character:b",
    ]);
  });
});

describe("costs", () => {
  it("before anything runs, finishing costs voice, frames and every shot", () => {
    const j = job();
    expect(spentUsd(j)).toBe(0);
    const shots = j.shots.reduce((n, s) => n + billedSeconds(s), 0);
    expect(shots).toBeGreaterThan(2 * j.shots.length);
    expect(costToFinishUsd(j)).toBeCloseTo(
      estimateVoiceUsd(j.lines) + 3 * FRAME_USD + shots * VIDEO_USD_PER_SEC,
    );
  });

  it("without an environment, frames cost nothing", () => {
    expect(costToFinishUsd(job({ useEnvironment: false }))).toBeCloseTo(
      costToFinishUsd(job()) - 3 * FRAME_USD,
    );
  });

  it("wide and detail shots are made locally; a product shot costs its plate and missing cut-outs", () => {
    const j = withShotAudio(
      job({ status: "running", dialogue: "d.mp3" }, MIXED),
      LINES.map((_, i) => ({ start: i * 3, end: i * 3 + 3, audio: `l${i}`, audioSec: 3 })),
    );
    // Stills: wide, two characters, one generated detail, the product's plate.
    // Shots: only speaker and listener.
    expect(costToFinishUsd(j)).toBeCloseTo(5 * FRAME_USD + 2 * 3 * VIDEO_USD_PER_SEC);
    patch(
      j.frames,
      j.frames.findIndex((f) => f.kind === "product"),
      { cutouts: 2 },
    );
    expect(costToFinishUsd(j)).toBeCloseTo(
      5 * FRAME_USD + 2 * CUTOUT_USD + 2 * 3 * VIDEO_USD_PER_SEC,
    );
    // No usable cut-out: the product's own photo, free; so are old jobs' photos.
    patch(
      j.frames,
      j.frames.findIndex((f) => f.kind === "product"),
      { noCutout: true },
    );
    expect(costToFinishUsd(j)).toBeCloseTo(4 * FRAME_USD + 2 * 3 * VIDEO_USD_PER_SEC);
  });

  it("stopping loses what is spent plus what is rendering; finishing excludes both", () => {
    const j = readyForShots();
    patch(j.shots, 0, { state: "done", clipSec: 4, costUsd: 4 * VIDEO_USD_PER_SEC });
    patch(j.shots, 1, { state: "rendering", requestId: "r1" });
    const spent = 0.01 + 3 * FRAME_USD + 4 * VIDEO_USD_PER_SEC;
    expect(spentUsd(j)).toBeCloseTo(spent);
    expect(lossIfStoppedUsd(j)).toBeCloseTo(spent + 3 * VIDEO_USD_PER_SEC);
    expect(costToFinishUsd(j)).toBeCloseTo(3 * 3 * VIDEO_USD_PER_SEC);
  });

  it("a result already logged and still downloading is counted once", () => {
    const j = readyForShots();
    const usd = 3 * VIDEO_USD_PER_SEC;
    patch(j.shots, 1, { state: "rendering", requestId: "r1", resultUrl: "u", costUsd: usd });
    patch(j.frames, 0, { file: undefined, requestId: "f1", resultUrl: "u", costUsd: FRAME_USD });
    expect(lossIfStoppedUsd(j)).toBeCloseTo(spentUsd(j));
  });

  it("bills short lines at the minimum shot length", () => {
    const j = readyForShots();
    patch(j.shots, 0, { audioSec: 0.8 });
    j.shots.splice(1);
    expect(costToFinishUsd(j)).toBeCloseTo(2 * VIDEO_USD_PER_SEC);
  });
});

describe("speaking-shot model", () => {
  it("is copied from the series at creation; jobs saved before read as the default", () => {
    const made = newJob({
      sessionId: "s",
      seriesId: "x",
      scriptId: "1",
      title: "T",
      lines: LINES,
      useEnvironment: false,
      model: "kling-avatar-v2-pro",
      now: NOW,
    });
    expect(made.model).toBe("kling-avatar-v2-pro");
    expect(fresh().model).toBeUndefined();
    const j = readyForShots();
    expect(shotModel(j, j.shots[0] as JobShot).id).toBe(videoModel().id);
  });

  it("prices unsent shots at the job's model, sent ones at the model that made them", () => {
    const j = readyForShots({ model: "kling-avatar-v2-pro" });
    // Five queued shots of 3 seconds at the Pro rate.
    expect(costToFinishUsd(j)).toBeCloseTo(5 * 3 * 0.115);
    // Sent before models were recorded: the default, polled at the default endpoint.
    patch(j.shots, 0, { state: "rendering", requestId: "r0" });
    expect(shotModel(j, j.shots[0] as JobShot).id).toBe(videoModel().id);
    patch(j.shots, 1, { state: "rendering", requestId: "r1", model: "omnihuman-v2" });
    expect(shotModel(j, j.shots[1] as JobShot).endpoint).toBe("bytedance/omnihuman/v2");
    expect(lossIfStoppedUsd(j)).toBeCloseTo(
      0.01 + 3 * FRAME_USD + 3 * VIDEO_USD_PER_SEC + 4 * 0.105,
    );
  });

  it("an unknown job model falls back to the default", () => {
    const j = readyForShots({ model: "gone-model" });
    expect(costToFinishUsd(j)).toBeCloseTo(5 * 3 * VIDEO_USD_PER_SEC);
  });

  it("a shot longer than its model takes is made by the default", () => {
    const j = readyForShots({ model: "omnihuman-v2" });
    patch(j.shots, 0, { audioSec: 400 });
    expect(shotModel(j, j.shots[0] as JobShot).id).toBe(videoModel().id);
    expect(shotModel(j, j.shots[1] as JobShot).id).toBe("omnihuman-v2");
  });

  it("the estimate before the plan uses the job's model", () => {
    const j = { ...fresh(), model: "kling-avatar-v2-pro" };
    expect(costToFinishUsd(j)).toBeCloseTo(
      estimateUsd(j.lines, { frames: true, model: "kling-avatar-v2-pro" }),
    );
    expect(costToFinishUsd(j)).toBeGreaterThan(costToFinishUsd(fresh()));
  });
});

describe("following the batch until the first shot is sent", () => {
  const batch = { model: "fabric-1-720p", resolution: "1080p" };

  it("a video not shot yet uses the batch's model now, at its size fitted to the model", () => {
    const paused = readyForShots({ status: "review", model: "kling-avatar-v2-standard" });
    expect(modelLocked(paused)).toBe(false);
    const now = followBatch(paused, batch);
    expect(now).toMatchObject({ model: "fabric-1-720p", resolution: "720p" });
    // The hold price follows: five shots of 3 seconds at Fabric's rate.
    expect(costToFinishUsd(now)).toBeCloseTo(5 * 3 * 0.15);
    // Its own model wins over the batch.
    expect(followBatch({ ...paused, ownModel: "kling-avatar-v2-pro" }, batch)).toMatchObject({
      model: "kling-avatar-v2-pro",
      resolution: "1080p",
    });
  });

  it("once a shot is sent (or the snapshot is saved) nothing changes", () => {
    const j = readyForShots({ model: "kling-avatar-v2-standard" });
    patch(j.shots, 0, { state: "rendering", requestId: "r0", model: "kling-avatar-v2-standard" });
    expect(modelLocked(j)).toBe(true);
    expect(followBatch(j, batch)).toBe(j);
    const snap = { ...readyForShots(), modelLocked: true };
    expect(followBatch(snap, batch)).toBe(snap);
    // Finished videos saved before the rule: locked by their made shots.
    const old = readyForShots();
    patch(old.shots, 0, { state: "done", clip: "c.mp4" });
    expect(modelLocked(old)).toBe(true);
  });
});

describe("transitions", () => {
  it("stop: queued shots are never sent, rendering ones keep going", () => {
    const j = readyForShots();
    patch(j.shots, 0, { state: "rendering", requestId: "r0" });
    const stopped = stopJob(j, NOW);
    expect(stopped.status).toBe("stopped");
    expect(stopped.shots.map((s) => s.state)).toEqual([
      "rendering",
      "stopped",
      "stopped",
      "stopped",
      "stopped",
    ]);
    expect(nextActions(stopped, new Set())).toEqual([{ kind: "poll-shot", index: 0 }]);
  });

  it("resume continues from what exists and only pays for what is missing", () => {
    const j = readyForShots();
    patch(j.shots, 0, { state: "done", clip: "c0.mp4", clipSec: 3, costUsd: 0.17 });
    const resumed = resumeJob(stopJob(j, NOW), NOW);
    expect(resumed.status).toBe("waiting");
    expect(resumed.shots.map((s) => s.state)).toEqual([
      "done",
      "queued",
      "queued",
      "queued",
      "queued",
    ]);
    expect(resumed.dialogue).toBe("dialogue.mp3");
    expect(costToFinishUsd(resumed)).toBeCloseTo(4 * 3 * VIDEO_USD_PER_SEC);
  });

  it("making everything continues a paused, stopped or running job without stopping again", () => {
    const paused = settle({ ...readyForShots(), pause: true, status: "running" });
    expect(paused.status).toBe("review");
    const resumed = settle(runThrough(paused, NOW));
    expect([resumed.status, resumed.reviewed]).toEqual(["waiting", true]);
    // A test video still making its voice will not stop at the pause either.
    const early = runThrough(job({ status: "running", pause: true }), NOW);
    expect([early.status, early.reviewed]).toEqual(["running", true]);
    const stopped = runThrough(stopJob(readyForShots(), NOW), NOW);
    expect(stopped.status).toBe("waiting");
  });

  it("stopped before the voice: shots go back to planned", () => {
    const resumed = resumeJob(stopJob(job({ status: "running" }), NOW), NOW);
    expect(resumed.shots.every((s) => s.state === "planned")).toBe(true);
  });

  it("a failed provider attempt retries once, then fails", () => {
    const s = {
      ...(readyForShots().shots[0] as JobShot),
      state: "rendering" as const,
      requestId: "r",
    };
    const first = shotFailed(s, "boom");
    expect([first.state, first.retried, first.requestId]).toEqual(["queued", true, undefined]);
    const second = shotFailed({ ...first, state: "rendering", requestId: "r2" }, "boom");
    expect([second.state, second.error]).toEqual(["failed", "boom"]);
  });

  it("a clip whose paid result could not be used is sent again, never fetched from the old link", () => {
    const s = {
      ...(readyForShots().shots[0] as JobShot),
      state: "rendering" as const,
      requestId: "r",
      resultUrl: "https://example.test/expired.mp4",
      costUsd: 0.4,
    };
    const next = shotFailed(s, "expired");
    expect([next.state, next.requestId, next.resultUrl, next.costUsd]).toEqual([
      "queued",
      undefined,
      undefined,
      0.4,
    ]);
  });

  it("a failed shot fails the job once nothing else is open; retry by hand resumes it", () => {
    const j = readyForShots();
    j.shots = j.shots.map((s, i) =>
      i === 2 ? { ...s, state: "failed", retried: true } : { ...s, state: "done" },
    );
    const failed = settle(j);
    expect(failed.status).toBe("failed");
    const retried = retryShot(failed, 2, NOW);
    expect(retried.status).toBe("waiting");
    expect(retried.shots[2]).toMatchObject({ state: "queued", retried: false });
  });

  it("a job with its final video is done", () => {
    expect(settle(readyForShots({ final: "final.mp4" })).status).toBe("done");
  });
});

describe("next actions and resume", () => {
  it("follows the cheap steps first: voice, then frames, then shots", () => {
    expect(nextActions(job({ status: "running" }), new Set())).toEqual([{ kind: "voice" }]);
    const voiced = withShotAudio(
      job({ status: "running", dialogue: "d.mp3" }, MIXED),
      LINES.map((_, i) => ({ start: i * 2, end: i * 2 + 2, audio: `l${i}`, audioSec: 2 })),
    );
    expect(jobPhase(voiced)).toBe("frames");
    // The wide still first: the others, a product's plate too, are drawn from it.
    expect(nextActions(voiced, new Set())).toEqual([{ kind: "frame", frame: "wide" }]);
    patch(voiced.frames, 0, { file: "wide.png" });
    expect(nextActions(voiced, new Set()).map((a) => a.kind === "frame" && a.frame)).toEqual([
      "character:a",
      "character:b",
      "product:3",
      "detail:4",
    ]);
  });

  it("local shots do not take a provider slot", () => {
    const j = withShotAudio(
      job({ status: "running", dialogue: "d.mp3" }, MIXED),
      LINES.map((_, i) => ({ start: i * 2, end: i * 2 + 2, audio: `l${i}`, audioSec: 2 })),
    );
    j.frames = j.frames.map((f) => ({ ...f, file: `${f.id}.png` }));
    patch(j.shots, 0, { state: "rendering", requestId: "r0" });
    patch(j.shots, 2, { state: "rendering", requestId: "r2" });
    // Two with the provider; one local at a time alongside.
    expect(nextActions(j, new Set(["shot:0", "shot:2"]))).toEqual([
      { kind: "submit-shot", index: 1 },
    ]);
  });

  it("sends every ready provider shot at once", () => {
    const j = readyForShots();
    expect(nextActions(j, new Set())).toEqual(
      j.shots.map((s) => ({ kind: "submit-shot", index: s.index })),
    );
    // Shots already with the provider or being sent are not sent again.
    patch(j.shots, 0, { state: "rendering", requestId: "r0" });
    expect(nextActions(j, new Set(["shot:0", "shot:1"]))).toEqual(
      j.shots.slice(2).map((s) => ({ kind: "submit-shot", index: s.index })),
    );
  });

  it("never sends more than one local shot at a time", () => {
    const j = withShotAudio(
      job({ status: "running", dialogue: "d.mp3" }, MIXED),
      LINES.map((_, i) => ({ start: i * 2, end: i * 2 + 2, audio: `l${i}`, audioSec: 2 })),
    );
    j.frames = j.frames.map((f) => ({ ...f, file: `${f.id}.png` }));
    const sent = nextActions(j, new Set()).flatMap((a) =>
      a.kind === "submit-shot" ? [j.shots[a.index] as JobShot] : [],
    );
    expect(sent.filter((s) => !madeByProvider(s))).toHaveLength(1);
    expect(sent.filter(madeByProvider)).toHaveLength(j.shots.filter(madeByProvider).length);
  });

  it("after a restart, saved requests are polled, never resubmitted", () => {
    const j = readyForShots();
    patch(j.shots, 0, { state: "rendering", requestId: "r0" });
    patch(j.shots, 1, { state: "done", clip: "c1.mp4", clipSec: 3 });
    patch(j.frames, 0, { file: undefined, requestId: "f0" });
    const actions = nextActions(j, new Set());
    expect(actions).toContainEqual({ kind: "poll-shot", index: 0 });
    expect(actions).toContainEqual({ kind: "poll-frame", frame: "wide" });
    expect(actions.some((a) => a.kind === "submit-shot" && a.index <= 1)).toBe(false);
    expect(actions.some((a) => a.kind === "frame")).toBe(false);
    expect(resumesOnStart(j)).toBe(true);
  });

  it("never auto-starts a job that was not started", () => {
    expect(resumesOnStart(job({ status: "idle" }))).toBe(false);
    expect(nextActions(job({ status: "idle" }), new Set())).toEqual([]);
  });

  it("assembles once every shot is done", () => {
    const j = readyForShots();
    j.shots = j.shots.map((s) => ({ ...s, state: "done", clip: "c.mp4", clipSec: 3 }));
    expect(nextActions(j, new Set())).toEqual([{ kind: "assemble" }]);
  });

  it("runs one job at a time: the running one, else the earliest committed", () => {
    const a = job({ scriptId: "a", status: "waiting", queuedAt: "2026-11-12T10:00:02Z" });
    const b = job({ scriptId: "b", status: "waiting", queuedAt: "2026-11-12T10:00:01Z" });
    const c = job({ scriptId: "c", status: "stopped" });
    expect(pickNext([a, b, c])?.scriptId).toBe("b");
    expect(pickNext([a, { ...b, status: "done" }, { ...c, status: "running" }])?.scriptId).toBe(
      "c",
    );
  });
});

describe("time left", () => {
  const avg = { plan: 60, voice: 20, frame: 40, shot: 120, assemble: 15 };
  it("counts the shots left as one round, all sent at once", () => {
    const j = readyForShots();
    expect(remainingSec(j, avg, Date.parse(NOW))).toBe(120 + 15);
    // Some already sent: the round ends with the longest of them.
    patch(j.shots, 0, { state: "rendering", requestId: "r0", submittedAt: NOW });
    expect(remainingSec(j, avg, Date.parse(NOW) + 30_000)).toBe(120 + 15);
    j.shots = j.shots.map((s) => ({ ...s, state: "rendering", requestId: "r", submittedAt: NOW }));
    expect(remainingSec(j, avg, Date.parse(NOW) + 30_000)).toBe(90 + 15);
  });
  it("counts down while voice runs", () => {
    const j = job({ status: "running", phaseStartedAt: NOW });
    const left = remainingSec(j, avg, Date.parse(NOW) + 10_000);
    // Voice left, then the wide still and the rest, then one round of shots.
    expect(left).toBe(10 + 2 * 40 + 120 + 15);
  });
});

describe("line timings", () => {
  it("merges a line's segments and reports a missing line", () => {
    const seg = (i: number, s: number, e: number) => ({
      dialogueInputIndex: i,
      startTimeSeconds: s,
      endTimeSeconds: e,
    });
    expect(lineSpans([seg(0, 0, 1), seg(0, 1.2, 2), seg(1, 2.5, 3)], 2)).toEqual([
      { start: 0, end: 2 },
      { start: 2.5, end: 3 },
    ]);
    expect(lineSpans([seg(0, 0, 1)], 2)).toBeNull();
  });
});

describe("one at a time", () => {
  it("starts the next video while a stopped one's shots are still collected", () => {
    const stopped = { ...readyForShots({ status: "stopped" }) };
    patch(stopped.shots, 0, { state: "rendering", requestId: "r" });
    const next = job({ scriptId: "n", status: "waiting" });
    expect(pickNext([stopped, next])?.scriptId).toBe("n");
    expect(nextActions(stopped, new Set())).toEqual([{ kind: "poll-shot", index: 0 }]);
  });
});

describe("jobs saved before shot plans", () => {
  it("read as one speaker shot per line, timed from the saved line spans", () => {
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
        {
          index: 0,
          lineIndex: 0,
          characterId: "a",
          speaker: "A",
          text: "Một",
          state: "done",
          audio: "line.mp3",
          clip: "shot.mp4",
          retried: false,
          failures: 0,
        },
        {
          index: 1,
          lineIndex: 1,
          characterId: "a",
          speaker: "A",
          text: "Hai",
          state: "done",
          audio: "line.mp3",
          clip: "shot.mp4",
          retried: false,
          failures: 0,
        },
      ],
      final: "final.mp4",
    };
    const j = migrateJob(old);
    expect(j.version).toBe(2);
    expect(jobPhase(j)).toBe("done");
    expect(j.lines.map((l) => l.text)).toEqual(["Một", "Hai"]);
    expect(j.shots.map((s) => [s.kind, s.start, s.end])).toEqual([
      ["speaker", 0, 3.2],
      ["speaker", 3.2, 7],
    ]);
    expect(frameFor(j, j.shots[0] as JobShot)?.file).toBe("frame-a.png");
  });
});
