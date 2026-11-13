import { randomUUID } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { nativeImage } from "electron";
import type { ImageRef, PlaceFinding, StagedImage } from "../shared/ipc";
import { mediaUrl } from "../shared/ipc";
import { cleanPrompt, cleanSize, PLACE_CHECK_QUESTION, readFinding } from "../shared/place-check";
import { DEFAULT_IMAGE_MODEL, estimateAngles, MODELS, stageFromUrl } from "./angles";
import { askClaudeCode } from "./claude-code";
import { falCall } from "./fal";
import { uploadImages } from "./fal-upload";
import { assetDir, imageRefPath, stagingDir } from "./media";
import { falClient, providerMode } from "./providers";
import { getWorkspace, mutate } from "./store";
import { parseJsonObject } from "./text-ai";
import { logUsage } from "./usage";
import { checksEnabled } from "./video/checks";

// Place photos (docs/SERIES_SETUP_DECISIONS.md, "Clean place photos"). The
// user's own AI looks at each photo of a place for people and packaging,
// which the image model would otherwise copy into every still. Free, like
// the still checks: only live with Claude as the text AI; a check that cannot
// run returns null and never blocks saving. A flagged photo can be cleaned by
// the image-edit model the stills use (paid, through falCall; fixture mode
// copies the photo instead).
//
// HYAN_FIXTURE_PLACE_CHECK=1 (fixture mode only) answers every photo as
// showing people and packaging, except photos "cleaned" in fixture mode, so
// the whole flow can be driven without any AI.

const SYSTEM = "You inspect images for a video production. Answer with one JSON object only.";

const fixtureChecks = () =>
  providerMode() === "fixture" && process.env.HYAN_FIXTURE_PLACE_CHECK === "1";

export const placeChecksEnabled = () => checksEnabled() || fixtureChecks();

/** Files made by the fixture clean: the fixture check finds nothing in them. */
const fixtureCleaned = new Set<string>();

/** Findings by absolute path, and checks still running, so a photo is asked about once. */
const results = new Map<string, PlaceFinding>();
const running = new Map<string, Promise<PlaceFinding | null>>();

async function ask(path: string): Promise<PlaceFinding | null> {
  if (fixtureChecks()) {
    await new Promise((r) => setTimeout(r, 800));
    return fixtureCleaned.has(basename(path))
      ? readFinding({ people: false, packaging: null })
      : readFinding({ people: true, packaging: "gift box with lettering" });
  }
  if (!checksEnabled()) return null;
  try {
    const answer = await askClaudeCode({
      system: SYSTEM,
      prompt: PLACE_CHECK_QUESTION,
      imagePaths: [path],
      maxImageSide: 1024,
      model: "sonnet",
      effort: "low",
      timeoutMs: 90_000,
    });
    await logUsage({
      provider: "claude-code",
      purpose: "place-photo-check",
      notionalCostUsd: answer.notionalCostUsd,
      durationMs: answer.durationMs,
    });
    return readFinding(parseJsonObject(answer.text));
  } catch (error) {
    console.warn("[place] photo check skipped:", (error as Error).message);
    return null;
  }
}

/** The finding for one image file, asking at most once per file at a time. */
function checkFile(path: string): Promise<PlaceFinding | null> {
  const known = results.get(path);
  if (known) return Promise.resolve(known);
  const current = running.get(path);
  if (current) return current;
  const task = ask(path)
    .then((finding) => {
      if (finding) results.set(path, finding);
      return finding;
    })
    .finally(() => running.delete(path));
  running.set(path, task);
  return task;
}

/**
 * A staged photo being saved into an asset folder keeps its finding, or its
 * check still running. Returns the finding when it is already known.
 */
export function carryOverCheck(from: string, to: string): PlaceFinding | undefined {
  const known = results.get(from);
  if (known) {
    results.set(to, known);
    return known;
  }
  const current = running.get(from);
  if (current) {
    running.set(
      to,
      current
        .then((finding) => {
          if (finding) results.set(to, finding);
          return finding;
        })
        .finally(() => running.delete(to)),
    );
  }
  return undefined;
}

/** Saves a finding on the asset's photo without touching the asset's updatedAt. */
async function record(assetId: string, file: string, finding: PlaceFinding) {
  await mutate((ws) => {
    const image = ws.assets.find((a) => a.id === assetId)?.images.find((i) => i.file === file);
    if (image && !image.placeCheck) image.placeCheck = finding;
  });
}

/** Checks place photos (staged or saved). Saved photos keep their finding and are not asked again. */
export async function checkPlaceImages(refs: ImageRef[]): Promise<(PlaceFinding | null)[]> {
  if (!placeChecksEnabled()) return refs.map(() => null);
  const ws = await getWorkspace();
  return Promise.all(
    refs.map(async (ref) => {
      try {
        if (ref.source === "asset") {
          const image = ws.assets
            .find((a) => a.id === ref.assetId)
            ?.images.find((i) => i.id === ref.id);
          if (!image) return null;
          if (ref.restore) return image.original?.placeCheck ?? null;
          if (image.placeCheck) return image.placeCheck;
          const finding = await checkFile(join(assetDir(ref.assetId), image.file));
          if (finding) await record(ref.assetId, image.file, finding);
          return finding;
        }
        return await checkFile(imageRefPath(ref));
      } catch (error) {
        console.warn("[place] photo check skipped:", (error as Error).message);
        return null;
      }
    }),
  );
}

/** After a place is saved: checks its photos that have no finding yet (in the background). */
export async function checkPlace(assetId: string): Promise<void> {
  if (!placeChecksEnabled()) return;
  const ws = await getWorkspace();
  const place = ws.assets.find((a) => a.id === assetId);
  if (place?.kind !== "environment") return;
  await checkPlaceImages(
    place.images
      .filter((i) => !i.placeCheck)
      .map((i) => ({ source: "asset", assetId, id: i.id }) as const),
  );
}

/** The file a place photo ref shows: a restored photo is its original. */
export async function placePhotoPath(ref: ImageRef): Promise<string> {
  if (ref.source === "staged") return imageRefPath(ref);
  const image = (await getWorkspace()).assets
    .find((a) => a.id === ref.assetId)
    ?.images.find((i) => i.id === ref.id);
  if (!image) throw new Error(`Image not found: ${ref.id}`);
  return join(
    assetDir(ref.assetId),
    ref.restore && image.original ? image.original.file : image.file,
  );
}

/** Price of one cleaned photo: the image model's per-image estimate. */
export const estimateClean = () => estimateAngles(DEFAULT_IMAGE_MODEL, 1);

/**
 * Asks the image-edit model to remove what the check found, keeping
 * everything else. The result is staged and checked again.
 */
export async function cleanPlacePhoto(
  path: string,
  finding: PlaceFinding,
): Promise<{
  image: StagedImage;
  finding: PlaceFinding | null;
  source: "fixture" | "fal";
  cost: number | null;
}> {
  if (!finding.people && !finding.packaging) throw new Error("Ảnh này không cần làm sạch");
  await mkdir(stagingDir(), { recursive: true });

  if (providerMode() === "fixture") {
    await new Promise((r) => setTimeout(r, 1500));
    const ext = extname(path).toLowerCase() === ".jpeg" ? ".jpg" : extname(path).toLowerCase();
    const file = `${randomUUID()}${ext}`;
    await copyFile(path, join(stagingDir(), file));
    fixtureCleaned.add(file);
    const checked = await checkFile(join(stagingDir(), file));
    return {
      image: { id: file, url: mediaUrl.staged(file) },
      finding: checked,
      source: "fixture",
      cost: null,
    };
  }

  const model = DEFAULT_IMAGE_MODEL;
  const config = MODELS[model];
  const fal = await falClient();
  const [url] = await uploadImages(fal, [path]);
  const { cost: unitCost } = await estimateAngles(model, 1);
  const size = nativeImage.createFromPath(path).getSize();
  const base = config.input(cleanPrompt(finding), [url as string]);
  // The original's aspect ratio: an exact size where the model takes one.
  const input =
    model === "gpt-image"
      ? { ...base, image_size: cleanSize(size.width, size.height) }
      : { ...base, aspect_ratio: "auto" };
  const { data } = await falCall<{ images?: { url: string }[] }>(fal, config.endpoint, input, {
    purpose: "clean-place-photo",
    people: finding.people,
    packaging: finding.packaging,
    cost: () => unitCost,
    costIsEstimate: true,
  });
  const imageUrl = data.images?.[0]?.url;
  if (!imageUrl) throw new Error("Mô hình không trả về ảnh");
  const file = await stageFromUrl(imageUrl);
  const checked = await checkFile(join(stagingDir(), file));
  return {
    image: { id: file, url: mediaUrl.staged(file) },
    finding: checked,
    source: "fal",
    cost: unitCost,
  };
}
