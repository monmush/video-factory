import { describe, expect, it } from "vitest";
import { buildDirection } from "./build-direction";
import { batchToMake } from "./cost/estimate";
import type { DirectionEntry } from "./direction";
import type { Script } from "./ipc";
import { AUTO_MODELS } from "./models";
import { PACE_OF_VIDEOS_MADE_BEFORE_PACES } from "./pace";
import { builtinRecipe } from "./recipe";
import { readShotList } from "./shot-list";
import { answer, CTX, LINES } from "./shot-list.fixture";
import { freeSettle, outdatedReasons, readyToMake, stagingStatus } from "./staging-status";
import { applyLivePlan, followSeriesModels, newJob, type VideoJob } from "./video-job";

const NOW = "2026-11-23T10:00:00.000Z";
const CAST = [
  { id: "a", name: "An", photos: 3 },
  { id: "b", name: "Ba", photos: 2 },
];
const WISH: DirectionEntry = { want: "Ấm áp hơn", at: NOW };

function staged(fields: Partial<VideoJob> = {}): VideoJob {
  const { list } = readShotList(answer(), CTX, { motion: true, sound: true });
  const live = buildDirection({
    list,
    recipe: builtinRecipe(AUTO_MODELS),
    cast: CAST,
    placePhotos: 3,
    pace: PACE_OF_VIDEOS_MADE_BEFORE_PACES,
  });
  const job = newJob({
    sessionId: "s",
    seriesId: "r",
    scriptId: "x",
    title: "t",
    lines: LINES,
    useEnvironment: true,
    models: AUTO_MODELS,
    now: NOW,
  });
  return {
    ...applyLivePlan(job, live),
    status: "idle",
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
    expect(stagingStatus(job, script())).toBe("ready");
    const spaced = [
      ...LINES.map((l) => ({ ...l, text: ` ${l.text} ` })),
      { characterId: null, speaker: "?", text: "" },
    ];
    expect(stagingStatus(job, script({ lines: spaced }))).toBe("ready");
  });

  it("names each change on its own", () => {
    const job = staged();
    expect(outdatedReasons(job, script({ lines: reworded("Ừ, ngồi đi.") }))).toEqual(["words"]);
    expect(outdatedReasons(job, script({ productIds: ["q"] }))).toEqual(["product"]);
    expect(outdatedReasons({ ...job, direction: [WISH] }, script())).toEqual(["wishes"]);
  });

  it("is current again once a change is undone, without staging again", () => {
    const job = staged({ direction: [WISH], stagedDirection: [WISH] });
    expect(stagingStatus(job, script({ lines: reworded("Ừ, ngồi đi.") }))).toBe("outdated");
    expect(stagingStatus(job, script())).toBe("ready");
    expect(stagingStatus({ ...job, direction: [] }, script())).toBe("outdated");
    expect(stagingStatus({ ...job, direction: [{ ...WISH, at: "later" }] }, script())).toBe(
      "ready",
    );
  });

  it("does not hold an older saved job to products or wishes it never recorded", () => {
    const old = staged({
      productIds: undefined,
      stagedDirection: undefined,
      direction: [WISH],
    });
    expect(outdatedReasons(old, script({ productIds: ["q"] }))).toEqual([]);
  });

  it("stays current when the series' models change", () => {
    const other = followSeriesModels(staged(), {
      image: "nano-banana-pro",
      video: "minimax-h3-max",
    });
    expect(other.models?.video).toBe("minimax-h3-max");
    expect(outdatedReasons(other, script())).toEqual([]);
    expect(readyToMake(other, script())).toBe(true);
  });

  it("never calls a video that has started out of date", () => {
    const running = staged({ status: "running" });
    const changed = script({ lines: reworded("Ừ, ngồi đi."), productIds: [] });
    expect(stagingStatus(running, changed)).toBe("started");
    expect(outdatedReasons(running, changed)).toEqual([]);
  });

  it("only counts a staging as running when someone asked for it", () => {
    const empty = newJob({
      sessionId: "s",
      seriesId: "r",
      scriptId: "x",
      title: "t",
      lines: LINES,
      useEnvironment: true,
      models: AUTO_MODELS,
      now: NOW,
    });
    const idle: VideoJob = { ...empty, status: "idle" };
    expect(stagingStatus(null, script())).toBe("none");
    expect(stagingStatus(idle, script())).toBe("none");
    expect(stagingStatus({ ...idle, planning: true }, script())).toBe("staging");
    expect(stagingStatus({ ...idle, status: "failed" }, script())).toBe("failed");
    expect(stagingStatus(staged(), script({ status: "writing" }))).toBe("none");
  });

  it("does not count a staging made while the series had no place", () => {
    const placeless = staged({ useEnvironment: false });
    expect(stagingStatus(placeless, script())).toBe("none");
    expect(readyToMake(placeless, script())).toBe(false);
    expect(batchToMake([placeless, staged()]).count).toBe(1);
    expect(outdatedReasons(placeless, script({ productIds: ["q"] }))).toEqual([]);

    const started = staged({ useEnvironment: false, status: "stopped" });
    expect(stagingStatus(started, script())).toBe("started");
    expect(readyToMake(started, script())).toBe(true);
  });

  it("can never be made from an outdated or missing staging", () => {
    expect(readyToMake(staged(), script())).toBe(true);
    expect(readyToMake(staged(), script({ productIds: ["q"] }))).toBe(false);
    expect(readyToMake(staged({ plan: undefined }), script())).toBe(false);
    expect(readyToMake(staged({ planning: true }), script())).toBe(false);
  });
});

describe("settling what a change allows for free", () => {
  it("removes the staging of a deleted script", () => {
    expect(freeSettle(staged(), undefined).step).toBe("remove");
    expect(freeSettle(staged(), script({ deletedAt: NOW })).step).toBe("remove");
  });

  it("stops a running staging made for words that changed or a script that is gone", () => {
    const planning = staged({ plan: undefined, planning: true });
    expect(freeSettle(planning, script()).abort).toBe(false);
    expect(freeSettle(planning, script({ lines: reworded("Ừ.") })).abort).toBe(true);
    expect(freeSettle(planning, undefined).abort).toBe(true);
  });

  it("follows a product in code, and otherwise keeps the old staging", () => {
    expect(freeSettle(staged(), script({ productIds: ["q"] })).step).toBe("product");
    expect(freeSettle(staged(), script({ lines: reworded("Ừ.") })).step).toBe("keep");
    expect(freeSettle(staged(), script()).step).toBe("keep");
  });

  it("leaves a video that has started alone", () => {
    const started = staged({ status: "stopped" });
    expect(freeSettle(started, undefined).step).toBe("keep");
    expect(freeSettle(started, script({ productIds: ["q"] })).step).toBe("keep");
  });
});
