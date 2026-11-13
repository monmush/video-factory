import { copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Asset } from "../../shared/ipc";
import {
  alphaBox,
  CUTOUT_USD,
  meanColour,
  originals,
  PARALLAX,
  placement,
  type Rgb,
  toneGains,
  usableCutout,
} from "../../shared/product-shot";
import { falCall } from "../fal";
import { uploadImages } from "../fal-upload";
import { assetDir } from "../media";
import { falClient, providerMode } from "../providers";
import { mutate } from "../store";
import { fixtureCutout, productShot, readRgba, type Size } from "./ffmpeg";

// Product shots (docs/DIRECTING_RULES.md, "Product shots"): the product's
// cut-out, made once per photo and kept beside it in the asset's folder, is
// placed on a generated plate of the spot in the scene. The original photo is
// never modified or replaced. Every paid call goes through falCall.

/** Background removal (Bria RMBG 2.0 on fal; $0.018 per image, no prompt). */
const CUTOUT_ENDPOINT = "fal-ai/bria/background/remove";

const cutoutFile = (imageId: string) => `${imageId}.cutout.png`;

/** One cut-out run per product at a time, so two shots never pay twice. */
const running = new Map<string, Promise<CutoutResult | null>>();

export interface CutoutResult {
  /** The cut-out, copied into the job folder. */
  file: string;
  /** Charged now (0 when it was kept from before). */
  costUsd: number;
}

/**
 * The product's usable cut-out in the job folder, made if missing: the
 * photos are tried in order, each cut out once ever and recorded on the
 * asset, until one shows the product alone. Null when none does. Fixture
 * mode simulates one in the job folder only (never recorded on the asset).
 */
export function productCutout(product: Asset, dir: string): Promise<CutoutResult | null> {
  const key = `${product.id}|${dir}`;
  const current = running.get(key);
  if (current) return current;
  const task = makeCutout(product, dir).finally(() => running.delete(key));
  running.set(key, task);
  return task;
}

async function makeCutout(product: Asset, dir: string): Promise<CutoutResult | null> {
  const file = `cutout-${product.id}.png`;
  const photos = originals(product);
  if (!photos.length) return null;
  if (providerMode() === "fixture") {
    await fixtureCutout(
      join(assetDir(product.id), (photos[0] as { file: string }).file),
      join(dir, file),
    );
    return { file, costUsd: 0 };
  }
  let spent = 0;
  for (const photo of photos) {
    const saved = photo.cutout;
    if (saved && !saved.usable) continue;
    if (!saved) {
      const client = await falClient();
      const [url] = await uploadImages(client, [join(assetDir(product.id), photo.file)]);
      const { data } = await falCall<{ image?: { url?: string } }>(
        client,
        CUTOUT_ENDPOINT,
        { image_url: url },
        { purpose: "product-cutout", productId: product.id, cost: () => CUTOUT_USD },
      );
      spent += CUTOUT_USD;
      const result = data.image?.url;
      if (!result?.startsWith("https:")) throw new Error("Không nhận được ảnh tách nền");
      const res = await fetch(result, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`Không tải được ảnh tách nền (${res.status})`);
      const name = cutoutFile(photo.id);
      await writeFile(join(assetDir(product.id), name), Buffer.from(await res.arrayBuffer()));
      const pixels = await readRgba(join(assetDir(product.id), name), 4096);
      const usable = usableCutout(
        alphaBox(pixels.data, pixels.width, pixels.height),
        pixels.width,
        pixels.height,
      );
      // Recorded on the photo, so no later video pays for it again.
      await mutate((ws) => {
        const image = ws.assets
          .find((a) => a.id === product.id)
          ?.images.find((i) => i.id === photo.id);
        if (image) image.cutout = { file: name, usable };
      });
      if (!usable) continue;
    }
    await copyFile(
      join(assetDir(product.id), saved?.file ?? cutoutFile(photo.id)),
      join(dir, file),
    );
    return { file, costUsd: spent };
  }
  return null;
}

/** How a cut-out sits on its plate at this size: its box, place and the tone gains. */
async function layers(plate: string, cutout: string, size: Size) {
  const cut = await readRgba(cutout, 4096);
  const box = alphaBox(cut.data, cut.width, cut.height);
  if (!box) throw new Error("Ảnh tách nền trống");
  const place = placement(size, box);
  // The plate's colour around the spot (the band where the product stands).
  const small = await readRgba(plate, 256);
  const row = (share: number) => Math.round(small.height * share) * small.width * 4;
  const top = (place.y + place.h * 0.4) / size.height;
  const bottom = Math.min(1, (place.y + place.h * 1.1) / size.height);
  const band = small.data.slice(row(top), row(bottom));
  const product = await readRgba(cutout, 256);
  const gains: Rgb = toneGains(meanColour(product.data), meanColour(band));
  return { box, place, gains };
}

/** The product shot's still: the cut-out on its plate (also what the Video tab shows). */
export async function productStillOn(
  plate: string,
  cutout: string,
  out: string,
  size: Size,
): Promise<void> {
  const layout = await layers(plate, cutout, size);
  await productShot({ plate, cutout, ...layout, frames: 1, size, zoom: PARALLAX, out });
}

/** The product shot as a clip of exactly `frames` frames, plate and product moving apart. */
export async function productClip(
  plate: string,
  cutout: string,
  frames: number,
  out: string,
  size: Size,
): Promise<void> {
  const layout = await layers(plate, cutout, size);
  await productShot({ plate, cutout, ...layout, frames, size, zoom: PARALLAX, out });
}
