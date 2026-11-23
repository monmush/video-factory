import { describe, expect, it } from "vitest";
import type { Script, Session } from "./ipc";
import { jobNeedsYou, sessionSteps } from "./session-steps";
import type { VideoJob } from "./video-job";

const script = (id: string, fields: Partial<Script> = {}): Script => ({
  id,
  title: id,
  hook: "",
  lines: [],
  productIds: [],
  staging: "",
  status: "ready",
  brief: { kind: "topic", targetSec: 45 },
  mark: null,
  pinned: false,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "",
  ...fields,
});

const session = (fields: Partial<Session> = {}): Session => ({
  id: "s",
  seriesId: "x",
  name: "s",
  approvedAt: null,
  createdAt: "",
  updatedAt: "",
  ...fields,
});

const job = (status: VideoJob["status"], fields: Partial<VideoJob> = {}) =>
  ({ status, ...fields }) as VideoJob;

describe("jobNeedsYou", () => {
  it("waits on the operator when missing, idle, at review, stopped or failed", () => {
    expect(jobNeedsYou(null)).toBe(true);
    expect(jobNeedsYou(job("idle"))).toBe(true);
    expect(jobNeedsYou(job("review"))).toBe(true);
    expect(jobNeedsYou(job("stopped"))).toBe(true);
    expect(jobNeedsYou(job("failed"))).toBe(true);
  });
  it("does not while planning, running, queued or done", () => {
    expect(jobNeedsYou(job("idle", { planning: true }))).toBe(false);
    expect(jobNeedsYou(job("running"))).toBe(false);
    expect(jobNeedsYou(job("waiting"))).toBe(false);
    expect(jobNeedsYou(job("done"))).toBe(false);
  });
});

describe("sessionSteps", () => {
  const scripts = [
    script("a"),
    script("b"),
    script("c", { status: "writing" }),
    script("d", { status: "failed" }),
    script("e", { deletedAt: "2026-01-02T00:00:00Z" }),
  ];

  it("counts scripts that are not failed or deleted, before approval", () => {
    const steps = sessionSteps(session(), scripts, new Map());
    expect(steps).toMatchObject({ scripts: 3, scriptsDone: false, toSend: 2, sent: 0 });
  });

  it("counts sent videos by state", () => {
    const steps = sessionSteps(
      session({ approvedAt: "2026-01-02T00:00:00Z", committedScriptIds: ["a", "b"] }),
      scripts,
      new Map([
        ["a", job("done")],
        ["b", job("running")],
      ]),
    );
    expect(steps).toMatchObject({
      scriptsDone: true,
      toSend: 0,
      sent: 2,
      done: 1,
      waiting: 0,
      running: 1,
    });
  });

  it("is not done while a finished script is unsent", () => {
    const steps = sessionSteps(
      session({ approvedAt: "2026-01-02T00:00:00Z", committedScriptIds: ["a"] }),
      scripts,
      new Map([["a", job("done")]]),
    );
    expect(steps.scriptsDone).toBe(false);
    expect(steps.toSend).toBe(1);
  });

  it("puts waiting videos first and counts a missing job as waiting", () => {
    const steps = sessionSteps(
      session({ approvedAt: "2026-01-02T00:00:00Z", committedScriptIds: ["a", "b"] }),
      scripts,
      new Map([["a", job("running")]]),
    );
    expect(steps.waiting).toBe(1);
  });

  it("counts nothing as done or waiting while jobs load", () => {
    const steps = sessionSteps(
      session({ approvedAt: "2026-01-02T00:00:00Z", committedScriptIds: ["a"] }),
      scripts,
      null,
    );
    expect(steps).toMatchObject({ sent: 1, done: 0, waiting: 0, running: 0 });
  });
});
