import { describe, expect, it } from "vitest";
import { DEFAULT_IMAGE_MODEL, MODELS } from "../../shared/image-models";
import { mediaLevel, OFFERED_LEVELS } from "../../shared/media-level";
import { builtinRecipe } from "../../shared/recipe";
import { videoModel } from "../../shared/video-models";
import { SHOT_ENDPOINTS } from "./shot-models";

const recipe = builtinRecipe(mediaLevel("balanced"));

describe("the built-in recipe cannot drift from the fixed pipeline", () => {
  it("sends a still as the fixed pipeline does for a 9:16 start frame", () => {
    const model = MODELS[DEFAULT_IMAGE_MODEL];
    expect(recipe.stills.endpoint).toBe(model.endpoint);
    expect(recipe.stills.input).toEqual(model.input("{{prompt}}", ["{{references}}"], "9:16"));
  });

  it("sends a speaking shot as the fixed pipeline does, with each level's own model", () => {
    for (const level of OFFERED_LEVELS) {
      const speak = builtinRecipe(level).speak;
      const built = SHOT_ENDPOINTS[level.speaker].input({
        imageUrl: "{{keyframe}}",
        audioUrl: "{{audio}}",
        prompt: "{{prompt}}",
        resolution: "720p",
      });
      expect(speak.endpoint).toBe(videoModel(level.speaker).endpoint);
      expect(speak.input).toEqual(built);
      expect(speak.rate.minSeconds).toBe(videoModel(level.speaker).minSec);
      expect(speak.schema.minAudioSec).toBe(videoModel(level.speaker).minSec);
    }
  });
});
