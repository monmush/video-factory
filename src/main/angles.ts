import { randomUUID } from "node:crypto";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AngleModel, CoreAngle, GenerateAnglesResult, GeneratedAngle } from "../shared/ipc";
import { mediaUrl } from "../shared/ipc";
import { uploadImages } from "./fal-upload";
import { stagingDir } from "./media";
import { falClient, getKey, providerMode } from "./providers";
import { logUsage } from "./usage";

// "Tạo thêm góc nhìn": generates the generic core character sheet (close-up,
// three-quarter, full body) from the character's reference images with a fal
// image-edit model. Results are staged; the user keeps or discards each one.

const MAX_REFERENCES = 4;

const MODELS: Record<
  AngleModel,
  { endpoint: string; fallbackUsd: number; input: (prompt: string, urls: string[]) => object }
> = {
  // The model used for the approved courtyard pack.
  "gpt-image": {
    endpoint: "openai/gpt-image-2.6/sunburst/edit",
    fallbackUsd: 0.12,
    input: (prompt, image_urls) => ({
      prompt,
      image_urls,
      image_size: { width: 1024, height: 1536 },
      background: "opaque",
      quality: "high",
      reasoning_effort: "medium",
      num_images: 1,
      output_format: "png",
    }),
  },
  "nano-banana-pro": {
    endpoint: "fal-ai/nano-banana-pro/edit",
    fallbackUsd: 0.15,
    input: (prompt, image_urls) => ({
      prompt,
      image_urls,
      aspect_ratio: "2:3",
      resolution: "1K",
      num_images: 1,
      output_format: "png",
    }),
  },
};

const VIEWS: Record<CoreAngle, string> = {
  closeup:
    "Head-and-shoulders portrait, facing the camera directly, eyes to camera, relaxed neutral expression. The face fills most of the frame.",
  "three-quarter":
    "Three-quarter view: face and body turned about 45 degrees toward the right side of the frame, framed from the waist up.",
  "full-body":
    "Full body standing, entire figure visible from head to feet, facing the camera, arms relaxed.",
};

function prompt(angle: CoreAngle, description: string) {
  return [
    "The reference photos show one character. Create a new photorealistic photo of exactly the same person:",
    "identical face, age, skin, hair, facial hair, body proportions, and the identical outfit, colours and accessories.",
    VIEWS[angle],
    "Plain light grey studio background, soft even lighting, no props, no other people, no text overlays.",
    "Keep any logo or lettering on the clothing exactly as it appears in the references; if it is not clearly readable there, keep that area plain rather than inventing new text.",
    description.trim() ? `Character notes (Vietnamese): ${description.trim()}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Average cost per image from fal's own billing history (free to query). */
export async function estimateAngles(model: AngleModel, count: number): Promise<{ cost: number }> {
  const { endpoint, fallbackUsd } = MODELS[model];
  const key = await getKey("fal");
  if (!key || count <= 0) return { cost: fallbackUsd * Math.max(count, 0) };
  try {
    const res = await fetch("https://api.fal.ai/v1/models/pricing/estimate", {
      method: "POST",
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        estimate_type: "historical_api_price",
        endpoints: { [endpoint]: { call_quantity: count } },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json()) as { total_cost?: number };
    return { cost: typeof data.total_cost === "number" ? data.total_cost : fallbackUsd * count };
  } catch {
    return { cost: fallbackUsd * count };
  }
}

async function stageFromUrl(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Không tải được ảnh (${res.status})`);
  const file = `${randomUUID()}.png`;
  await writeFile(join(stagingDir(), file), Buffer.from(await res.arrayBuffer()));
  return file;
}

export async function generateAngles(input: {
  model: AngleModel;
  angles: CoreAngle[];
  description: string;
  referencePaths: string[];
}): Promise<GenerateAnglesResult> {
  if (input.referencePaths.length === 0) throw new Error("Cần ít nhất một ảnh tham chiếu");
  if (input.angles.length === 0) return { images: [], failed: [], source: "fal", cost: null };
  await mkdir(stagingDir(), { recursive: true });

  // Fixture mode: copies of the first reference stand in for results, so the
  // flow can be tested without spending credits.
  if (providerMode() === "fixture") {
    await new Promise((r) => setTimeout(r, 1500));
    const images: GeneratedAngle[] = [];
    for (const angle of input.angles) {
      const file = `${randomUUID()}.png`;
      await copyFile(input.referencePaths[0] as string, join(stagingDir(), file));
      images.push({ id: file, url: mediaUrl.staged(file), angle });
    }
    return { images, failed: [], source: "fixture", cost: null };
  }

  const config = MODELS[input.model];
  const fal = await falClient();
  const urls = await uploadImages(fal, input.referencePaths.slice(0, MAX_REFERENCES));
  const { cost: unitCost } = await estimateAngles(input.model, 1);

  const settled = await Promise.allSettled(
    input.angles.map(async (angle) => {
      const result = await fal.subscribe(config.endpoint, {
        input: config.input(prompt(angle, input.description), urls),
      });
      const imageUrl = (result.data as { images?: { url: string }[] }).images?.[0]?.url;
      if (!imageUrl) throw new Error("Mô hình không trả về ảnh");
      const file = await stageFromUrl(imageUrl);
      // Image models bill by tokens and do not return the charge; log fal's
      // historical average so cost per character can still be tracked.
      await logUsage({
        provider: "fal",
        endpoint: config.endpoint,
        purpose: "generate-angle",
        angle,
        requestId: result.requestId,
        references: urls.length,
        cost: unitCost,
        costIsEstimate: true,
      });
      return { id: file, url: mediaUrl.staged(file), angle } satisfies GeneratedAngle;
    }),
  );

  const images: GeneratedAngle[] = [];
  const failed: GenerateAnglesResult["failed"] = [];
  settled.forEach((outcome, i) => {
    const angle = input.angles[i] as CoreAngle;
    if (outcome.status === "fulfilled") images.push(outcome.value);
    else failed.push({ angle, message: (outcome.reason as Error).message });
  });
  return { images, failed, source: "fal", cost: unitCost * images.length };
}
