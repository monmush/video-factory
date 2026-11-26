import { describe, expect, it } from "vitest";
import { AUTO_MODELS } from "./models";
import { clocked, phaseSecNow, restartedClock, totalSec } from "./phase-clock";
import { newJob, type VideoJob } from "./video-job";

const T0 = Date.parse("2026-11-23T10:00:00.000Z");
const at = (sec: number) => T0 + sec * 1000;
const iso = (sec: number) => new Date(at(sec)).toISOString();

const job = (patch: Partial<VideoJob> = {}): VideoJob => ({
  ...newJob({
    sessionId: "s",
    seriesId: "r",
    scriptId: "k",
    title: "",
    lines: [],
    useEnvironment: false,
    models: AUTO_MODELS,
    now: iso(0),
  }),
  ...patch,
});

const planned = { plan: [] as unknown as VideoJob["plan"] };

describe("clocked", () => {
  it("adds the time since the last change to the phase the job was in before it", () => {
    const before = job({ status: "running", clockAt: iso(0), phaseSec: { plan: 5 } });
    const after = clocked(before, { ...before, ...planned }, at(30));
    expect(after.phaseSec).toEqual({ plan: 35 });
    expect(after.clockAt).toBe(iso(30));
    const later = clocked(after, after, at(40));
    expect(later.phaseSec).toEqual({ plan: 35, voice: 10 });
  });

  it("counts nothing while the job is not running", () => {
    for (const status of ["waiting", "review", "stopped", "failed", "done"] as const) {
      const before = job({ status, clockAt: iso(0), phaseSec: { plan: 5 } });
      const after = clocked(before, { ...before, status: "running" }, at(60));
      expect(after.phaseSec).toEqual({ plan: 5 });
    }
  });

  it("stops the clock when the job leaves running, so the pause is not counted later", () => {
    const running = job({ status: "running", clockAt: iso(0) });
    const paused = clocked(running, { ...running, status: "review" }, at(10));
    expect(paused.clockAt).toBeUndefined();
    const resumed = clocked(paused, { ...paused, status: "running" }, at(500));
    expect(resumed.phaseSec).toEqual({ plan: 10 });
    expect(clocked(resumed, resumed, at(503)).phaseSec).toEqual({ plan: 13 });
  });

  it("ignores a clock that runs backwards", () => {
    const before = job({ status: "running", clockAt: iso(100), phaseSec: { plan: 5 } });
    expect(clocked(before, before, at(50)).phaseSec).toEqual({ plan: 5 });
  });
});

describe("restartedClock", () => {
  it("drops the time the app was closed", () => {
    const saved = job({ status: "running", clockAt: iso(0), phaseSec: { plan: 5 } });
    const loaded = restartedClock(saved, at(3600));
    expect(clocked(loaded, loaded, at(3602)).phaseSec).toEqual({ plan: 7 });
    expect(restartedClock(job({ status: "stopped", clockAt: iso(0) }), at(9)).clockAt).toBe(
      undefined,
    );
  });
});

describe("phaseSecNow", () => {
  it("adds the running part of the current phase to the saved time", () => {
    const running = job({ status: "running", clockAt: iso(0), phaseSec: { plan: 5 } });
    expect(totalSec(phaseSecNow(running, at(12)))).toBe(17);
    expect(totalSec(phaseSecNow({ ...running, status: "stopped" }, at(12)))).toBe(5);
  });
});
