import { describe, expect, it, vi } from "vitest";
import {
  addedLettering,
  CLIP_NOT_USABLE,
  MAX_AUTO_REDOS_PER_VIDEO,
  readClipAnswer,
  rejectClip,
  withUnrecordedSpeakerRejections,
} from "./clip-check";
import { redoneCharges, spentUsd } from "./cost/charges";
import { withInUsePaid } from "./cost/charges.fixture";
import { shotEstimateUsd } from "./cost/estimate";
import type { ScriptLine } from "./ipc";
import { rulesPlan } from "./shot-plan";
import { applyPlan, newJob, retryShot, settle, shotModel, type VideoJob } from "./video-job";
import { clipUsd, videoModel } from "./video-models";

const NOW = "2026-11-19T07:00:00.000Z";
const line = (characterId: string, text: string): ScriptLine => ({
  characterId,
  speaker: characterId,
  text,
});
const LINES = [
  line("a", "Con chào ông ạ"),
  line("b", "Ừ, ngồi xuống uống chén trà đã"),
  line("a", "Trà này thơm quá ông ơi"),
  line("b", "Trà Shan tuyết đấy con"),
  line("a", "Con xin thêm chén nữa"),
  line("b", "Cứ tự nhiên con nhé"),
];
const KLING = videoModel("kling-avatar-v2-standard");
const OMNI = videoModel("omnihuman-v2");

function job(): VideoJob {
  const base = applyPlan(
    newJob({
      sessionId: "s",
      seriesId: "x",
      scriptId: "v",
      title: "T",
      lines: LINES,
      useEnvironment: false,
      now: NOW,
    }),
    rulesPlan({
      lines: LINES,
      cast: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      products: [],
      hasPlace: false,
    }),
  );
  return {
    ...base,
    status: "running",
    shots: base.shots.map((s, i) => ({
      ...s,
      state: "queued",
      start: i,
      end: i + 1,
      audio: `a${i}.mp3`,
    })),
  };
}

let sent = 0;
function returned(j: VideoJob, index: number, costUsd = 0.5): { job: VideoJob; url: string } {
  sent++;
  const url = `https://fal.media/clip-${sent}.mp4`;
  return {
    url,
    job: withInUsePaid({
      ...j,
      shots: j.shots.map((s) =>
        s.index === index
          ? {
              ...s,
              state: "rendering",
              model: shotModel(j, s).id,
              requestId: `r${sent}`,
              resultUrl: url,
              costUsd,
            }
          : s,
      ),
    }),
  };
}

function captioned(j: VideoJob, index: number): VideoJob {
  const back = returned(j, index);
  return settle(rejectClip(back.job, index, back.url));
}

const shotOf = (j: VideoJob, index: number) => j.shots[index] as VideoJob["shots"][number];

describe("automatic redo of a clip with added lettering", () => {
  it("makes the next clip on another speaking model from the same picture and audio", () => {
    const before = job();
    expect(shotModel(before, shotOf(before, 0)).id).toBe(KLING.id);
    const j = captioned(before, 0);
    expect(shotOf(j, 0)).toMatchObject({ state: "queued", audio: "a0.mp3", autoRedos: 1 });
    expect(shotModel(j, shotOf(j, 0)).id).toBe(OMNI.id);
    expect(shotModel(j, shotOf(j, 1)).id).toBe(KLING.id);
  });

  it("goes back to the usual model when a video made on the other one adds lettering", () => {
    const j = captioned({ ...job(), model: OMNI.id }, 0);
    expect(shotOf(j, 0).state).toBe("queued");
    expect(shotModel(j, shotOf(j, 0)).id).toBe(KLING.id);
  });

  it("never pays for the same model twice: once every model added lettering the shot fails", () => {
    let j = captioned(job(), 0);
    j = captioned(j, 0);
    expect(shotOf(j, 0)).toMatchObject({ state: "failed", error: CLIP_NOT_USABLE });
    expect(j.autoRedos).toBe(1);
  });

  it("stops redoing anywhere in the video once the per-video limit is spent", () => {
    let j = job();
    for (let index = 0; index < MAX_AUTO_REDOS_PER_VIDEO; index++) j = captioned(j, index);
    expect(j.autoRedos).toBe(MAX_AUTO_REDOS_PER_VIDEO);
    j = captioned(j, MAX_AUTO_REDOS_PER_VIDEO);
    expect(shotOf(j, MAX_AUTO_REDOS_PER_VIDEO).state).toBe("failed");
    expect(j.autoRedos).toBe(MAX_AUTO_REDOS_PER_VIDEO);
  });

  it("keeps its counts and the rejected models through job.json, so a restart cannot repeat them", () => {
    const j = JSON.parse(JSON.stringify(captioned(job(), 0))) as VideoJob;
    expect(shotModel(j, shotOf(j, 0)).id).toBe(OMNI.id);
    expect(shotOf(captioned(j, 0), 0).state).toBe("failed");
  });

  it("counts a returned clip once however often it is polled again", () => {
    const back = returned(job(), 0);
    const once = rejectClip(back.job, 0, back.url);
    expect(rejectClip(once, 0, back.url)).toBe(once);
    expect(once.autoRedos).toBe(1);
    const other = returned(once, 0);
    expect(rejectClip(other.job, 0, back.url)).toBe(other.job);
  });

  it("lets the user redo a shot past the limits, and checks that clip once more", () => {
    let j = captioned(captioned(job(), 0), 0);
    expect(shotOf(j, 0).state).toBe("failed");
    j = retryShot(j, 0, NOW);
    expect(shotOf(j, 0).state).toBe("queued");
    j = captioned(j, 0);
    expect(shotOf(j, 0).state).toBe("failed");
    expect(j.autoRedos).toBe(1);
  });

  it("keeps the money paid for a discarded clip in what was spent", () => {
    const back = returned(job(), 0, 0.42);
    const before = spentUsd(back.job);
    const after = rejectClip(back.job, 0, back.url);
    expect(spentUsd(after)).toBeCloseTo(before);
    expect(redoneCharges(after).map((c) => c.usd)).toEqual([0.42]);
    const again = returned(after, 0, 0.42);
    expect(spentUsd(again.job)).toBeCloseTo(before + 0.42);
    expect(redoneCharges(again.job)).toHaveLength(1);
  });
});

describe("a shot that failed on added lettering before rejected models were recorded", () => {
  const failedEarlier = (error: string): VideoJob => {
    const j = { ...job(), status: "failed" as const };
    return {
      ...j,
      shots: j.shots.map((s) =>
        s.index === 0
          ? {
              ...s,
              state: "failed" as const,
              model: KLING.id,
              rejectedClips: 5,
              autoRedos: 2,
              audioSec: 2.5,
              error,
            }
          : { ...s, state: "done" as const, clip: `c${s.index}.mp4` },
      ),
    };
  };

  it("is tried again on the other model, and the price says so", () => {
    const j = withUnrecordedSpeakerRejections(failedEarlier(CLIP_NOT_USABLE));
    expect(shotEstimateUsd(j, shotOf(j, 0))).toBeCloseTo(clipUsd(OMNI, 4));
    const retried = retryShot(j, 0, NOW);
    expect(shotModel(retried, shotOf(retried, 0)).id).toBe(OMNI.id);
  });

  it("keeps its model when it failed for another reason", () => {
    const j = withUnrecordedSpeakerRejections(failedEarlier("Lỗi giả lập"));
    const retried = retryShot(j, 0, NOW);
    expect(shotModel(retried, shotOf(retried, 0)).id).toBe(KLING.id);
  });
});

describe("a broken checker never causes a paid redo", () => {
  it("retries the check once, then accepts the clip", async () => {
    const ask = vi.fn().mockRejectedValue(new Error("timed out"));
    await expect(addedLettering(ask)).resolves.toBeNull();
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("uses the second answer when the first attempt failed", async () => {
    const ask = vi.fn().mockRejectedValueOnce(new Error("busy")).mockResolvedValue("subtitles");
    await expect(addedLettering(ask)).resolves.toBe("subtitles");
  });

  it("treats an answer without a verdict as a failed check, not as lettering", () => {
    expect(() => readClipAnswer({ text: "a sign" })).toThrow();
    expect(() => readClipAnswer(null)).toThrow();
    expect(readClipAnswer({ added: null })).toBeNull();
    expect(readClipAnswer({ added: "none" })).toBeNull();
    expect(readClipAnswer({ added: "yellow subtitles at the bottom" })).toBe(
      "yellow subtitles at the bottom",
    );
  });
});
