import { describe, expect, it } from "vitest";
import { readShotList } from "./shot-list";
import { answer, CTX } from "./shot-list.fixture";
import { applyCorrection } from "./shot-list-correction";

const NO_MOTION = { motion: false };

function merged(correction: unknown) {
  const result = applyCorrection(answer(), correction);
  if ("unusable" in result) throw new Error(result.unusable);
  return result.answer;
}

const unusable = (correction: unknown) => {
  const result = applyCorrection(answer(), correction);
  return "unusable" in result ? result.unusable : null;
};

const baPicture = {
  id: "ba-close",
  kind: "character",
  character: "Ba",
  people: ["Ba"],
  framing: "close-up",
  description: "Ba sits on the right, smiling.",
};

describe("applyCorrection", () => {
  it("adds a missing picture and leaves every other entry as it was", () => {
    const broken = answer();
    (broken.shots?.[2] as { picture: string }).picture = "ba-close";
    expect(readShotList(broken, CTX, NO_MOTION).errors.join(" ")).toMatch(/does not exist/);

    const result = applyCorrection(broken, { pictures: [baPicture] });
    if ("unusable" in result) throw new Error(result.unusable);
    expect(result.answer.pictures?.map((p) => p.id)).toEqual([
      "master",
      "an",
      "ba-ots",
      "plate",
      "ba-close",
    ]);
    expect(result.answer.shots).toEqual(broken.shots);
    expect(result.answer.seats).toEqual(broken.seats);
    expect(result.answer.props).toEqual(broken.props);
    expect(readShotList(result.answer, CTX, NO_MOTION).errors).toEqual([]);
  });

  it("replaces a picture and a shot by id and number, keeping their places", () => {
    const shot = { ...(answer().shots?.[2] as object), n: 3, visual: "Ba laughs." };
    const out = merged({
      pictures: [{ ...baPicture, id: "ba-ots", description: "Ba, from over An's shoulder." }],
      shots: [shot],
    });
    expect(out.pictures?.map((p) => p.id)).toEqual(["master", "an", "ba-ots", "plate"]);
    expect(out.pictures?.[2]?.description).toBe("Ba, from over An's shoulder.");
    expect(out.shots?.map((s) => s.visual)).toEqual([
      "An smiles.",
      "The courtyard.",
      "Ba laughs.",
      "On the bamboo mat beside the teapot.",
      "An grins.",
    ]);
  });

  it("adds and removes shots and pictures, renumbering shots and their state changes", () => {
    const base = answer();
    base.state_changes = [
      { from_shot: 2, change: "the pot is open" },
      { from_shot: 3, change: "the cup is full" },
      { from_shot: 4, change: "An has stood up" },
    ];
    const listener = {
      type: "listener",
      character: "An",
      framing: "close",
      line: 2,
      text: "uống chén trà đã cháu.",
      visual: "An listens.",
      picture: "an",
      route: "still-move",
      after: 0,
    };
    const result = applyCorrection(base, {
      add_shots: [{ ...listener, after: 3 }],
      remove_shots: [2],
      remove_pictures: ["plate"],
    });
    if ("unusable" in result) throw new Error(result.unusable);
    expect(result.answer.shots?.map((s) => [s.n, s.visual])).toEqual([
      [1, "An smiles."],
      [2, "Ba gestures to the cup."],
      [3, "An listens."],
      [4, "On the bamboo mat beside the teapot."],
      [5, "An grins."],
    ]);
    expect(result.answer.shots?.some((s) => "after" in s)).toBe(false);
    expect(result.answer.pictures?.map((p) => p.id)).toEqual(["master", "an", "ba-ots"]);
    expect(result.answer.state_changes).toEqual([
      { from_shot: 2, change: "the pot is open" },
      { from_shot: 2, change: "the cup is full" },
      { from_shot: 4, change: "An has stood up" },
    ]);
  });

  it("drops a state change whose shot and every later one were removed", () => {
    const base = answer();
    base.state_changes = [{ from_shot: 5, change: "An has stood up" }];
    const result = applyCorrection(base, { remove_shots: [5] });
    if ("unusable" in result) throw new Error(result.unusable);
    expect(result.answer.state_changes).toEqual([]);
  });

  it("replaces a whole-list field only when the correction writes it", () => {
    const props = [{ name: "kettle", where: "on the stove" }];
    expect(merged({ props }).props).toEqual(props);
    expect(merged({ props }).seats).toEqual(answer().seats);
  });

  it("puts a new master first", () => {
    const out = merged({ pictures: [{ ...baPicture, id: "wide", kind: "master" }] });
    expect(out.pictures?.[0]?.id).toBe("wide");
  });

  it("refuses a correction it cannot place", () => {
    expect(unusable("not an object")).toMatch(/not a JSON object/);
    expect(unusable({})).toMatch(/changes nothing/);
    expect(unusable({ plan: [] })).toMatch(/Unknown fields: plan/);
    expect(unusable({ remove_pictures: ["nope"] })).toMatch(/remove_pictures/);
    expect(unusable({ shots: [{ n: 9, type: "wide" }] })).toMatch(/"shots"/);
    expect(unusable({ shots: [{ type: "wide" }] })).toMatch(/"shots"/);
    expect(unusable({ add_shots: [{ after: 6, type: "wide" }] })).toMatch(/add_shots/);
    expect(unusable({ remove_shots: [0] })).toMatch(/remove_shots/);
    expect(unusable({ shots: [{ n: 2, type: "wide" }], remove_shots: [2] })).toMatch(
      /both written and removed/,
    );
    expect(unusable({ pictures: [baPicture, baPicture] })).toMatch(/written twice/);
  });
});
