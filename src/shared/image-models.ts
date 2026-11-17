import type { AngleModel } from "./ipc";

// The image-edit models the app asks for stills ("Tạo thêm góc nhìn",
// video start frames, place cleaning), by id: endpoint, the price used when
// the provider's billing history cannot be read, and the request. Pure, so
// the built-in recipe (src/shared/recipe.ts) uses the same request.

/** Portrait shapes: 2:3 for the character sheet, 9:16 for video start frames. */
export type ImageShape = "2:3" | "9:16";

export const MODELS: Record<
  AngleModel,
  {
    endpoint: string;
    /** Display name (never the middleman's). */
    name: string;
    fallbackUsd: number;
    input: (prompt: string, urls: string[], shape?: ImageShape) => Record<string, unknown>;
  }
> = {
  // The model used for the approved courtyard pack.
  "gpt-image": {
    endpoint: "openai/gpt-image-2.6/sunburst/edit",
    name: "GPT Image 2.6",
    fallbackUsd: 0.12,
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
    fallbackUsd: 0.15,
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

/** The angle dialog's default model; video start frames use it too. */
export const DEFAULT_IMAGE_MODEL: AngleModel = "gpt-image";
