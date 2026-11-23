import { describe, expect, it } from "vitest";
import { buildDirection } from "./build-direction";
import type { DirectionEntry } from "./direction";
import type { Script } from "./ipc";
import { mediaLevel } from "./media-level";
import { builtinRecipe } from "./recipe";
import { readShotList } from "./shot-list";
import { answer, CTX, LINES } from "./shot-list.fixture";
import { freeSettle, outdatedReasons, readyToMake, stagingStatus } from "./staging-status";
import { applyLivePlan, newJob, type VideoJob } from "./video-job";

const NOW = "2026-11-23T10:00:00.000Z";
const CAST = [
  { id: "a", name: "An", photos: 3 },
  { id: "b", name: "Ba", photos: 2 },
];
const WISH: DirectionEntry = { want: "Ấm áp hơn", at: NOW };

function staged(levelId = "balanced", fields: Partial<VideoJob> = {}): VideoJob {
  const level = mediaLevel(levelId);
  const { list } = readShotList(answer(), CTX, { motion: level.motion, sound: level.sound });
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
  return {
    ...applyLivePlan(job, live),
    status: "idle",
    level: level.id,
    productIds: ["p"],
    stagedDirection: [],
    ...fields,
  };
}

const script = (fields: Partial<Script> = {}): Script => ({
  id: "x",
  title: "t",
  hook: "",
  lines: LINES,
  productIds: ["p"],
  staging: "",
  status: "ready",
  brief: { kind: "topic", targetSec: 45 },
  mark: null,
  pinned: false,
  deletedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...fields,
});

const reworded = (text: string) => LINES.map((l, i) => (i === 1 ? { ...l, text } : l));

describe("whether a staging still fits its script", () => {
  it("is current while nothing changed, even if only spacing or empty lines differ", () => {
    const job = staged();
    expect(stagingStatus(job, script(), "balanced")).toBe("ready");
    const spaced = [
      ...LINES.map((l) => ({ ...l, text: ` ${l.text} ` })),
      { characterId: null, speaker: "?", text: "" },
    ];
    expect(stagingStatus(job, script({ lines: spaced }), "balanced")).toBe("ready");
  });

  it("names each change on its own", () => {
    const job = staged();
    expect(outdatedReasons(job, script({ lines: reworded("Ừ, ngồi đi.") }), "balanced")).toEqual([
      "words",
    ]);
    expect(outdatedReasons(job, script({ productIds: ["q"] }), "balanced")).toEqual(["product"]);
    expect(outdatedReasons(job, script(), "fast")).toEqual(["quality"]);
    expect(outdatedReasons({ ...job, direction: [WISH] }, script(), "balanced")).toEqual([
      "wishes",
    ]);
  });

  it("is current again once a change is undone, without staging again", () => {
    const job = staged("balanced", { direction: [WISH], stagedDirection: [WISH] });
    expect(stagingStatus(job, script({ lines: reworded("Ừ, ngồi đi.") }), "balanced")).toBe(
      "outdated",
    );
    expect(stagingStatus(job, script(), "balanced")).toBe("ready");
    expect(stagingStatus({ ...job, direction: [] }, script(), "balanced")).toBe("outdated");
    expect(
      stagingStatus({ ...job, direction: [{ ...WISH, at: "later" }] }, script(), "balanced"),
    ).toBe("ready");
  });

  it("does not hold an older saved job to products or wishes it never recorded", () => {
    const old = staged("balanced", {
      productIds: undefined,
      stagedDirection: undefined,
      direction: [WISH],
    });
    expect(outdatedReasons(old, script({ productIds: ["q"] }), "balanced")).toEqual([]);
  });

  it("moves between levels with the same staging without going out of date", () => {
    expect(outdatedReasons(staged("balanced"), script(), "high")).toEqual([]);
    expect(readyToMake(staged("balanced"), script(), "high")).toBe(true);
  });

  it("never calls a video that has started out of date", () => {
    const running = staged("balanced", { status: "running" });
    const changed = script({ lines: reworded("Ừ, ngồi đi."), productIds: [] });
    expect(stagingStatus(running, changed, "fast")).toBe("started");
    expect(outdatedReasons(running, changed, "fast")).toEqual([]);
  });

  it("only counts a staging as running when someone asked for it", () => {
    const empty = newJob({
      sessionId: "s",
      seriesId: "r",
      scriptId: "x",
      title: "t",
      lines: LINES,
      useEnvironment: true,
      now: NOW,
    });
    const idle: VideoJob = { ...empty, status: "idle" };
    expect(stagingStatus(null, script(), "balanced")).toBe("none");
    expect(stagingStatus(idle, script(), "balanced")).toBe("none");
    expect(stagingStatus({ ...idle, planning: true }, script(), "balanced")).toBe("staging");
    expect(stagingStatus({ ...idle, status: "failed" }, script(), "balanced")).toBe("failed");
    expect(stagingStatus(staged(), script({ status: "writing" }), "balanced")).toBe("none");
  });

  it("can never be made from an outdated or missing staging", () => {
    expect(readyToMake(staged(), script(), "balanced")).toBe(true);
    expect(readyToMake(staged(), script({ productIds: ["q"] }), "balanced")).toBe(false);
    expect(readyToMake(staged("balanced", { plan: undefined }), script(), "balanced")).toBe(false);
    expect(readyToMake(staged("balanced", { planning: true }), script(), "balanced")).toBe(false);
  });
});

describe("settling what a change allows for free", () => {
  it("removes the staging of a deleted script", () => {
    expect(freeSettle(staged(), undefined, "balanced").step).toBe("remove");
    expect(freeSettle(staged(), script({ deletedAt: NOW }), "balanced").step).toBe("remove");
  });

  it("stops a running staging made for words that changed or a script that is gone", () => {
    const planning = staged("balanced", { plan: undefined, planning: true });
    expect(freeSettle(planning, script(), "balanced").abort).toBe(false);
    expect(freeSettle(planning, script({ lines: reworded("Ừ.") }), "balanced").abort).toBe(true);
    expect(freeSettle(planning, undefined, "balanced").abort).toBe(true);
  });

  it("follows a product or a level in code, and otherwise keeps the old staging", () => {
    expect(freeSettle(staged(), script({ productIds: ["q"] }), "balanced").step).toBe("product");
    expect(freeSettle(staged(), script(), "high").step).toBe("level");
    expect(freeSettle(staged(), script(), "fast").step).toBe("keep");
    expect(freeSettle(staged(), script({ lines: reworded("Ừ.") }), "high").step).toBe("keep");
    expect(freeSettle(staged(), script(), "balanced").step).toBe("keep");
  });

  it("leaves a video that has started alone", () => {
    const started = staged("balanced", { status: "stopped" });
    expect(freeSettle(started, undefined, "balanced").step).toBe("keep");
    expect(freeSettle(started, script({ productIds: ["q"] }), "high").step).toBe("keep");
  });
});
