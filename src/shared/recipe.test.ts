import { describe, expect, it } from "vitest";
import type { LiveDirection } from "./live-plan";
import { mediaLevel } from "./media-level";
import { builtinRecipe, readRecipe, recipeFromDirection } from "./recipe";

const level = mediaLevel("balanced");

const direction = (): LiveDirection =>
  ({
    plan: {
      shots: { source: "ai", seats: [], props: [], stateChanges: [], shots: [] },
      keyframes: [
        {
          id: "master",
          kind: "master",
          characterId: null,
          framing: "wide",
          references: ["place-1", "cast1-1"],
          endpoint: "img/edit",
          input: {
            prompt: "Image 1 is the place. A wide shot.",
            image_urls: ["{{place-1}}", "{{cast1-1}}"],
            aspect_ratio: "9:16",
            resolution: "2K",
          },
          why: "",
        },
      ],
      routes: [
        { route: "still-move", keyframe: "master", endpoint: null, input: null },
        {
          route: "lip-sync",
          keyframe: "master",
          endpoint: "lips/one",
          input: { image_url: "{{keyframe}}", audio_url: "{{audio}}", resolution: "768P" },
        },
        {
          route: "motion",
          keyframe: "master",
          endpoint: "move/one",
          input: { image_url: "{{keyframe}}", prompt: "Leaves sway.", duration: "10" },
        },
      ],
      models: [
        { endpoint: "img/edit", name: "Img", role: "keyframes", why: "sharp", decisionId: null },
        { endpoint: "lips/one", name: "Lips", role: "lip-sync", why: "cheap", decisionId: null },
      ],
      level: "detailed",
      guidanceNote: "",
    },
    costs: { rows: [], knownUsd: 0, unknownSteps: 0, seconds: 0 },
    warnings: [],
    rates: {
      "img/edit": { usd: 0.08, unit: "images" },
      "lips/one": { usd: 0.08, unit: "seconds", minSeconds: 5 },
      "move/one": { usd: 0.1, unit: "seconds" },
    },
    schemas: {
      "img/edit": { endpoint: "img/edit", name: "Img Edit", category: "", params: [], outputs: [] },
    },
    connection: "signed-in",
    tools: [],
    guidance: "complete",
    model: null,
    seconds: 200,
  }) as LiveDirection;

describe("builtinRecipe", () => {
  it("uses the default models, a motion model from Cân bằng up, no middleman in names and only schema fields", () => {
    const r = builtinRecipe(level);
    expect(r).toMatchObject({ version: 1, id: "builtin", source: "builtin", level: "balanced" });
    expect(r.stills.input).toMatchObject({ prompt: "{{prompt}}", image_urls: ["{{references}}"] });
    expect(r.speak.input).toMatchObject({
      image_url: "{{keyframe}}",
      audio_url: "{{audio}}",
      prompt: "{{prompt}}",
    });
    expect(r.motion?.input).toMatchObject({ start_image_url: "{{keyframe}}", audio: false });
    expect(builtinRecipe(mediaLevel("fast")).motion).toBeNull();
    expect(`${r.stills.name} ${r.speak.name} ${r.motion?.name}`).not.toMatch(/fal/i);
    for (const role of [r.stills, r.speak, r.motion as NonNullable<typeof r.motion>]) {
      const names = role.schema.params.map((p) => p.name);
      expect(Object.keys(role.input).every((k) => names.includes(k))).toBe(true);
    }
  });
});

describe("recipeFromDirection", () => {
  it("takes the master's model for stills and the first routes for speak and motion", () => {
    const r = recipeFromDirection(direction());
    expect(r).toMatchObject({ source: "plan", level: "balanced" });
    expect(r.stills).toMatchObject({
      endpoint: "img/edit",
      name: "Img Edit",
      why: "sharp",
      input: {
        prompt: "{{prompt}}",
        image_urls: ["{{references}}"],
        aspect_ratio: "9:16",
        resolution: "2K",
      },
      rate: { usd: 0.08, unit: "images" },
    });
    expect(r.speak).toMatchObject({
      endpoint: "lips/one",
      input: { image_url: "{{keyframe}}", audio_url: "{{audio}}", resolution: "768P" },
      rate: { minSeconds: 5 },
    });
    expect(r.motion?.input).toEqual({ image_url: "{{keyframe}}", prompt: "{{prompt}}" });
  });

  it("has no motion when the plan has none", () => {
    const d = direction();
    d.plan.routes = d.plan.routes.filter((x) => x.route !== "motion");
    expect(recipeFromDirection(d).motion).toBeNull();
  });
});

describe("readRecipe", () => {
  it("reads a saved recipe, a saved live plan, and nothing else", () => {
    const saved = JSON.parse(JSON.stringify(builtinRecipe(level)));
    expect(readRecipe(saved)).toEqual(builtinRecipe(level));
    expect(readRecipe(JSON.parse(JSON.stringify(direction())))?.source).toBe("plan");
    expect(readRecipe({ version: 1, stills: {} })).toBeNull();
    expect(readRecipe("x")).toBeNull();
    expect(readRecipe(null)).toBeNull();
  });
});
