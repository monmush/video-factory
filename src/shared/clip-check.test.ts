import { describe, expect, it, vi } from "vitest";
import {
  addedLettering,
  CLIP_NOT_USABLE,
  MAX_AUTO_REDOS_PER_SHOT,
  MAX_AUTO_REDOS_PER_VIDEO,
  readClipAnswer,
  rejectClip,
} from "./clip-check";
import { redoneCharges, spentUsd } from "./cost/charges";
import { withInUsePaid } from "./cost/charges.fixture";
import { NOW, placed, plannedJob, running, spoken, withStills } from "./job.fixture";
import { retryShot, settle, type VideoJob } from "./video-job";

const MOVING = 1;

const job = (): VideoJob => running(placed(spoken(withStills(plannedJob()))));

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
              endpoint: "alibaba/wan-3.0/image-to-video",
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
  it("sends the moving shot again from the same picture, a limited number of times", () => {
    let j = captioned(job(), MOVING);
    expect(shotOf(j, MOVING)).toMatchObject({ state: "queued", autoRedos: 1, rejectedClips: 1 });
    expect(shotOf(j, MOVING).endpoint).toBeUndefined();
    for (let n = 1; n < MAX_AUTO_REDOS_PER_SHOT; n++) j = captioned(j, MOVING);
    j = captioned(j, MOVING);
    expect(shotOf(j, MOVING)).toMatchObject({ state: "failed", error: CLIP_NOT_USABLE });
    expect(j.autoRedos).toBe(MAX_AUTO_REDOS_PER_SHOT);
  });

  it("stops redoing anywhere in the video once the per-video limit is spent", () => {
    let j = job();
    for (let index = 0; index < MAX_AUTO_REDOS_PER_VIDEO; index++) j = captioned(j, index);
    expect(j.autoRedos).toBe(MAX_AUTO_REDOS_PER_VIDEO);
    j = captioned(j, MAX_AUTO_REDOS_PER_VIDEO);
    expect(shotOf(j, MAX_AUTO_REDOS_PER_VIDEO).state).toBe("failed");
    expect(j.autoRedos).toBe(MAX_AUTO_REDOS_PER_VIDEO);
  });

  it("keeps its counts through job.json, so a restart cannot repeat them", () => {
    const j = JSON.parse(JSON.stringify(captioned(job(), MOVING))) as VideoJob;
    expect(shotOf(j, MOVING).autoRedos).toBe(1);
    expect(captioned(captioned(j, MOVING), MOVING).shots[MOVING]?.state).toBe("failed");
  });

  it("counts a returned clip once however often it is polled again", () => {
    const back = returned(job(), MOVING);
    const once = rejectClip(back.job, MOVING, back.url);
    expect(rejectClip(once, MOVING, back.url)).toBe(once);
    expect(once.autoRedos).toBe(1);
    const other = returned(once, MOVING);
    expect(rejectClip(other.job, MOVING, back.url)).toBe(other.job);
  });

  it("lets the user redo a shot past the limits, and checks that clip once more", () => {
    let j = captioned(captioned(captioned(job(), MOVING), MOVING), MOVING);
    expect(shotOf(j, MOVING).state).toBe("failed");
    j = retryShot(j, MOVING, NOW);
    expect(shotOf(j, MOVING).state).toBe("queued");
    j = captioned(j, MOVING);
    expect(shotOf(j, MOVING).state).toBe("failed");
  });

  it("keeps the money paid for a discarded clip in what was spent", () => {
    const back = returned(job(), MOVING, 0.42);
    const before = spentUsd(back.job);
    const after = rejectClip(back.job, MOVING, back.url);
    expect(spentUsd(after)).toBeCloseTo(before);
    expect(redoneCharges(after).map((c) => c.usd)).toEqual([0.42]);
    const again = returned(after, MOVING, 0.42);
    expect(spentUsd(again.job)).toBeCloseTo(before + 0.42);
    expect(redoneCharges(again.job)).toHaveLength(1);
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
