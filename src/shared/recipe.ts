import { imageModel } from "./image-models";
import type { ModelSchema, Rate } from "./live-plan";
import type { JobModels } from "./models";
import { videoModel } from "./video-models";

export interface RoleModel {
  endpoint: string;
  name: string;
  input: Record<string, unknown>;
  rate: Rate;
  schema: ModelSchema;
  why?: string;
}

export interface Recipe {
  version: 1;
  id: string;
  source: "builtin";
  stills: RoleModel & { maxReferences: number };
  motion: RoleModel;
}

export const PROMPT_SLOT = "{{prompt}}";
export const REFERENCES_SLOT = "{{references}}";
const KEYFRAME_SLOT = "{{keyframe}}";

function paramsOf(
  input: Record<string, unknown>,
  required: readonly string[],
  limits: Record<string, { min: number; max: number }> = {},
): ModelSchema["params"] {
  return Object.entries(input).map(([name, value]) => ({
    name,
    type: Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value,
    required: required.includes(name),
    ...limits[name],
  }));
}

function stillsRole(models: JobModels): Recipe["stills"] {
  const model = imageModel(models.image);
  const input = model.input(PROMPT_SLOT, [REFERENCES_SLOT], "9:16");
  return {
    endpoint: model.endpoint,
    name: model.name,
    input,
    rate: { usd: model.fallbackUsd, unit: "images" },
    schema: {
      endpoint: model.endpoint,
      name: model.name,
      category: "image-to-image",
      params: paramsOf(input, ["prompt", "image_urls"]),
      outputs: ["images"],
    },
    why: "The series' picture model.",
    maxReferences: model.maxReferences,
  };
}

function motionRole(models: JobModels): RoleModel {
  const model = videoModel(models.video);
  const input = model.motion({
    prompt: PROMPT_SLOT,
    imageUrl: KEYFRAME_SLOT,
    seconds: model.minSec,
  });
  return {
    endpoint: model.motionEndpoint,
    name: model.name,
    input,
    rate: { usd: model.motionUsdPerSec, unit: "seconds", minSeconds: model.minSec },
    schema: {
      endpoint: model.motionEndpoint,
      name: model.name,
      category: "image-to-video",
      params: paramsOf(input, [], { duration: { min: model.minSec, max: model.maxSec } }),
      outputs: ["video"],
    },
    why: "The series' video model, for shots where nobody speaks.",
  };
}

export const builtinRecipe = (models: JobModels): Recipe => ({
  version: 1,
  id: `builtin-${models.image}-${models.video}`,
  source: "builtin",
  stills: stillsRole(models),
  motion: motionRole(models),
});
