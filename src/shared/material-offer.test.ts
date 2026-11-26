import { describe, expect, it } from "vitest";
import type { LiveDirection, PlannedKeyframe } from "./live-plan";
import type { MaterialItem } from "./material";
import {
  MAX_OFFERED_PICTURES,
  materialOffer,
  type OfferInput,
  type OfferJob,
  withMaterialAvailability,
  withMaterialKeys,
} from "./material-offer";
import type { ShotList } from "./shot-list";
import type { ShotPlan } from "./shot-plan";
import type { JobFrame, JobShot, VideoJob } from "./video-job";

const SEATING = [
  { characterId: "a", side: "left", looks: "frame_right" },
  { characterId: "b", side: "right", looks: "frame_left" },
];
const SEATS = SEATING.map((s) => ({ ...s, behind: `behind ${s.characterId}` }));
const ASSETS = [
  { id: "a", images: [{ id: "a1" }] },
  { id: "b", images: [{ id: "b1" }] },
  { id: "room", images: [{ id: "r1" }] },
];
const MADE_FROM = [
  { assetId: "a", imageIds: ["a1"] },
  { assetId: "room", imageIds: ["r1"] },
];

const item = (id: string, patch: Partial<MaterialItem> = {}): MaterialItem => ({
  id,
  kind: "picture",
  role: "character",
  file: `${id}.png`,
  framing: "medium close-up",
  description: `picture ${id}`,
  caption: "",
  people: ["a"],
  sceneId: "scene",
  madeFrom: MADE_FROM,
  costUsd: 0.05,
  source: { sessionId: "s", scriptId: "old", file: `${id}.png`, title: "", at: "2026-11-01" },
  kept: false,
  reusable: true,
  uses: [],
  ...patch,
});

const SCENE = item("scene", {
  role: "scene",
  people: ["a", "b"],
  scene: { seats: SEATS, props: [{ name: "teapot", where: "on the table" }] },
});

const keyframe = (
  id: string,
  kind: PlannedKeyframe["kind"],
  material?: string,
): PlannedKeyframe => ({
  id,
  kind,
  characterId: kind === "character" ? "b" : null,
  framing: `${id} framing`,
  references: [],
  endpoint: "e",
  input: {},
  why: "",
  ...(material ? { material, description: `${id} description`, peopleIds: ["b"] } : {}),
});

const PLAN = { seats: SEATS, props: [{ name: "cup", where: "in hand" }] } as unknown as ShotPlan;

const staged = (
  scriptId: string,
  createdAt: string,
  keyframes: PlannedKeyframe[],
  frames: Partial<JobFrame>[] = [],
  shots: Partial<JobShot>[] = [],
): OfferJob => ({
  sessionId: "s",
  scriptId,
  createdAt,
  plan: PLAN,
  live: { plan: { keyframes, routes: [] } } as unknown as LiveDirection,
  frames: frames.map((f) => ({ id: "f", kind: "detail", retried: false, ...f })),
  shots: shots.map((s, index) => ({ index, ...s }) as JobShot),
});

const input = (patch: Partial<OfferInput> = {}): OfferInput => ({
  job: { sessionId: "s", scriptId: "now" },
  seating: SEATING,
  placeId: "room",
  items: [SCENE],
  assets: ASSETS,
  others: [],
  clipResolution: "1080p",
  ...patch,
});

describe("the scene a staging is given", () => {
  it("is the filed scene of the same seating and place, while it may be reused", () => {
    expect(materialOffer(input())?.scene).toMatchObject({
      key: "scene",
      seats: SEATS,
      props: [{ name: "teapot", where: "on the table" }],
    });
    const swapped = SEATING.map((s, i) => ({ ...s, side: i ? "left" : "right" }));
    expect(materialOffer(input({ seating: swapped }))).toBeNull();
    expect(materialOffer(input({ placeId: "garden" }))).toBeNull();
    expect(materialOffer(input({ items: [{ ...SCENE, reusable: false }] }))).toBeNull();
  });

  it("is another staging's planned master when nothing is filed, and the filed one wins", () => {
    const other = staged("first", "2026-11-20", [keyframe("m", "master", "planned-scene")]);
    expect(materialOffer(input({ items: [], others: [other] }))?.scene).toMatchObject({
      key: "planned-scene",
      description: "m description",
      props: [{ name: "cup", where: "in hand" }],
    });
    expect(materialOffer(input({ others: [other] }))?.scene?.key).toBe("scene");
  });
});

describe("the pictures a staging is offered", () => {
  it("are the scene's usable pictures, with the longest clip at this size, and planned ones", () => {
    const items = [
      SCENE,
      item("p1"),
      item("c-short", {
        kind: "clip",
        pictureId: "p1",
        seconds: 3,
        motion: "m",
        resolution: "1080p",
      }),
      item("c-long", {
        kind: "clip",
        pictureId: "p1",
        seconds: 5,
        motion: "m",
        resolution: "1080p",
      }),
      item("c-720", { kind: "clip", pictureId: "p1", seconds: 9, motion: "m", resolution: "720p" }),
      item("p-off", { reusable: false }),
      item("p-elsewhere", { sceneId: "other" }),
    ];
    const other = staged("third", "2026-11-01", [
      keyframe("m", "master", "scene"),
      keyframe("k", "character", "planned-ba"),
      keyframe("dup", "character", "p1"),
    ]);
    const newer = [staged("v5", "2026-11-05", []), staged("v4", "2026-11-04", [])];
    const offer = materialOffer(input({ items, others: [other, ...newer] }));
    expect(offer?.pictures.map((p) => [p.alias, p.key, p.clip?.seconds])).toEqual([
      ["k1", "p1", 5],
      ["k2", "planned-ba", undefined],
    ]);
    expect(offer?.pictures[1]).toMatchObject({ characterId: "b", people: ["b"] });
  });

  it("rest while the latest staging uses or made them; the master never rests", () => {
    const items = [SCENE, item("used"), item("made"), item("free")];
    const madeBy = (id: string) => ({
      ...item(id),
      source: { ...item(id).source, scriptId: "v2" },
    });
    const others = [
      staged("v3", "2026-11-24", [], [{ material: "used" }, { material: "scene" }]),
      staged("v2", "2026-11-23", []),
      staged("v1", "2026-11-22", [], [{ material: "free" }]),
    ];
    const offer = materialOffer(
      input({ items: [SCENE, items[1], madeBy("made"), items[3]] as MaterialItem[], others }),
    );
    expect(offer?.scene?.key).toBe("scene");
    expect(offer?.pictures.map((p) => p.key)).toEqual(["made", "free"]);
  });

  it("offer the master's own clip, unless the latest staging made it or replays it", () => {
    const masterClip = item("mc", {
      kind: "clip",
      pictureId: "scene",
      seconds: 4,
      motion: "the room breathes",
      resolution: "1080p",
    });
    const items = [SCENE, masterClip];
    expect(materialOffer(input({ items }))?.scene?.clip).toEqual({
      seconds: 4,
      motion: "the room breathes",
    });
    const replaying = staged("v9", "2026-11-24", [], [{ material: "scene" }], [{ reused: "mc" }]);
    const rested = materialOffer(input({ items, others: [replaying] }));
    expect(rested?.scene?.key).toBe("scene");
    expect(rested?.scene?.clip).toBeUndefined();
    const older = staged("v8", "2026-11-23", [], [], [{ reused: "mc" }]);
    const newest = staged("v10", "2026-11-25", []);
    expect(materialOffer(input({ items, others: [older, newest] }))?.scene?.clip).toBeDefined();
  });

  it("are at most sixteen: kept videos first, then the least used, then the newest", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      item(`p${i}`, {
        source: { ...SCENE.source, at: `2026-11-${String(i + 1).padStart(2, "0")}` },
      }),
    );
    const kept = item("kept", { kept: true, uses: [{ sessionId: "s", scriptId: "x", at: "" }] });
    const used = item("used", { uses: [{ sessionId: "s", scriptId: "x", at: "" }] });
    const offer = materialOffer(input({ items: [SCENE, used, ...many, kept] }));
    const keys = offer?.pictures.map((p) => p.key) ?? [];
    expect(keys).toHaveLength(MAX_OFFERED_PICTURES);
    expect(keys.slice(0, 3)).toEqual(["kept", "p19", "p18"]);
    expect(keys).not.toContain("used");
  });
});

const frame = (patch: Partial<JobFrame>): JobFrame => ({
  id: "kf:p",
  keyframe: "p",
  kind: "character",
  retried: false,
  ...patch,
});

const motionShot = (patch: Partial<JobShot> = {}): JobShot =>
  ({
    index: 0,
    route: "motion",
    keyframe: "p",
    kind: "wide",
    state: "planned",
    start: 0,
    end: 4,
    retried: false,
    failures: 0,
    ...patch,
  }) as JobShot;

const job = (frames: JobFrame[], shots: JobShot[], motion = "m"): VideoJob =>
  ({
    live: { plan: { routes: shots.map(() => ({ route: "motion", input: { prompt: motion } })) } },
    frames,
    shots,
  }) as unknown as VideoJob;

describe("what the store holds for a staged video right now", () => {
  const clip = (id: string, seconds: number, resolution = "720p") =>
    item(id, { kind: "clip", pictureId: "p1", seconds, motion: "m", resolution });
  const store = {
    items: [item("p1"), clip("c3", 3), clip("c5", 5), clip("c6", 6), clip("c9", 9, "1080p")],
    assets: ASSETS,
  };

  it("links a keyed picture to its usable file and a motion shot to the shortest clip long enough", () => {
    const next = withMaterialAvailability(job([frame({ material: "p1" })], [motionShot()]), store);
    expect(next.frames[0]?.materialFile).toBe("p1.png");
    expect(next.shots[0]?.materialClip).toEqual({ id: "c5", file: "c5.png", seconds: 5 });
    expect(withMaterialAvailability(next, store)).toBe(next);
  });

  it("replays a clip only for a shot planned with that clip's motion; the picture is reused either way", () => {
    const other = withMaterialAvailability(
      job([frame({ material: "p1" })], [motionShot()], "she pours the tea"),
      store,
    );
    expect(other.frames[0]?.materialFile).toBe("p1.png");
    expect(other.shots[0]).not.toHaveProperty("materialClip");
  });

  it("forgets what the store no longer holds, and never offers a clip for the video's own picture", () => {
    const linked = withMaterialAvailability(
      job([frame({ material: "p1" })], [motionShot()]),
      store,
    );
    const gone = withMaterialAvailability(linked, { items: [], assets: ASSETS });
    expect(gone.frames[0]).not.toHaveProperty("materialFile");
    expect(gone.shots[0]).not.toHaveProperty("materialClip");
    const own = job(
      [frame({ material: "p1", file: "own.png", source: "generated" })],
      [motionShot()],
    );
    expect(withMaterialAvailability(own, store)).toBe(own);
  });
});

describe("keys for a staged plan", () => {
  const list = {
    pictures: [
      {
        id: "master",
        kind: "master",
        framing: "w",
        description: "d",
        people: [],
        characterId: null,
      },
      {
        id: "k1",
        kind: "character",
        framing: "c",
        description: "d",
        people: [],
        characterId: "a",
        material: "old",
      },
      {
        id: "an",
        kind: "character",
        framing: "c",
        description: "same",
        people: [],
        characterId: "a",
      },
      { id: "plate", kind: "plate", framing: "p", description: "d", people: [], characterId: null },
    ],
  } as unknown as ShotList;

  it("gives every new picture but a plate its own key, and keeps a key a restaged picture had", () => {
    let n = 0;
    const basis = { pictures: [{ ...list.pictures[2], material: "carried" }] } as ShotList;
    const keyed = withMaterialKeys(list, () => `new-${++n}`, basis);
    expect(keyed.pictures.map((p) => p.material)).toEqual(["new-1", "old", "carried", undefined]);
  });
});
