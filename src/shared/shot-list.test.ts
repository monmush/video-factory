import { describe, expect, it } from "vitest";
import type { MaterialOffer, OfferedPicture, OfferedScene } from "./material-offer";
import { readShotList, rulesShotList, type ShotListAnswer, shotListErrors } from "./shot-list";
import { answer, CTX } from "./shot-list.fixture";
import { rulesPlan } from "./shot-plan";

const NO_MOTION = { motion: false };

function changed(edit: (a: ShotListAnswer) => void): ShotListAnswer {
  const a = answer();
  edit(a);
  return a;
}

const errorsOf = (a: ShotListAnswer, caps = NO_MOTION) => readShotList(a, CTX, caps).errors;

describe("readShotList", () => {
  it("accepts a list that keeps every rule, with speak read as lip-sync", () => {
    const { list, errors } = readShotList(answer(), CTX, NO_MOTION);
    expect(errors).toEqual([]);
    expect(list.routes.map((r) => r.route)).toEqual([
      "lip-sync",
      "still-move",
      "lip-sync",
      "product",
      "lip-sync",
    ]);
    expect(list.pictures.map((p) => p.people)).toEqual([["a", "b"], ["a"], ["b", "a"], []]);
    expect(list.pictures[2]?.characterId).toBe("b");
    expect(list.routes[0]?.motion).toBe("nods slightly");
  });

  it("checks pictures: ids, kinds, names, the master first", () => {
    expect(
      errorsOf(
        changed((a) => {
          const p = a.pictures as NonNullable<ShotListAnswer["pictures"]>;
          (p[1] as { id: string }).id = "master";
        }),
      ).join(" "),
    ).toMatch(/ids must be unique/);
    expect(
      errorsOf(changed((a) => ((a.pictures?.[3] as { kind: string }).kind = "poster"))).join(" "),
    ).toMatch(/kind must be one of/);
    expect(
      errorsOf(
        changed((a) => ((a.pictures?.[2] as { people: string[] }).people = ["Ba", "Cô"])),
      ).join(" "),
    ).toMatch(/"Cô" is not in the cast/);
    expect(errorsOf(changed((a) => a.pictures?.reverse())).join(" ")).toMatch(
      /first picture is the master/,
    );
  });

  it("checks routes against shots and pictures", () => {
    const shot = (a: ShotListAnswer, i: number) =>
      (a.shots as NonNullable<ShotListAnswer["shots"]>)[i] as Record<string, unknown>;
    expect(errorsOf(changed((a) => (shot(a, 0).picture = "nope"))).join(" ")).toMatch(
      /picture "nope" does not exist/,
    );
    expect(errorsOf(changed((a) => (shot(a, 0).route = "still-move"))).join(" ")).toMatch(
      /speaker shot uses the speak route/,
    );
    expect(errorsOf(changed((a) => (shot(a, 0).picture = "ba-ots"))).join(" ")).toMatch(
      /character picture of the person on screen/,
    );
    expect(errorsOf(changed((a) => (shot(a, 1).route = "speak"))).join(" ")).toMatch(
      /only speaker and listener shots use the speak route/,
    );
    expect(errorsOf(changed((a) => (shot(a, 3).route = "still-move"))).join(" ")).toMatch(
      /product shot uses the product route/,
    );
    expect(errorsOf(changed((a) => (shot(a, 1).route = "product"))).join(" ")).toMatch(
      /only for a product detail shot/,
    );
    const noPlate = changed((a) => {
      shot(a, 3).picture = null;
      a.pictures = a.pictures?.filter((p) => p.kind !== "plate");
    });
    expect(errorsOf(noPlate)).toEqual([]);
    expect(errorsOf(changed((a) => (shot(a, 3).picture = null))).join(" ")).toMatch(
      /no shot starts from it/,
    );
  });

  it("drops a picture no shot starts from only when every shot has its picture", () => {
    const leftover = {
      id: "spare",
      kind: "character",
      character: "Ba",
      people: ["Ba"],
      framing: "close",
      description: "Ba smiles.",
    };
    const extra = readShotList(
      changed((a) => a.pictures?.splice(2, 0, leftover)),
      CTX,
      NO_MOTION,
    );
    expect(extra.errors).toEqual([]);
    expect(extra.list.pictures.map((p) => p.id)).toEqual(["master", "an", "ba-ots", "plate"]);
    expect(extra.repaired).toEqual(['Picture "spare": no shot starts from it; removed.']);

    const dangling = readShotList(
      changed((a) => {
        a.pictures?.push(leftover);
        ((a.shots as Record<string, unknown>[])[2] as Record<string, unknown>).picture = "spar";
      }),
      CTX,
      NO_MOTION,
    );
    expect(dangling.repaired).toEqual([]);
    expect(dangling.errors.join(" ")).toMatch(/"spare": no shot starts from it/);
  });

  it("refuses motion when the recipe has none, and needs its text when it has", () => {
    const motion = changed((a) => {
      const s = (a.shots as Record<string, unknown>[])[1] as Record<string, unknown>;
      s.route = "motion";
    });
    expect(errorsOf(motion).join(" ")).toMatch(/motion route is not available/);
    expect(errorsOf(motion, { motion: true }).join(" ")).toMatch(/says what moves/);
    const withText = changed((a) => {
      const s = (a.shots as Record<string, unknown>[])[1] as Record<string, unknown>;
      s.route = "motion";
      s.motion = "Leaves sway; the camera pushes in slowly.";
    });
    expect(errorsOf(withText, { motion: true })).toEqual([]);
  });

  it("never lets a product or its packaging into a picture or motion text", () => {
    expect(
      errorsOf(
        changed(
          (a) =>
            ((a.pictures?.[0] as { description: string }).description =
              "A pouch of Shan Tuyết tea on the table."),
        ),
      ).join(" "),
    ).toMatch(/products are never drawn/);
    expect(
      errorsOf(
        changed((a) => ((a.pictures?.[3] as { framing: string }).framing = "close on the label")),
      ).join(" "),
    ).toMatch(/products are never drawn/);
    expect(
      errorsOf(
        changed(
          (a) =>
            ((a.pictures?.[0] as { description: string }).description =
              "An and Ba at the table. No packaging anywhere."),
        ),
      ),
    ).toEqual([]);
    expect(
      errorsOf(
        changed(
          (a) =>
            (((a.shots as Record<string, unknown>[])[0] as Record<string, unknown>).motion =
              "holds up the Bạch Trà pouch"),
        ),
      ).join(" "),
    ).toMatch(/never name/);
  });
});

describe("rulesShotList", () => {
  it("gives the rules plan a master and one picture per person", () => {
    const list = rulesShotList(CTX);
    expect(list.pictures.map((p) => [p.kind, p.characterId])).toEqual([
      ["master", null],
      ["character", "a"],
      ["character", "b"],
    ]);
    expect(list.routes.every((r) => r.route === "lip-sync")).toBe(true);
    expect(list.pictures[1]?.description).toMatch(
      /An is seated on the left of the scene, turned toward the right edge/,
    );
    expect(shotListErrors(list, CTX, NO_MOTION)).toEqual([]);
  });

  it("derives pictures for a plan with wide, listener, detail and product shots", () => {
    const { list: read } = readShotList(answer(), CTX, NO_MOTION);
    const plan = {
      ...read.shots,
      shots: read.shots.shots.map((s, i) =>
        i === 2 ? { ...s, kind: "listener" as const, characterId: "a" } : s,
      ),
    };
    const list = rulesShotList(CTX, plan);
    expect(list.routes.map((r) => [r.route, r.picture])).toEqual([
      ["lip-sync", "char-1"],
      ["still-move", "master"],
      ["still-move", "char-1"],
      ["product", "plate-4"],
      ["lip-sync", "char-1"],
    ]);
    const plate = list.pictures.find((p) => p.id === "plate-4");
    expect(plate?.kind).toBe("plate");
    expect(plate?.description).not.toMatch(/Bạch|pouch/);
    expect(shotListErrors(list, CTX, NO_MOTION)).toEqual([]);
  });

  it("sends a product shot without a place down the product route with no picture", () => {
    const noPlace = { ...CTX, hasPlace: false };
    const { list: read } = readShotList(answer(), CTX, NO_MOTION);
    const plan = {
      ...read.shots,
      shots: read.shots.shots.map((s, i) =>
        i === 1 ? { ...s, kind: "listener" as const, characterId: "b" } : s,
      ),
    };
    const list = rulesShotList(noPlace, plan);
    expect(list.routes[3]).toEqual({ route: "product", picture: null, motion: "" });
    expect(list.pictures.some((p) => p.kind === "master")).toBe(false);
    expect(shotListErrors(list, noPlace, NO_MOTION)).toEqual([]);
  });

  it("keeps the problems of a refused plan", () => {
    expect(rulesShotList(CTX, rulesPlan(CTX, ["x"])).shots.problems).toEqual(["x"]);
  });
});

const SCENE: OfferedScene = {
  key: "scene-1",
  framing: "Wide shot at eye level, the whole courtyard",
  description: "An and Ba sit at the stone table under the ivy.",
  people: ["a", "b"],
  seats: [
    {
      characterId: "a",
      side: "left",
      looks: "frame_right",
      behind: "a stone wall with ivy",
      ambient: "ivy stirs",
    },
    { characterId: "b", side: "right", looks: "frame_left", behind: "a red wooden door" },
  ],
  props: [
    { name: "Teapot", where: "on the stone table" },
    { name: "bamboo tray", where: "under the cups" },
  ],
};

const OFFERED: OfferedPicture[] = [
  {
    alias: "k1",
    key: "key-an",
    kind: "character",
    characterId: "a",
    people: ["a"],
    framing: "medium close-up",
    description: "An sits on the left, looking right.",
  },
  {
    alias: "k2",
    key: "key-steam",
    kind: "action",
    characterId: null,
    people: [],
    framing: "close, from slightly above",
    description: "Steam rises from a cup on the stone table.",
    clip: { seconds: 3, motion: "Steam curls up; the camera holds." },
  },
  {
    alias: "k3",
    key: "key-ba",
    kind: "character",
    characterId: "b",
    people: ["b"],
    framing: "medium close-up",
    description: "Ba sits on the right, looking left.",
  },
];

const OFFER: MaterialOffer = { scene: SCENE, pictures: OFFERED };
const MOTION = { motion: true };

const startingFrom = (
  pictures: Record<number, string>,
  extra: (a: ShotListAnswer) => void = () => {},
) =>
  changed((a) => {
    const shots = a.shots as Record<string, unknown>[];
    for (const [i, id] of Object.entries(pictures))
      (shots[Number(i)] as Record<string, unknown>).picture = id;
    extra(a);
  });

describe("readShotList with the series' material", () => {
  it("adds an existing picture a shot names, with the key of the item it stands for", () => {
    const read = readShotList(startingFrom({ 2: "k3" }), CTX, NO_MOTION, OFFER);
    expect(read.errors).toEqual([]);
    expect(read.list.pictures.find((p) => p.id === "k3")).toEqual({
      id: "k3",
      kind: "character",
      characterId: "b",
      people: ["b"],
      framing: "medium close-up",
      description: "Ba sits on the right, looking left.",
      material: "key-ba",
    });
    expect(read.list.pictures.filter((p) => p.id === "k3")).toHaveLength(1);
    const unknown = readShotList(startingFrom({ 2: "k9" }), CTX, NO_MOTION, OFFER);
    expect(unknown.errors.join(" ")).toMatch(/picture "k9" does not exist/);
  });

  it("opens on a new picture: an opening shot from an existing one gets a copy without its key", () => {
    const read = readShotList(startingFrom({ 0: "k1" }), CTX, NO_MOTION, OFFER);
    expect(read.errors).toEqual([]);
    expect(read.list.routes[0]?.picture).toBe("k1-new");
    const copy = read.list.pictures.find((p) => p.id === "k1-new");
    expect(copy).toMatchObject({ kind: "character", characterId: "a", framing: "medium close-up" });
    expect(copy?.material).toBeUndefined();
    expect(read.list.pictures.some((p) => p.id === "k1")).toBe(false);
    expect(read.repaired[0]).toMatch(/^Shot 1: the first shot starts from a new picture/);
  });

  it("keeps at most half the shots on existing pictures, those with a moving clip first", () => {
    const read = readShotList(
      startingFrom({ 1: "k2", 2: "k3", 4: "k1" }, (a) => {
        const wide = (a.shots as Record<string, unknown>[])[1] as Record<string, unknown>;
        wide.route = "motion";
        wide.motion = null;
      }),
      CTX,
      MOTION,
      OFFER,
    );
    expect(read.errors).toEqual([]);
    expect(read.list.routes.map((r) => r.picture)).toEqual(["an", "k2", "k3", "plate", "k1-new"]);
    expect(read.list.routes[1]?.motion).toBe("Steam curls up; the camera holds.");
    expect(read.list.pictures.find((p) => p.id === "k2")?.material).toBe("key-steam");
    expect(read.repaired.join(" ")).toMatch(/Shot 5: at most half/);
  });

  it("stages inside the scene: its master, seats and props, plus a prop the script adds", () => {
    const read = readShotList(
      changed((a) => a.props?.push({ name: "fan", where: "in Ba's hand" })),
      CTX,
      NO_MOTION,
      { scene: SCENE, pictures: [] },
    );
    expect(read.errors).toEqual([]);
    expect(read.list.pictures[0]).toEqual({
      id: "master",
      kind: "master",
      characterId: null,
      people: ["a", "b"],
      framing: SCENE.framing,
      description: SCENE.description,
      material: "scene-1",
    });
    expect(read.list.shots.seats.map((s) => [s.behind, s.ambient])).toEqual([
      ["a stone wall with ivy", "ivy stirs"],
      ["a red wooden door", undefined],
    ]);
    expect(read.list.shots.props.map((p) => p.name)).toEqual(["Teapot", "bamboo tray", "fan"]);
  });

  it("a wide shot from the master with no motion replays the master's own clip", () => {
    const stillWide = changed((a) => {
      const wide = (a.shots as Record<string, unknown>[])[1] as Record<string, unknown>;
      wide.route = "motion";
      wide.motion = null;
    });
    const clip = { seconds: 4, motion: "Ivy stirs; the camera drifts in." };
    const read = readShotList(stillWide, CTX, MOTION, { scene: { ...SCENE, clip }, pictures: [] });
    expect(read.errors).toEqual([]);
    expect(read.list.routes[1]).toMatchObject({ picture: "master", motion: clip.motion });
    const noClip = readShotList(stillWide, CTX, MOTION, { scene: SCENE, pictures: [] });
    expect(noClip.errors.join(" ")).toMatch(/says what moves/);
  });

  it("without an offer reads the director's own scene and keys nothing", () => {
    const read = readShotList(answer(), CTX, NO_MOTION);
    expect(read.list.pictures.some((p) => "material" in p)).toBe(false);
    expect(read.list.shots.props).toEqual([{ name: "teapot", where: "centre of the table" }]);
    expect(read.repaired).toEqual([]);
  });

  it("the rules-only list uses the scene's master, seats and props", () => {
    const list = rulesShotList(CTX, rulesPlan(CTX), SCENE);
    expect(list.pictures[0]).toMatchObject({ kind: "master", material: "scene-1" });
    expect(list.pictures[0]?.description).toBe(SCENE.description);
    expect(list.pictures[1]?.description).toMatch(/Behind An: a stone wall with ivy\./);
    expect(list.shots.props.map((p) => p.name)).toEqual(["Teapot", "bamboo tray"]);
    expect(shotListErrors(list, CTX, NO_MOTION)).toEqual([]);
  });
});
