import { describe, expect, it } from "vitest";
import { estimateVoiceUsd } from "./board";
import { buildDirection } from "./build-direction";
import { rejectSegmentClip } from "./clip-check";
import { redoneCharges, spentUsd } from "./cost/charges";
import { withInUsePaid } from "./cost/charges.fixture";
import { costToFinishUsd, costToPreviewUsd, inFlightUsd } from "./cost/estimate";
import { costPanel } from "./cost/table";
import { mediaLevel } from "./media-level";
import { builtinRecipe } from "./recipe";
import { reconcileJob, withSending } from "./request-reconcile";
import { readShotList } from "./shot-list";
import { answer, CTX, LINES } from "./shot-list.fixture";
import type { JobSegment } from "./speech";
import { speechModel, speechUsd } from "./speech-models";
import { applyFix } from "./video-fix";
import {
  applyLivePlan,
  isNative,
  jobPhase,
  migrateJob,
  newJob,
  nextActions,
  segmentHeard,
  settle,
  type VideoJob,
  withShotAudio,
  withVoiceMode,
} from "./video-job";
import { levelsToTry, startVersion } from "./video-takes";

const NOW = "2026-11-20T10:00:00.000Z";
const CAST = [
  { id: "a", name: "An", photos: 3 },
  { id: "b", name: "Ba", photos: 2 },
];

function planned(levelId = "balanced"): VideoJob {
  const level = mediaLevel(levelId);
  const { list, errors } = readShotList(answer(), CTX, { motion: level.motion, sound: false });
  expect(errors).toEqual([]);
  const live = buildDirection({
    list,
    recipe: builtinRecipe(level),
    lines: LINES,
    level,
    cast: CAST,
    placePhotos: 3,
  });
  const job = newJob({
    sessionId: "s",
    seriesId: "r",
    scriptId: "x",
    title: "t",
    lines: LINES,
    useEnvironment: true,
    now: NOW,
  });
  return { ...applyLivePlan({ ...job, status: "idle" }, live), level: level.id };
}

const native = (job = planned()) => withVoiceMode(job, "native");
const running = (job: VideoJob): VideoJob => ({ ...job, status: "running", reviewed: true });
const withStills = (job: VideoJob): VideoJob => ({
  ...job,
  frames: job.frames.map((f) => ({ ...f, file: `${f.id}.png`, costUsd: 0.1 })),
});
const kinds = (job: VideoJob) => nextActions(job, new Set()).map((a) => a.kind);

const spoken = (job: VideoJob): VideoJob => ({
  ...job,
  segments: job.segments?.map((s) => ({
    ...s,
    state: "done" as const,
    model: "wan-3",
    seconds: 4,
    clip: `speech-${s.id}.mp4`,
    clipSec: 4,
    speech: { start: 0.4, end: 2.4 },
    costUsd: 0.18,
  })),
});

describe("a video whose clips make their own voice", () => {
  it("groups the plan's lines into speech segments and marks the speaker shots", () => {
    const job = native();
    expect(job.segments?.map((s) => s.shots)).toEqual([[0], [1, 2], [3, 4]]);
    expect(job.shots.filter((s) => s.speech).map((s) => s.index)).toEqual([0, 2, 4]);
    expect(job.segments?.[2]?.hold).toBe(1);
  });

  it("runs stills, then speech, then the timeline, then the other shots; never a voice first", () => {
    const dubbed = running(planned());
    expect(kinds(dubbed)).toEqual(["voice"]);

    const job = running(native());
    expect(jobPhase(job)).toBe("frames");
    expect(kinds(job).every((k) => k === "frame")).toBe(true);

    const masterOnly = {
      ...job,
      frames: job.frames.map((f) => (f.kind === "wide" ? { ...f, file: "w.png" } : f)),
    };
    expect(kinds(masterOnly)).not.toContain("submit-segment");

    const stills = withStills(job);
    expect(jobPhase(stills)).toBe("speech");
    expect(kinds(stills)).toEqual(["submit-segment", "submit-segment", "submit-segment"]);

    const heard = spoken(stills);
    expect(jobPhase(heard)).toBe("voice");
    expect(kinds(heard)).toEqual(["voice"]);

    const placed = withShotAudio({ ...heard, dialogue: "dialogue.mp3", dialogueSec: 8 }, [
      { start: 0, end: 2, cutFrom: 0.25 },
      { start: 2, end: 3 },
      { start: 3, end: 5, cutFrom: 1.2 },
      { start: 5, end: 6 },
      { start: 6, end: 8, cutFrom: 0.25 },
    ]);
    expect(jobPhase(placed)).toBe("shots");
    expect(kinds(placed)).toEqual(["submit-shot"]);
    expect(placed.shots[2]?.cutFrom).toBe(1.2);
  });

  it("sends every segment that has its still at once", () => {
    const job = running(native());
    const some = {
      ...job,
      frames: job.frames.map((f) =>
        f.id === "kf:an" || f.kind === "wide" ? { ...f, file: "x" } : f,
      ),
    };
    const sent = nextActions(some, new Set()).filter((a) => a.kind === "submit-segment");
    expect(sent.map((a) => ("segment" in a ? a.segment : ""))).toEqual(["line-1-1", "line-3-1"]);
  });

  it("the first hold stops after the stills, priced without a voice", () => {
    const job = { ...native(), pause: true, status: "running" as const };
    const dubbed = { ...planned(), pause: true, status: "running" as const };
    expect(costToPreviewUsd(job)).toBeCloseTo(
      (costToPreviewUsd(dubbed) ?? Number.NaN) - estimateVoiceUsd(LINES),
    );
    const stills = withStills(job);
    expect(kinds(stills)).toEqual([]);
    expect(settle(stills).status).toBe("review");
  });
});

describe("costs of a native video", () => {
  it("count segments instead of a voice, and its speaking row is named by what it is", () => {
    const dubbed = planned();
    const job = native();
    const table = costPanel(job);
    const steps = table?.steps.map((r) => r.label) ?? [];
    expect(steps).not.toContain("Giọng đọc");
    expect(steps.filter((s) => s.endsWith("· Nói"))).toHaveLength(3);
    expect(steps.some((s) => s.startsWith("Cảnh 1 ·"))).toBe(false);
    expect(costToFinishUsd(job)).toBeCloseTo(table?.estimateUsd ?? 0);
    expect(costToFinishUsd(job)).not.toBeCloseTo(costToFinishUsd(dubbed) ?? Number.NaN);
  });

  it("spent counts paid segments; a segment rendering may still be billed", () => {
    const job = running(withStills(native()));
    const sending = {
      ...job,
      segments: job.segments?.map((s, i) =>
        i === 0
          ? { ...s, state: "rendering" as const, requestId: "r1", model: "wan-3", seconds: 4 }
          : s,
      ),
    };
    const frames = job.frames.reduce((n, f) => n + (f.costUsd ?? 0), 0);
    const paid = withInUsePaid(sending);
    expect(spentUsd(paid)).toBeCloseTo(frames);
    expect(inFlightUsd(paid)).toBeCloseTo(speechUsd(speechModel("wan-3"), 4));
    expect(spentUsd(withInUsePaid(spoken(job)))).toBeCloseTo(frames + 3 * 0.18);
  });
});

describe("the voice mode is taken once", () => {
  it("a video not started follows the setting; once started or paid, it keeps its mode", () => {
    const job = native();
    expect(isNative(withVoiceMode(job, "dubbed"))).toBe(false);
    expect(withVoiceMode(job, "dubbed").segments).toBeUndefined();
    expect(withVoiceMode(job, "dubbed").shots.some((s) => s.speech)).toBe(false);
    const started = { ...job, status: "waiting" as const };
    expect(withVoiceMode(started, "dubbed")).toBe(started);
    const paid = withInUsePaid(withStills(job));
    expect(withVoiceMode(paid, "dubbed")).toBe(paid);
    const dubbedRunning = { ...planned(), status: "running" as const };
    expect(withVoiceMode(dubbedRunning, "native")).toBe(dubbedRunning);
  });

  it("jobs saved before the setting existed read as dubbed", () => {
    expect(isNative(migrateJob(JSON.parse(JSON.stringify(planned()))))).toBe(false);
  });
});

describe("a segment's clip", () => {
  const sentOn = (job: VideoJob, model: string): VideoJob => ({
    ...job,
    segments: job.segments?.map((s, i) =>
      i === 0
        ? {
            ...s,
            state: "rendering" as const,
            requestId: "r",
            resultUrl: "u",
            model,
            seconds: 4,
            costUsd: 0.2,
          }
        : s,
    ),
  });
  const first = (job: VideoJob) => job.segments?.[0] as JobSegment;

  it("with added lettering is made next on another model, and its cost moves to redos", () => {
    const job = running(withStills(native()));
    const sent = withInUsePaid(sentOn(job, "wan-3"));
    const rejected = rejectSegmentClip(sent, "line-1-1", "u");
    expect(first(rejected)).toMatchObject({ state: "queued", rejectedModels: ["wan-3"] });
    expect(redoneCharges(rejected).map((c) => c.usd)).toEqual([0.2]);
    expect(spentUsd(rejected)).toBeCloseTo(spentUsd(sent));
    const twice = rejectSegmentClip(sentOn(rejected, "veo-3.1-fast"), "line-1-1", "u");
    const thrice = rejectSegmentClip(sentOn(twice, "minimax-h3-max"), "line-1-1", "u");
    expect(first(thrice)).toMatchObject({ state: "failed" });
  });

  it("whose speech runs to the end is set aside and asked again longer", () => {
    const job = withInUsePaid(sentOn(running(withStills(native())), "wan-3"));
    const clip = { clip: "c.mp4", clipSec: 4, speech: { start: 0.3, end: 4 } };
    const cut = segmentHeard(job, "line-1-1", "u", { ...clip, cutOff: true });
    expect(first(cut)).toMatchObject({ state: "queued", atLeastSec: 6 });
    expect(redoneCharges(cut).map((c) => [c.step, c.usd])).toEqual([["segment:line-1-1", 0.2]]);
    expect(spentUsd(cut)).toBeCloseTo(spentUsd(job));
    const heard = segmentHeard(job, "line-1-1", "u", { ...clip, cutOff: false });
    expect(first(heard)).toMatchObject({ state: "done", clip: "c.mp4" });
  });

  it("sent before a restart is attached by its mark, never sent again", () => {
    const job = running(withStills(native()));
    const marked = withSending(job, { segment: "line-3-1" }, "mark-1");
    const { job: back, attached } = reconcileJob(marked, [
      {
        at: NOW,
        requestId: "req-9",
        purpose: "video-speech",
        sessionId: "s",
        scriptId: "x",
        segment: "line-3-1",
        attempt: "mark-1",
        model: "veo-3.1-fast",
        seconds: 6,
      },
    ]);
    expect(attached).toHaveLength(1);
    expect(back.segments?.[2]).toMatchObject({
      state: "rendering",
      requestId: "req-9",
      model: "veo-3.1-fast",
      seconds: 6,
    });
    expect(nextActions(back, new Set())).toContainEqual({
      kind: "poll-segment",
      segment: "line-3-1",
    });
    expect(nextActions(back, new Set())).not.toContainEqual({
      kind: "submit-segment",
      segment: "line-3-1",
    });
  });
});

describe("fixing a finished native video", () => {
  const finished = (): VideoJob => {
    const job = withShotAudio(spoken(withStills(native())), [
      { start: 0, end: 2, cutFrom: 0.25 },
      { start: 2, end: 3 },
      { start: 3, end: 5, cutFrom: 1.2 },
      { start: 5, end: 6 },
      { start: 6, end: 8, cutFrom: 0.25 },
    ]);
    return {
      ...job,
      status: "done",
      dialogue: "dialogue.mp3",
      dialogueSec: 8,
      final: "final.mp4",
      shots: job.shots.map((s) => ({ ...s, state: "done" as const, clip: `shot-${s.index}.mp4` })),
    };
  };

  it("refuses what would change the speech, keeps what does not", () => {
    const job = finished();
    expect(() => applyFix(job, [{ op: "redo_shot", shot: 0 }], NOW)).toThrow();
    expect(() => applyFix(job, [{ op: "redo_voice" }], NOW)).toThrow();
    expect(() => applyFix(job, [{ op: "redo_still", frame: "kf:an" }], NOW)).toThrow();
    const wide = applyFix(job, [{ op: "redo_shot", shot: 1 }], NOW);
    expect(wide.segments?.every((s) => s.state === "done")).toBe(true);
    expect(jobPhase(wide)).toBe("frames");
  });

  it("offers no version at another quality", () => {
    const job = finished();
    expect(levelsToTry(job)).toEqual([]);
    expect(() => startVersion(job, "high", NOW)).toThrow();
  });
});
