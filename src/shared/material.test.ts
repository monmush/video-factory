import { describe, expect, it } from "vitest";
import type { LiveDirection } from "./live-plan";
import { type MaterialItem, materialOfVideo, materialState, sceneIdOfVideo } from "./material";
import type { Picture } from "./shot-list";
import type { ShotPlan } from "./shot-plan";
import type { JobFrame, JobShot, VideoJob } from "./video-job";

const NOW = "2026-11-25T10:00:00.000Z";

const frame = (keyframe: string, patch: Partial<JobFrame> = {}): JobFrame => ({
  id: `kf:${keyframe}`,
  keyframe,
  kind: "character",
  characterId: "a",
  file: `${keyframe}.png`,
  source: "generated",
  costUsd: 0.05,
  retried: false,
  ...patch,
});

const shot = (index: number, keyframe: string, patch: Partial<JobShot> = {}): JobShot => ({
  index,
  route: "motion",
  keyframe,
  kind: "speaker",
  framing: null,
  lineIndex: 0,
  characterId: "a",
  speaker: "A",
  text: "",
  visual: "",
  productId: null,
  state: "done",
  clip: `shot-${index}.mp4`,
  clipSec: 5,
  brief: `Cảnh ${index}`,
  retried: false,
  failures: 0,
  ...patch,
});

const live = { plan: { routes: [] } } as unknown as LiveDirection;

const finished = (patch: Partial<VideoJob> = {}): VideoJob => ({
  version: 2,
  sessionId: "s",
  scriptId: "1",
  seriesId: "x",
  status: "done",
  queuedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
  title: "T",
  lines: [],
  useEnvironment: true,
  live,
  final: "final.mp4",
  frames: [frame("close")],
  shots: [shot(0, "close")],
  ...patch,
});

const PICTURES: Picture[] = [
  {
    id: "close",
    kind: "character",
    characterId: "a",
    people: ["a"],
    framing: "close-up",
    description: "A smiles",
  },
];

const ASSETS = [
  { id: "a", images: [{ id: "a1" }, { id: "a2" }, { id: "a3" }, { id: "a4" }] },
  { id: "room", images: [{ id: "r1" }, { id: "r2" }, { id: "r3" }] },
];
const PLACE = ASSETS[1];

const filed = (job: VideoJob) =>
  materialOfVideo(job, PICTURES, PLACE, ASSETS).map((d) => `${d.kind}:${d.source.file}`);

describe("materialOfVideo", () => {
  it("files a generated picture and its silent moving clip", () => {
    expect(filed(finished())).toEqual(["picture:close.png", "clip:shot-0.mp4"]);
  });

  it("leaves out a picture the still check complained about, and its clip", () => {
    expect(filed(finished({ frames: [frame("close", { check: "two noses" })] }))).toEqual([]);
  });

  it("never files a speaking clip", () => {
    const shots = [shot(0, "close", { speech: "line-0.mp3" })];
    expect(filed(finished({ shots }))).toEqual(["picture:close.png"]);
  });

  it("never files a product picture", () => {
    const frames = [frame("cup", { kind: "product", productId: "p" })];
    expect(filed(finished({ frames, shots: [shot(0, "cup")] }))).toEqual([]);
  });

  it("files nothing from a video that is not finished", () => {
    expect(filed(finished({ status: "running" }))).toEqual([]);
    expect(filed(finished({ final: undefined }))).toEqual([]);
  });

  it("never files a clip that was itself taken from the store, nor a picture taken from it", () => {
    expect(filed(finished({ shots: [shot(0, "close", { reused: "c1" })] }))).toEqual([
      "picture:close.png",
    ]);
    expect(filed(finished({ frames: [frame("close", { source: "material" })] }))).toEqual([]);
  });

  it("carries the key a picture stands for, and the scene's seats and props on the master", () => {
    const plan = {
      seats: [{ characterId: "a", side: "centre", looks: "camera", behind: "a wall" }],
      props: [{ name: "teapot", where: "on the table" }],
    } as unknown as ShotPlan;
    const frames = [frame("wide", { kind: "wide", material: "K" }), frame("close")];
    const [master, close] = materialOfVideo(finished({ plan, frames }), PICTURES, PLACE, ASSETS);
    expect(master).toMatchObject({ role: "scene", key: "K" });
    expect(master?.scene).toEqual({
      seats: [{ characterId: "a", side: "centre", looks: "camera", behind: "a wall" }],
      props: [{ name: "teapot", where: "on the table" }],
    });
    expect(close).not.toHaveProperty("scene");
  });

  it("records the reference photos a picture was made from", () => {
    const [picture] = materialOfVideo(finished(), PICTURES, PLACE, ASSETS);
    expect(picture?.madeFrom).toEqual([
      { assetId: "a", imageIds: ["a1", "a2", "a3"] },
      { assetId: "room", imageIds: ["r1", "r2"] },
    ]);
  });
});

const item = (patch: Partial<MaterialItem> = {}): MaterialItem => ({
  id: "i",
  kind: "picture",
  role: "character",
  file: "i.png",
  framing: "",
  description: "",
  caption: "",
  people: ["a"],
  madeFrom: [{ assetId: "a", imageIds: ["a1", "a2"] }],
  level: "",
  costUsd: null,
  source: { sessionId: "s", scriptId: "1", file: "close.png", title: "T", at: NOW },
  kept: false,
  reusable: true,
  uses: [],
  ...patch,
});

describe("materialState", () => {
  it("goes out of date when a photo it was made from is removed", () => {
    expect(materialState(item(), [{ id: "a", images: [{ id: "a1" }] }])).toBe("outdated");
  });

  it("stays current when a photo is added", () => {
    const more = [{ id: "a", images: [{ id: "a1" }, { id: "a2" }, { id: "a5" }] }];
    expect(materialState(item(), more)).toBe("current");
  });
});

describe("sceneIdOfVideo", () => {
  const withMaster = (master: Partial<JobFrame>) =>
    finished({
      live: {
        plan: { routes: [], keyframes: [{ id: "m", kind: "master" }] },
      } as unknown as LiveDirection,
      frames: [frame("m", { kind: "wide", ...master })],
    });

  it("is the store item filed for the video's own master", () => {
    const filedMaster = item({ id: "filed", source: { ...item().source, file: "m.png" } });
    expect(sceneIdOfVideo(withMaster({}), [item(), filedMaster])).toBe("filed");
  });

  it("is the store item the master was taken from", () => {
    expect(sceneIdOfVideo(withMaster({ source: "material", material: "earlier" }), [])).toBe(
      "earlier",
    );
  });
});
