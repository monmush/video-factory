import { NANO_BANANA_STILL_USD, STILL_USD } from "./cost/rates";
import type { AngleModel } from "./ipc";

export type ImageShape = "2:3" | "9:16";

export const MODELS: Record<
  AngleModel,
  {
    endpoint: string;
    name: string;
    fallbackUsd: number;
    maxReferences: number;
    input: (prompt: string, urls: string[], shape?: ImageShape) => Record<string, unknown>;
  }
> = {
  "gpt-image": {
    endpoint: "openai/gpt-image-2.6/sunburst/edit",
    name: "GPT Image 2.6",
    fallbackUsd: STILL_USD,
    maxReferences: 8,
    input: (prompt, image_urls, shape = "2:3") => ({
      prompt,
      image_urls,
      image_size: shape === "9:16" ? "portrait_16_9" : { width: 1024, height: 1536 },
      background: "opaque",
      quality: "high",
      reasoning_effort: "medium",
      num_images: 1,
      output_format: "png",
    }),
  },
  "nano-banana-pro": {
    endpoint: "fal-ai/nano-banana-pro/edit",
    name: "Nano Banana Pro",
    fallbackUsd: NANO_BANANA_STILL_USD,
    maxReferences: 8,
    input: (prompt, image_urls, shape = "2:3") => ({
      prompt,
      image_urls,
      aspect_ratio: shape,
      resolution: "1K",
      num_images: 1,
      output_format: "png",
    }),
  },
};

export const DEFAULT_IMAGE_MODEL: AngleModel = "gpt-image";

export const isImageModelId = (id: unknown): id is AngleModel =>
  typeof id === "string" && id in MODELS;

export const imageModel = (id?: string | null) =>
  MODELS[isImageModelId(id) ? id : DEFAULT_IMAGE_MODEL];
