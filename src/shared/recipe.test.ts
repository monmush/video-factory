import { describe, expect, it } from "vitest";
import { NANO_BANANA_STILL_USD, STILL_USD } from "./cost/rates";
import { MODEL_KINDS } from "./models";
import { builtinRecipe } from "./recipe";

describe("builtinRecipe", () => {
  it("takes the stills from the series' picture model and the moving shots from its video model", () => {
    const wan = builtinRecipe({ image: "gpt-image", video: "wan-3" });
    expect(wan.stills).toMatchObject({
      endpoint: "openai/gpt-image-2.6/sunburst/edit",
      input: { prompt: "{{prompt}}", image_urls: ["{{references}}"] },
      rate: { usd: STILL_USD, unit: "images" },
    });
    expect(wan.motion).toMatchObject({
      endpoint: "alibaba/wan-3.0/image-to-video",
      input: { start_image_url: "{{keyframe}}", prompt: "{{prompt}}", audio: false },
    });

    const h3 = builtinRecipe({ image: "nano-banana-pro", video: "minimax-h3-max" });
    expect(h3.stills).toMatchObject({
      endpoint: "fal-ai/nano-banana-pro/edit",
      input: { prompt: "{{prompt}}", image_urls: ["{{references}}"], aspect_ratio: "9:16" },
      rate: { usd: NANO_BANANA_STILL_USD },
    });
    expect(h3.motion).toMatchObject({
      endpoint: "minimax/h3-max/image-to-video",
      input: { image_url: "{{keyframe}}", prompt_expansion_mode: "disabled" },
    });
  });

  it("describes every field it fills, with each video model's own length limits", () => {
    for (const image of MODEL_KINDS[0]?.models ?? []) {
      for (const video of MODEL_KINDS[1]?.models ?? []) {
        const r = builtinRecipe({ image: image.id, video: video.id } as never);
        for (const role of [r.stills, r.motion]) {
          const names = role.schema.params.map((p) => p.name);
          expect(Object.keys(role.input).every((k) => names.includes(k))).toBe(true);
        }
        expect(r.stills.maxReferences).toBeGreaterThanOrEqual(5);
        expect(`${r.stills.name} ${r.motion.name}`).not.toMatch(/fal/i);
      }
    }
    const duration = (video: "wan-3" | "minimax-h3-max") =>
      builtinRecipe({ image: "gpt-image", video }).motion.schema.params.find(
        (p) => p.name === "duration",
      );
    expect(duration("wan-3")).toMatchObject({ min: 2, max: 30 });
    expect(duration("minimax-h3-max")).toMatchObject({ min: 1, max: 15 });
  });
});
