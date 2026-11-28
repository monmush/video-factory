import { describe, expect, it } from "vitest";
import { rejectSegmentClip } from "./clip-check";
import { redoneCharges, spentUsd } from "./cost/charges";
import { withInUsePaid } from "./cost/charges.fixture";
import {
  batchToMake,
  costToFinishUsd,
  costToPreviewUsd,
  inFlightUsd,
  shotEstimateUsd,
} from "./cost/estimate";
import { NANO_BANANA_STILL_USD, STILL_USD, VOICE_SAMPLE_USD } from "./cost/rates";
import { costPanel } from "./cost/table";
import {
  finished,
  NOW,
  placed,
  plannedJob,
  running,
  spoken,
  withStills,
  withVoices,
} from "./job.fixture";
import { reconcileJob, withSending } from "./request-reconcile";
import type { JobSegment } from "./speech";
import { applyFix } from "./video-fix";
import {
  followSeriesModels,
  jobPhase,
  keepModels,
  madeByProvider,
  nextActions,
  resumeJob,
  segmentHeard,
  settle,
  stepReportedFailure,
  type VideoJob,
} from "./video-job";
import { motionUsd, speechUsd, videoModel } from "./video-models";
import { keptVoices, voiceMade, withVoiceChoices } from "./voice-step";

const kinds = (job: VideoJob) => nextActions(job, new Set()).map((a) => a.kind);

describe("making a video: the video model speaks", () => {
  it("groups the plan's lines into speech segments and marks the speaker shots", () => {
    const job = plannedJob();
    expect(job.segments?.map((s) => s.shots)).toEqual([[0], [1, 2], [3, 4]]);
    expect(job.shots.filter((s) => s.speech).map((s) => s.index)).toEqual([0, 2, 4]);
    expect(job.segments?.[2]?.hold).toBe(1);
  });

  it("runs stills, then speech, then the timeline, then the other shots", () => {
    const job = running(plannedJob());
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
    expect(kinds(heard)).toEqual(["timeline"]);

    const shots = placed(heard);
    expect(jobPhase(shots)).toBe("shots");
    expect(kinds(shots)).toEqual(["submit-shot", "submit-shot"]);
    expect(shots.shots[2]?.cutFrom).toBe(1.2);
  });

  it("sends every segment that has its still at once", () => {
    const job = running(plannedJob());
    const some = {
      ...job,
      frames: job.frames.map((f) =>
        f.id === "kf:an" || f.kind === "wide" ? { ...f, file: "x" } : f,
      ),
    };
    const sent = nextActions(some, new Set()).filter((a) => a.kind === "submit-segment");
    expect(sent.map((a) => ("segment" in a ? a.segment : ""))).toEqual(["line-1-1", "line-3-1"]);
  });

  it("the first hold stops after the stills and is priced for the stills only", () => {
    const job = { ...plannedJob(), pause: true, status: "running" as const };
    expect(costToPreviewUsd(job)).toBeCloseTo(job.frames.length * STILL_USD);
    const stills = withStills(job);
    expect(kinds(stills)).toEqual([]);
    expect(settle(stills).status).toBe("review");
  });

  it("only moving shots go to the video model; speaking shots are cut from their segment", () => {
    const job = plannedJob();
    expect(job.shots.filter(madeByProvider).map((s) => s.index)).toEqual([1]);
    const listener = { ...(job.shots[1] as VideoJob["shots"][number]), route: "lip-sync" as const };
    expect(madeByProvider(listener)).toBe(true);
    expect(madeByProvider({ ...listener, fallback: true })).toBe(false);
  });
});

describe("costs", () => {
  it("count segments and moving shots; there is no voice row", () => {
    const job = plannedJob();
    const table = costPanel(job);
    const steps = table?.steps.map((r) => r.label) ?? [];
    expect(steps).not.toContain("Giọng đọc");
    expect(steps.filter((s) => s.endsWith("· Nói"))).toHaveLength(3);
    expect(steps).toContain("Cảnh 2 · Chuyển động");
    expect(costToFinishUsd(job)).toBeCloseTo(table?.estimateUsd ?? 0);
  });

  it("a moving shot is priced at the video model's silent rate for its whole seconds", () => {
    const job = placed(spoken(withStills(plannedJob())));
    const wide = job.shots[1] as VideoJob["shots"][number];
    expect(shotEstimateUsd(job, wide)).toBeCloseTo(motionUsd(videoModel("wan-3"), 1));
    expect(motionUsd(videoModel("wan-3"), 1)).toBeCloseTo(2 * 0.05);
    expect(motionUsd(videoModel("minimax-h3-max"), 3.2)).toBeCloseTo(4 * 0.0375);
  });

  it("follow the series' models", () => {
    const wan = plannedJob();
    const h3 = plannedJob({ image: "nano-banana-pro", video: "minimax-h3-max" });
    expect(costToPreviewUsd(h3)).toBeCloseTo(h3.frames.length * NANO_BANANA_STILL_USD);
    expect(costToFinishUsd(h3)).not.toBeCloseTo(costToFinishUsd(wan) ?? Number.NaN);
    expect(costToFinishUsd(followSeriesModels(wan, h3.models))).toBeCloseTo(
      costToFinishUsd(h3) ?? Number.NaN,
    );
  });

  it("spent counts paid segments; a segment rendering may still be billed", () => {
    const job = running(withStills(plannedJob()));
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
    expect(inFlightUsd(paid)).toBeCloseTo(speechUsd(videoModel("wan-3"), 4));
    expect(spentUsd(withInUsePaid(spoken(job)))).toBeCloseTo(frames + 3 * 0.18);
  });
});

describe("the series' models are taken when the first paid request is sent", () => {
  const h3 = { video: "minimax-h3-max" as const };

  it("a video follows the series until then, and keeps its models after", () => {
    const job = plannedJob();
    expect(followSeriesModels(job, h3).models).toEqual({
      image: "gpt-image",
      video: "minimax-h3-max",
    });
    expect(followSeriesModels(job, undefined)).toBe(job);
    const kept = keepModels(job, h3);
    expect(kept).toMatchObject({ modelsKept: true, models: { video: "minimax-h3-max" } });
    expect(followSeriesModels(kept, undefined)).toBe(kept);
    expect(keepModels(kept, { video: "wan-3" })).toBe(kept);
  });

  it("an old video made the old way never takes models", () => {
    const old = { ...finished(), dubbed: true as const };
    expect(followSeriesModels(old, h3)).toBe(old);
    expect(keepModels(old, h3)).toBe(old);
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

  it("with added lettering is made next on the other video model, then fails", () => {
    const job = running(withStills(plannedJob()));
    const sent = withInUsePaid(sentOn(job, "wan-3"));
    const rejected = rejectSegmentClip(sent, "line-1-1", "u");
    expect(first(rejected)).toMatchObject({ state: "queued", rejectedModels: ["wan-3"] });
    expect(redoneCharges(rejected).map((c) => c.usd)).toEqual([0.2]);
    expect(spentUsd(rejected)).toBeCloseTo(spentUsd(sent));
    const twice = rejectSegmentClip(sentOn(rejected, "minimax-h3-max"), "line-1-1", "u");
    expect(first(twice)).toMatchObject({ state: "failed" });
  });

  it("whose speech runs to the end is set aside and asked again longer", () => {
    const job = withInUsePaid(sentOn(running(withStills(plannedJob())), "wan-3"));
    const clip = { clip: "c.mp4", clipSec: 4, speech: { start: 0.3, end: 4 } };
    const cut = segmentHeard(job, "line-1-1", "u", { ...clip, cutOff: true });
    expect(first(cut)).toMatchObject({ state: "queued", atLeastSec: 6 });
    expect(redoneCharges(cut).map((c) => [c.step, c.usd])).toEqual([["segment:line-1-1", 0.2]]);
    expect(spentUsd(cut)).toBeCloseTo(spentUsd(job));
    const heard = segmentHeard(job, "line-1-1", "u", { ...clip, cutOff: false });
    expect(first(heard)).toMatchObject({ state: "done", clip: "c.mp4" });
    const cutAgain = segmentHeard(sentOn(cut, "wan-3"), "line-1-1", "u", { ...clip, cutOff: true });
    expect(first(cutAgain)).toMatchObject({ state: "done", clip: "c.mp4" });
    expect(first(cutAgain).mishaps?.map((m) => m.kind)).toEqual(["cut", "cut-kept"]);
  });

  it("sent before a restart is attached by its mark, never sent again", () => {
    const job = running(withStills(plannedJob()));
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
        model: "minimax-h3-max",
        seconds: 6,
      },
    ]);
    expect(attached).toHaveLength(1);
    expect(back.segments?.[2]).toMatchObject({
      state: "rendering",
      requestId: "req-9",
      model: "minimax-h3-max",
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

describe("fixing a finished video", () => {
  it("refuses what would change the speech, keeps what does not", () => {
    const job = finished();
    expect(() => applyFix(job, [{ op: "redo_shot", shot: 0 }], NOW)).toThrow(
      "Chưa sửa được phần lời nói của video",
    );
    expect(() => applyFix(job, [{ op: "redo_still", frame: "kf:an" }], NOW)).toThrow();
    const wide = applyFix(job, [{ op: "redo_shot", shot: 1 }], NOW);
    expect(wide.segments?.every((s) => s.state === "done")).toBe(true);
    expect(wide.shots[1]?.state).toBe("queued");
  });

  it("refuses an old proposal that asked for the voice again", () => {
    const old = [{ op: "redo_voice" }] as unknown as Parameters<typeof applyFix>[1];
    expect(() => applyFix(finished(), old, NOW)).toThrow();
  });

  it("refuses every fix on a video made the old way", () => {
    expect(() =>
      applyFix({ ...finished(), dubbed: true }, [{ op: "redo_shot", shot: 1 }], NOW),
    ).toThrow("Video làm theo cách cũ");
  });
});

describe("each character's voice sample", () => {
  const sentSegments = (job: VideoJob) =>
    nextActions(job, new Set()).flatMap((a) => (a.kind === "submit-segment" ? [a.segment] : []));
  const madeFor = (job: VideoJob, id: string): VideoJob => ({
    ...job,
    voices: job.voices?.map((v) => (v.characterId === id ? voiceMade(v) : v)),
  });

  it("is made alongside the stills, and no line of a character is sent before its sample exists", () => {
    const job = running(withVoices(plannedJob(), false));
    expect(kinds(job).filter((k) => k === "submit-voice")).toHaveLength(2);
    const stills = withStills(job);
    expect(sentSegments(stills)).toEqual([]);
    const speaker = stills.segments?.[0]?.characterId as string;
    const own = stills.segments?.filter((s) => s.characterId === speaker).map((s) => s.id);
    expect(sentSegments(madeFor(stills, speaker))).toEqual(own);
  });

  it("is chosen once the video runs and then kept, whatever the character becomes", () => {
    const followed = running(withVoiceChoices({ ...plannedJob(), voicesKept: undefined }, []));
    expect(kinds(followed)).toContain("voices");
    const choice = {
      characterId: "a",
      text: "Giọng nữ trẻ",
      character: {},
      file: "a1.mp3",
      ready: true,
    };
    const kept = keptVoices(followed, [choice, { ...choice, characterId: "b", file: "b1.mp3" }]);
    expect(kinds(kept)).not.toContain("voices");
    const edited = { ...choice, text: "Giọng nữ lớn tuổi", file: "a2.mp3" };
    expect(withVoiceChoices(kept, [edited]).voices).toEqual(kept.voices);
  });

  it("follows a character the voice text is silent about until the video runs", () => {
    const staged = { ...plannedJob(), voicesKept: undefined };
    const choice = {
      characterId: "a",
      text: "Trầm ấm",
      character: {},
      file: "a1.mp3",
      ready: true,
    };
    const followed = withVoiceChoices(staged, [choice]);
    const becameAMan = { ...choice, character: { gender: "male" as const } };
    expect(withVoiceChoices(followed, [becameAMan]).voices?.[0]?.character).toEqual({
      gender: "male",
    });
    const started = keptVoices(running(followed), [choice]);
    expect(withVoiceChoices(started, [becameAMan]).voices).toEqual(started.voices);
  });

  it("takes an uploaded voice as ready and unpriced, and follows its adding and removal until the video runs", () => {
    const staged = { ...plannedJob(), voicesKept: undefined };
    const generated = {
      characterId: "a",
      text: "Giọng nữ trẻ",
      character: {},
      file: "a1.mp3",
      ready: false,
    };
    const uploaded = {
      ...generated,
      file: `upload-${"0".repeat(64)}.mp3`,
      ready: true,
      uploaded: true as const,
    };
    const voiceGroup = (job: VideoJob) => costPanel(job)?.groups.map((g) => g.label);
    const withUpload = withVoiceChoices(staged, [uploaded]);
    expect(withUpload.voices?.[0]).toMatchObject({ file: uploaded.file, uploaded: true });
    expect(withUpload.voices?.[0]?.toMake).toBeUndefined();
    expect(voiceGroup(withUpload)).not.toContain("Giọng nhân vật");
    const removed = withVoiceChoices(withUpload, [generated]);
    expect(removed.voices?.[0]).toMatchObject({ file: "a1.mp3", toMake: true });
    expect(removed.voices?.[0]?.uploaded).toBeUndefined();
    expect(voiceGroup(removed)).toContain("Giọng nhân vật");
    expect(withVoiceChoices(removed, [uploaded]).voices?.[0]?.file).toBe(uploaded.file);
  });

  it("fails the video after a second failed attempt, and is tried again on resume", () => {
    const job = running(withVoices(plannedJob(), false));
    const once = stepReportedFailure(job, { voice: "a" }, "lỗi");
    expect(settle(once).status).toBe("running");
    const twice = settle(stepReportedFailure(once, { voice: "a" }, "lỗi"));
    expect(twice).toMatchObject({ status: "failed", error: "lỗi" });
    const again = { ...resumeJob(twice, NOW), status: "running" as const };
    expect(nextActions(again, new Set())).toContainEqual({ kind: "submit-voice", voice: "a" });
  });

  it("is priced in the first hold only while it is still to make, and once for a batch", () => {
    const missing = withVoices(plannedJob(), false);
    const made = plannedJob();
    expect((costToPreviewUsd(missing) ?? 0) - (costToPreviewUsd(made) ?? 0)).toBeCloseTo(
      2 * VOICE_SAMPLE_USD,
    );
    expect(costPanel(missing)?.groups.map((g) => g.label)).toContain("Giọng nhân vật");
    expect(costPanel(made)?.groups.map((g) => g.label)).not.toContain("Giọng nhân vật");
    const other = { ...missing, scriptId: "y" };
    expect(batchToMake([missing, other]).usd).toBeCloseTo(
      2 * (costToFinishUsd(missing) ?? 0) - 2 * VOICE_SAMPLE_USD,
    );
  });

  it("sent before a restart is attached by its mark, never sent again", () => {
    const job = running(withVoices(plannedJob(), false));
    const marked = withSending(job, { voice: "b" }, "mark-2");
    const { job: back } = reconcileJob(marked, [
      {
        at: NOW,
        requestId: "req-v",
        purpose: "character-voice",
        sessionId: "s",
        scriptId: "x",
        voice: "b",
        attempt: "mark-2",
      },
    ]);
    expect(nextActions(back, new Set())).toContainEqual({ kind: "poll-voice", voice: "b" });
    expect(nextActions(back, new Set())).not.toContainEqual({ kind: "submit-voice", voice: "b" });
  });
});
