import { describe, expect, it } from "vitest";
import { buildDirection } from "./build-direction";
import type { Script, Session } from "./ipc";
import { AUTO_MODELS } from "./models";
import { PACE_OF_VIDEOS_MADE_BEFORE_PACES } from "./pace";
import { builtinRecipe } from "./recipe";
import { jobNeedsYou, sessionSteps } from "./session-steps";
import { readShotList } from "./shot-list";
import { answer, CTX, LINES } from "./shot-list.fixture";
import { applyLivePlan, newJob, type VideoJob } from "./video-job";

const script = (id: string, fields: Partial<Script> = {}): Script => ({
  id,
  title: id,
  hook: "",
  lines: LINES,
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

function staged(scriptId: string, fields: Partial<VideoJob> = {}): VideoJob {
  const { list } = readShotList(answer(), CTX, { motion: true, sound: true });
  const live = buildDirection({
    list,
    recipe: builtinRecipe(AUTO_MODELS),
    cast: [
      { id: "a", name: "An", photos: 3 },
      { id: "b", name: "Ba", photos: 2 },
    ],
    placePhotos: 3,
    pace: PACE_OF_VIDEOS_MADE_BEFORE_PACES,
  });
  const fresh = newJob({
    sessionId: "s",
    seriesId: "x",
    scriptId,
    title: scriptId,
    lines: LINES,
    useEnvironment: true,
    models: AUTO_MODELS,
    now: "2026-01-01T00:00:00Z",
  });
  return { ...applyLivePlan(fresh, live), status: "idle", ...fields };
}

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
  const finishedOnly = scripts.filter((s) => s.id !== "c");

  it("counts scripts that are not failed or deleted", () => {
    const steps = sessionSteps(session(), scripts, new Map());
    expect(steps.scripts).toBe(3);
  });

  it("keeps the scripts step open while a finished script waits to be staged", () => {
    const steps = sessionSteps(session(), finishedOnly, new Map([["a", staged("a")]]));
    expect(steps).toMatchObject({
      scriptsDone: false,
      stageable: true,
      toStage: 1,
      unstarted: 2,
      staged: 1,
    });
  });

  it("finishes the scripts step once every unstarted script is staged", () => {
    const steps = sessionSteps(
      session(),
      finishedOnly,
      new Map([
        ["a", staged("a")],
        ["b", staged("b")],
      ]),
    );
    expect(steps).toMatchObject({ scriptsDone: true, toStage: 0, unstarted: 2, staged: 2 });
  });

  it("is not done while a script is still being written", () => {
    const steps = sessionSteps(
      session(),
      scripts,
      new Map([
        ["a", staged("a")],
        ["b", staged("b")],
      ]),
    );
    expect(steps.scriptsDone).toBe(false);
  });

  it("asks to stage again once a staged script is edited", () => {
    const edited = finishedOnly.map((s) =>
      s.id === "a"
        ? { ...s, lines: LINES.map((l, i) => (i === 1 ? { ...l, text: "Khác" } : l)) }
        : s,
    );
    const steps = sessionSteps(
      session(),
      edited,
      new Map([
        ["a", staged("a")],
        ["b", staged("b")],
      ]),
    );
    expect(steps).toMatchObject({ scriptsDone: false, toStage: 1, staged: 1 });
  });

  it("counts staging in progress without asking for it again", () => {
    const steps = sessionSteps(
      session(),
      finishedOnly,
      new Map([
        ["a", staged("a")],
        ["b", job("idle", { planning: true })],
      ]),
    );
    expect(steps).toMatchObject({ toStage: 0, staging: 1, staged: 1 });
  });

  it("leaves started videos out of the staging counts", () => {
    const steps = sessionSteps(
      session({ approvedAt: "2026-01-02T00:00:00Z", committedScriptIds: ["a"] }),
      finishedOnly,
      new Map([
        ["a", staged("a", { status: "running" })],
        ["b", staged("b")],
      ]),
    );
    expect(steps).toMatchObject({ scriptsDone: true, unstarted: 1, staged: 1, sent: 1 });
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
    expect(steps).toMatchObject({ sent: 2, done: 1, waiting: 0, running: 1 });
  });

  it("puts waiting videos first and counts a missing job as waiting", () => {
    const steps = sessionSteps(
      session({ approvedAt: "2026-01-02T00:00:00Z", committedScriptIds: ["a", "b"] }),
      scripts,
      new Map([["a", job("running")]]),
    );
    expect(steps.waiting).toBe(1);
  });

  it("counts nothing as done, waiting or staged while jobs load", () => {
    const steps = sessionSteps(
      session({ approvedAt: "2026-01-02T00:00:00Z", committedScriptIds: ["a"] }),
      scripts,
      null,
    );
    expect(steps).toMatchObject({
      scriptsDone: false,
      sent: 1,
      done: 0,
      waiting: 0,
      running: 0,
      staged: 0,
    });
  });
});
