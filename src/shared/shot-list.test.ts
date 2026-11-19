import { describe, expect, it } from "vitest";
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
