import { DEFAULT_IMAGE_MODEL, MODELS } from "./image-models";
import {
  DURATION_FIELDS,
  type LiveDirection,
  type ModelSchema,
  modelName,
  placeholderOf,
  placeholdersIn,
  type Rate,
} from "./live-plan";
import { levelRates, type MediaLevel, type MediaLevelId, mediaLevel } from "./media-level";
import { DEFAULT_VIDEO_MODEL, videoModel } from "./video-models";

export interface RoleModel {
  endpoint: string;
  name: string;
  input: Record<string, unknown>;
  rate: Rate;
  schema: ModelSchema;
  why?: string;
}

export type RecipeSource = "builtin" | "plan" | "session";

export interface Recipe {
  version: 1;
  id: string;
  source: RecipeSource;
  level: MediaLevelId;
  madeAt: string | null;
  stills: RoleModel & { maxReferences?: number };
  speak: RoleModel;
  motion: RoleModel | null;
}

export const DEFAULT_MAX_REFERENCES = 8;

export const PROMPT_SLOT = "{{prompt}}";
export const REFERENCES_SLOT = "{{references}}";

const param = (
  name: string,
  type: string,
  required: boolean,
  values?: (string | number)[],
): ModelSchema["params"][number] => ({
  name,
  type,
  required,
  ...(values ? { enum: values } : {}),
});

function builtinStills(rate: Rate): Recipe["stills"] {
  const model = MODELS[DEFAULT_IMAGE_MODEL];
  return {
    endpoint: model.endpoint,
    name: model.name,
    input: model.input(PROMPT_SLOT, [REFERENCES_SLOT], "9:16"),
    rate,
    schema: {
      endpoint: model.endpoint,
      name: model.name,
      category: "image-to-image",
      params: [
        param("prompt", "string", true),
        param("image_urls", "array<string>", true),
        param("image_size", "string", false, ["portrait_16_9"]),
        param("background", "string", false, ["auto", "transparent", "opaque"]),
        param("quality", "string", false, ["low", "medium", "high"]),
        param("reasoning_effort", "string", false),
        param("num_images", "integer", false),
        param("output_format", "string", false, ["png", "jpeg", "webp"]),
      ],
      outputs: ["images"],
    },
    why: "The app's default image model.",
    maxReferences: DEFAULT_MAX_REFERENCES,
  };
}

function builtinSpeak(rate: Rate): RoleModel {
  const model = videoModel(DEFAULT_VIDEO_MODEL);
  return {
    endpoint: model.endpoint,
    name: model.name,
    input: {
      image_url: "{{keyframe}}",
      audio_url: "{{audio}}",
      prompt: PROMPT_SLOT,
      enable_safety_checker: true,
    },
    rate,
    schema: {
      endpoint: model.endpoint,
      name: model.name,
      category: "image-to-video",
      params: [
        param("image_url", "string", true),
        param("audio_url", "string", true),
        param("prompt", "string", false),
        param("enable_safety_checker", "boolean", false),
      ],
      outputs: ["video"],
      ...(model.minSec ? { minAudioSec: model.minSec } : {}),
    },
    why: "The app's default speaking-shot model.",
  };
}

const MOTION_ENDPOINT = "alibaba/wan-3.0-prime/image-to-video";

function builtinMotion(rate: Rate): RoleModel {
  return {
    endpoint: MOTION_ENDPOINT,
    name: "Wan 3.0 Prime",
    input: {
      start_image_url: "{{keyframe}}",
      prompt: PROMPT_SLOT,
      resolution: "1080p",
      aspect_ratio: "9:16",
      duration: 3,
      audio: false,
    },
    rate,
    schema: {
      endpoint: MOTION_ENDPOINT,
      name: "Wan 3.0 Prime",
      category: "image-to-video",
      params: [
        param("start_image_url", "string", true),
        param("prompt", "string", false),
        param("resolution", "string", false, ["480p", "720p", "1080p"]),
        param("aspect_ratio", "string", false, ["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16"]),
        { ...param("duration", "integer", false), min: 2, max: 30 },
        param("audio", "boolean", false),
      ],
      outputs: ["video"],
    },
    why: "Real movement for wide and detail shots.",
  };
}

export function builtinRecipe(level: MediaLevel): Recipe {
  const rates = levelRates(level);
  return {
    version: 1,
    id: "builtin",
    source: "builtin",
    level: level.id,
    madeAt: null,
    stills: builtinStills(rates.stills),
    speak: builtinSpeak(rates.speak),
    motion: rates.motion ? builtinMotion(rates.motion) : null,
  };
}

type Input = Record<string, unknown>;

function promptField(input: Input): string | null {
  const text = (k: string) => typeof input[k] === "string" && !placeholderOf(input[k]);
  if (text("prompt")) return "prompt";
  return Object.keys(input).find((k) => /prompt|text/i.test(k) && text(k)) ?? null;
}

function role(live: LiveDirection, endpoint: string, input: Input, why?: string): RoleModel {
  const schema = live.schemas[endpoint] ?? {
    endpoint,
    name: modelName(live.schemas, endpoint),
    category: "",
    params: [],
    outputs: [],
  };
  return {
    endpoint,
    name: modelName(live.schemas, endpoint),
    input,
    rate: live.rates[endpoint] ?? { usd: null, unit: "" },
    schema,
    ...(why ? { why } : {}),
  };
}

const whyOf = (live: LiveDirection, endpoint: string) =>
  live.plan.models.find((m) => m.endpoint === endpoint)?.why || undefined;

export function recipeFromDirection(live: LiveDirection): Recipe {
  const plan = live.plan;
  const master = plan.keyframes.find((k) => k.kind === "master") ?? plan.keyframes[0];
  if (!master) throw new Error("The plan has no keyframes to take a still model from.");
  const stillInput: Input = {};
  const text = promptField(master.input);
  for (const [k, v] of Object.entries(master.input)) {
    if (k === text) stillInput[k] = PROMPT_SLOT;
    else if (Array.isArray(v) && v.length && placeholdersIn(v).length === v.length) {
      stillInput[k] = [REFERENCES_SLOT];
    } else stillInput[k] = v;
  }
  const lips = plan.routes.find((r) => r.route === "lip-sync" && r.endpoint && r.input);
  if (!lips?.endpoint || !lips.input)
    throw new Error("The plan has no speaking shot to take a model from.");
  const motion = plan.routes.find((r) => r.route === "motion" && r.endpoint && r.input);
  const slotted = (input: Input) => {
    const field = promptField(input);
    const rest = Object.fromEntries(
      Object.entries(input).filter(([k]) => !DURATION_FIELDS.includes(k)),
    );
    return field ? { ...rest, [field]: PROMPT_SLOT } : rest;
  };
  return {
    version: 1,
    id: `plan-${plan.level}`,
    source: "plan",
    level: mediaLevel(plan.level).id,
    madeAt: null,
    stills: {
      ...role(live, master.endpoint, stillInput, whyOf(live, master.endpoint)),
      maxReferences: DEFAULT_MAX_REFERENCES,
    },
    speak: role(live, lips.endpoint, slotted(lips.input), whyOf(live, lips.endpoint)),
    motion:
      motion?.endpoint && motion.input
        ? role(live, motion.endpoint, slotted(motion.input), whyOf(live, motion.endpoint))
        : null,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);

const isRole = (v: unknown): v is RoleModel =>
  isObj(v) &&
  typeof v.endpoint === "string" &&
  Boolean(v.endpoint) &&
  typeof v.name === "string" &&
  isObj(v.input) &&
  isObj(v.rate) &&
  isObj(v.schema) &&
  Array.isArray(v.schema.params);

export function readRecipe(json: unknown): Recipe | null {
  if (!isObj(json)) return null;
  if (isObj(json.plan) && isObj(json.rates)) {
    try {
      return recipeFromDirection(json as unknown as LiveDirection);
    } catch {
      return null;
    }
  }
  if (json.version !== 1 || !isRole(json.stills) || !isRole(json.speak)) return null;
  if (json.motion !== null && json.motion !== undefined && !isRole(json.motion)) return null;
  const source: RecipeSource =
    json.source === "plan" || json.source === "session" ? json.source : "builtin";
  return {
    ...(json as unknown as Recipe),
    id: typeof json.id === "string" && json.id ? json.id : "saved",
    source,
    level: mediaLevel(typeof json.level === "string" ? json.level : null).id,
    madeAt: typeof json.madeAt === "string" ? json.madeAt : null,
    motion: (json.motion as RoleModel | null | undefined) ?? null,
  };
}
