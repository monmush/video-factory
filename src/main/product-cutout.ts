import { randomUUID } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { CUTOUT_USD } from "../shared/cost/rates";
import type { ImageRef, StagedImage } from "../shared/ipc";
import { mediaUrl } from "../shared/ipc";
import { assetDir, stagingDir } from "./media";
import { placePhotoPath } from "./place-check";
import { falClient, providerMode } from "./providers";
import { getWorkspace } from "./store";
import { fixtureCutout } from "./video/ffmpeg";
import { isUsableCutout, removeBackground } from "./video/product-shot";

async function keptCutout(ref: ImageRef): Promise<string | null> {
  if (ref.source !== "asset" || ref.restore) return null;
  const image = (await getWorkspace()).assets
    .find((a) => a.id === ref.assetId)
    ?.images.find((i) => i.id === ref.id);
  if (!image?.cutout || image.cutout.file === image.file) return null;
  return join(assetDir(ref.assetId), image.cutout.file);
}

export async function cutOutProductPhoto(ref: ImageRef): Promise<{
  image: StagedImage;
  usable: boolean;
  source: "fixture" | "fal" | "kept";
  cost: number | null;
}> {
  await mkdir(stagingDir(), { recursive: true });
  const file = `${randomUUID()}.png`;
  const out = join(stagingDir(), file);
  const staged = { id: file, url: mediaUrl.staged(file) };

  const kept = await keptCutout(ref);
  if (kept) {
    await copyFile(kept, out);
    return { image: staged, usable: await isUsableCutout(out), source: "kept", cost: 0 };
  }

  const photo = await placePhotoPath(ref);
  if (providerMode() === "fixture") {
    await new Promise((r) => setTimeout(r, 1200));
    await fixtureCutout(photo, out);
    return { image: staged, usable: await isUsableCutout(out), source: "fixture", cost: null };
  }
  const productId = ref.source === "asset" ? ref.assetId : "new";
  await removeBackground(await falClient(), photo, out, productId);
  return { image: staged, usable: await isUsableCutout(out), source: "fal", cost: CUTOUT_USD };
}
