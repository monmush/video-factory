import { describe, expect, it } from "vitest";
import type { MaterialOffer } from "../../shared/material-offer";
import { mediaLevel } from "../../shared/media-level";
import { shotListPrompt } from "./shot-list-prompt";

const BASE = "Direct this script.\n## Output\nold output";
const VIDEO = { level: mediaLevel("balanced"), motion: true, sound: false, direction: "none" };
const NAMES = new Map([
  ["a", "An"],
  ["b", "Ba"],
]);

const OFFER: MaterialOffer = {
  scene: {
    key: "scene-1",
    framing: "Wide shot at eye level",
    description: "An and Ba sit at the stone table.",
    people: ["a", "b"],
    seats: [
      { characterId: "a", side: "left", looks: "frame_right", behind: "a stone wall" },
      { characterId: "b", side: "right", looks: "frame_left", behind: "a red door" },
    ],
    props: [{ name: "teapot", where: "on the table" }],
  },
  pictures: [
    {
      alias: "k1",
      key: "x",
      kind: "action",
      characterId: null,
      people: [],
      framing: "close",
      description: "Steam | rises.",
      clip: { seconds: 3.04, motion: "Steam curls up." },
    },
  ],
};

describe("the staging prompt and the series' material", () => {
  it("leaves no trace of the material slot when there is nothing to offer", () => {
    const prompt = shotListPrompt(BASE, VIDEO);
    expect(prompt).not.toMatch(/\{\{|What this series already has/);
    expect(prompt).not.toMatch(/\n\n\n/);
    expect(prompt).toMatch(/reference photos\.\n\n### Routes/);
    expect(prompt).toMatch(/contains music or voices\.\n$/);
    const off = shotListPrompt(BASE, {
      ...VIDEO,
      reuse: false,
      material: { offer: OFFER, names: NAMES },
    });
    expect(off).toBe(prompt);
  });

  it("asks the video that creates the scene for a neutral master, and a scene replaces that ask", () => {
    const creates = shotListPrompt(BASE, {
      ...VIDEO,
      reuse: true,
      material: { offer: null, names: NAMES },
    });
    const section = creates.indexOf("### This video sets the series' scene");
    expect(section).toBeGreaterThan(creates.indexOf("### Pictures"));
    expect(section).toBeLessThan(creates.indexOf("### Routes"));
    expect(creates).toMatch(/hands empty/);
    expect(creates).not.toMatch(/\n\n\n/);
    expect(creates).toMatch(/contains music or voices\.\n$/);
    const given = shotListPrompt(BASE, {
      ...VIDEO,
      reuse: true,
      material: { offer: OFFER, names: NAMES },
    });
    expect(given).not.toMatch(/sets the series' scene/);
    expect(given).toMatch(/### What this series already has/);
  });

  it("offers the master's own clip", () => {
    const withClip: MaterialOffer = {
      ...OFFER,
      scene: {
        ...(OFFER.scene as NonNullable<MaterialOffer["scene"]>),
        clip: { seconds: 4.26, motion: "m" },
      },
    };
    const prompt = shotListPrompt(BASE, {
      ...VIDEO,
      reuse: true,
      material: { offer: withClip, names: NAMES },
    });
    expect(prompt).toContain(
      "list a new picture for it.\n\nThe master already has its moving clip of 4.2 s: a `motion` shot of at most 4.2 seconds that starts from `master` replays it. Write that shot's `motion` as null.",
    );
  });

  it("places the offer between the picture rules and the routes, and checks it at the end", () => {
    const prompt = shotListPrompt(BASE, {
      ...VIDEO,
      reuse: true,
      material: { offer: OFFER, names: NAMES },
    });
    const section = prompt.indexOf("### What this series already has");
    expect(section).toBeGreaterThan(prompt.indexOf("### Pictures"));
    expect(section).toBeLessThan(prompt.indexOf("### Routes"));
    expect(prompt).toMatch(/"character": "An",\n\s+"behind": "a stone wall",\n\s+"ambient": null/);
    expect(prompt).toContain("| k1 | action, moving, 3 s | – | close | Steam / rises. |");
    expect(prompt).not.toMatch(/\n\n\n/);
    expect(prompt).toMatch(
      /voices; every existing picture a shot names is in the table above; the first shot starts from a new picture\.\n$/,
    );
  });
});
