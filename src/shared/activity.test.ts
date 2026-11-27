import { describe, expect, it } from "vitest";
import { type ActivityEvent, jobEvents, scriptEvents } from "./activity";
import type { Script } from "./ipc";
import { finished, NOW, plannedJob, running } from "./job.fixture";
import type { VideoJob } from "./video-job";

const named = <N extends ActivityEvent["name"]>(events: ActivityEvent[], name: N) =>
  events.filter((e): e is Extract<ActivityEvent, { name: N }> => e.name === name);

const LATER = "2026-11-25T10:05:00.000Z";

function madeWithCharges(): VideoJob {
  const job = finished(running(plannedJob()));
  return {
    ...job,
    status: "running",
    phaseSec: { plan: 20, frames: 60, shots: 300, assemble: 15 },
    charges: [
      { at: NOW, kind: "still", step: "frame:kf:a", usd: 0.1, billed: false, requestId: "r1" },
      { at: NOW, kind: "clip", step: "shot:0", usd: 0.5, billed: false, requestId: "r2" },
      { at: NOW, kind: "clip", step: "shot:0", usd: 0.5, billed: false, requestId: "r3" },
    ],
  };
}

describe("jobEvents", () => {
  it("records nothing for a later save of an unchanged job", () => {
    const job = running(plannedJob());
    expect(jobEvents(job, { ...job, updatedAt: LATER })).toEqual([]);
  });

  it("reports a finished video once, with its cost and making time", () => {
    const before = madeWithCharges();
    const after: VideoJob = { ...before, status: "done" };
    const [done] = named(jobEvents(before, after), "video-done");
    expect(done?.spentUsd).toBeCloseTo(1.1);
    expect(done?.costByKind.clip).toBeCloseTo(1);
    expect(done?.totalSec).toBe(395);
    expect(named(jobEvents(after, { ...after, updatedAt: LATER }), "video-done")).toEqual([]);
  });

  it("reports a mishap once, when it is added", () => {
    const before = running(plannedJob());
    const shots = before.shots.map((s, i) =>
      i === 1 ? { ...s, mishaps: [{ kind: "lettering" as const, at: LATER }] } : s,
    );
    const after = { ...before, shots };
    expect(named(jobEvents(before, after), "video-mishap")).toEqual([
      expect.objectContaining({ kind: "lettering", place: "shot", index: 1 }),
    ]);
    expect(named(jobEvents(after, { ...after, updatedAt: LATER }), "video-mishap")).toEqual([]);
  });

  it("gives the seconds spent in the phase it leaves", () => {
    const before: VideoJob = { ...running(plannedJob()), phaseSec: { frames: 42 } };
    const after: VideoJob = {
      ...before,
      frames: before.frames.map((f) => ({ ...f, file: `${f.id}.png` })),
    };
    expect(named(jobEvents(before, after), "video-phase")).toEqual([
      expect.objectContaining({ left: "frames", entered: "speech", leftSec: 42 }),
    ]);
  });

  it("names the requests the kept cut uses, not the redone ones", () => {
    const before = madeWithCharges();
    const shots = before.shots.map((s) =>
      s.index === 0 ? { ...s, requestId: "r3", costUsd: 0.5 } : s,
    );
    const frames = before.frames.map((f, i) => (i === 0 ? { ...f, requestId: "r1" } : f));
    const [done] = named(
      jobEvents(before, { ...before, shots, frames, status: "done" }),
      "video-done",
    );
    expect(done?.usedRequestIds).toContain("r3");
    expect(done?.usedRequestIds).not.toContain("r2");
  });
});

const script = (id: string, fields: Partial<Script> = {}): Script => ({
  id,
  title: `Kịch bản ${id}`,
  hook: "",
  lines: [{ characterId: null, speaker: "An", text: "Xin chào" }],
  productIds: [],
  staging: "",
  status: "ready",
  brief: { kind: "topic" },
  mark: null,
  pinned: false,
  deletedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...fields,
});

describe("scriptEvents", () => {
  it("reports a card once its lines are written, not while it is empty", () => {
    const empty = script("a", { lines: [], status: "writing" });
    expect(scriptEvents("s", [], [empty], 45)).toEqual([]);
    expect(scriptEvents("s", [empty], [script("a")], 45)).toEqual([
      expect.objectContaining({ name: "script-added", scriptId: "a", text: "An: Xin chào" }),
    ]);
  });

  it("stays quiet while a script is rewritten, then reports the change", () => {
    const ready = script("a");
    const writing = { ...ready, status: "writing" as const };
    expect(scriptEvents("s", [ready], [writing], 45)).toEqual([]);
    const rewritten = script("a", { lines: [{ characterId: null, speaker: "An", text: "Chào" }] });
    expect(scriptEvents("s", [writing], [rewritten], 45).map((e) => e.name)).toEqual([
      "script-changed",
    ]);
  });

  it("reports a deleted script as removed", () => {
    const ready = script("a");
    expect(scriptEvents("s", [ready], [{ ...ready, deletedAt: LATER }], 45)).toEqual([
      expect.objectContaining({ name: "script-removed", scriptId: "a" }),
    ]);
  });
});
