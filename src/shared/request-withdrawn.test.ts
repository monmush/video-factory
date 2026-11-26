import { describe, expect, it } from "vitest";
import { placed, plannedJob, running, spoken, withStills } from "./job.fixture";
import { sentRequests } from "./paid-work";
import { type JobSound, soundToSend } from "./sound";
import type { JobSegment } from "./speech";
import { nextActions, requestWithdrawn, resumeJob, stopJob, type VideoJob } from "./video-job";

const NOW = "2026-11-21T10:00:00.000Z";
const LATER = "2026-11-21T10:05:00.000Z";

const inShots = (): VideoJob => running(placed(spoken(withStills(plannedJob()))));

const clipOut = (job: VideoJob): VideoJob => ({
  ...job,
  shots: job.shots.map((s) =>
    s.index === 1
      ? {
          ...s,
          state: "rendering" as const,
          requestId: "r1",
          submittedAt: NOW,
          endpoint: "some/endpoint",
          busyAnswers: 1,
          failures: 1,
          retried: true,
        }
      : s,
  ),
});

const continued = (job: VideoJob): VideoJob => ({ ...resumeJob(job, LATER), status: "running" });

describe("a request the provider withdrew", () => {
  it("leaves the clip unsent, so continuing the video sends it again", () => {
    const stopped = stopJob(clipOut(inShots()), LATER);
    const withdrawn = requestWithdrawn(stopped, { shot: 1 }, "r1");
    const shot = withdrawn.shots[1];
    expect(shot?.state).toBe("stopped");
    expect(shot?.requestId).toBeUndefined();
    expect(shot?.endpoint).toBeUndefined();
    expect(sentRequests(withdrawn)).toEqual([]);
    expect(nextActions(withdrawn, new Set())).toEqual([]);
    expect(nextActions(continued(withdrawn), new Set())).toContainEqual({
      kind: "submit-shot",
      index: 1,
    });
  });

  it("counts no failure or retry against the step, and charges nothing", () => {
    const stopped = stopJob(clipOut(inShots()), LATER);
    const withdrawn = requestWithdrawn(stopped, { shot: 1 }, "r1");
    expect(withdrawn.shots[1]?.failures).toBe(1);
    expect(withdrawn.shots[1]?.retried).toBe(true);
    expect(withdrawn.charges).toEqual(stopped.charges);
    expect(withdrawn.shots.filter((s) => s.index !== 1)).toEqual(
      stopped.shots.filter((s) => s.index !== 1),
    );
  });

  it("queues the clip at once when the video was continued before the answer came", () => {
    const resumedMeanwhile = continued(stopJob(clipOut(inShots()), LATER));
    const withdrawn = requestWithdrawn(resumedMeanwhile, { shot: 1 }, "r1");
    expect(withdrawn.shots[1]?.state).toBe("queued");
    expect(nextActions(withdrawn, new Set())).toContainEqual({ kind: "submit-shot", index: 1 });
  });

  it("does not touch a step whose result arrived or which was sent again since", () => {
    const stopped = stopJob(clipOut(inShots()), LATER);
    const arrived = {
      ...stopped,
      shots: stopped.shots.map((s) => (s.index === 1 ? { ...s, resultUrl: "https://clip" } : s)),
    };
    expect(requestWithdrawn(arrived, { shot: 1 }, "r1")).toEqual(arrived);
    expect(requestWithdrawn(stopped, { shot: 1 }, "an-older-request")).toEqual(stopped);
  });

  it("draws a withdrawn still again when the video continues", () => {
    const job = inShots();
    const stillOut: VideoJob = {
      ...job,
      frames: job.frames.map((f, i) =>
        i === 0 ? { ...f, file: undefined, requestId: "f1", retried: true } : f,
      ),
    };
    const withdrawn = requestWithdrawn(stopJob(stillOut, LATER), { frame: "kf:master" }, "f1");
    expect(withdrawn.frames[0]?.retried).toBe(true);
    expect(nextActions(withdrawn, new Set())).toEqual([]);
    expect(nextActions(continued(withdrawn), new Set())).toContainEqual({
      kind: "frame",
      frame: "kf:master",
    });
  });

  it("sends a withdrawn sound again without spending one of its attempts", () => {
    const sound: JobSound = {
      id: "ambience",
      role: "ambience",
      text: "wind",
      seconds: 2,
      loop: true,
      attempts: 1,
      requestId: "n1",
    };
    const withdrawn = requestWithdrawn(
      stopJob({ ...inShots(), sounds: [sound] }, LATER),
      { sound: "ambience" },
      "n1",
    );
    const after = withdrawn.sounds?.[0] as JobSound;
    expect(soundToSend(after)).toBe(true);
    expect(after.attempts).toBe(1);
  });

  it("puts a withdrawn speaking clip back to send on resume, its counters unchanged", () => {
    const segment: JobSegment = {
      id: "line-1-a",
      line: 0,
      shots: [0],
      speakerShot: 0,
      characterId: "a",
      text: "Con chào ông ạ",
      frame: "character:a",
      hold: 0,
      state: "rendering",
      model: "wan-3",
      seconds: 4,
      requestId: "g1",
      retried: true,
      failures: 1,
    };
    const job: VideoJob = { ...inShots(), segments: [segment] };
    const withdrawn = requestWithdrawn(stopJob(job, LATER), { segment: "line-1-a" }, "g1");
    const after = withdrawn.segments?.[0];
    expect(after?.state).toBe("stopped");
    expect(after?.requestId).toBeUndefined();
    expect(after?.failures).toBe(1);
    expect(after?.retried).toBe(true);
    expect(continued(withdrawn).segments?.[0]?.state).toBe("queued");
  });
});
