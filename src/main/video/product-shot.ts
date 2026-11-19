import { access, copyFile, rename, writeFile } from "node:fs/promises";
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
import { requestOverdue, timedOutMessage } from "../../shared/request-deadline";
import { openCutout } from "../../shared/request-reconcile";
import { falCall, falCancel, falPoll, falSubmit } from "../fal";
import { uploadImages } from "../fal-upload";
import { assetDir } from "../media";
import { falClient, providerMode } from "../providers";
import { mutate } from "../store";
import { openFalRequests } from "../usage";
import { fixtureCutout, productShot, readRgba, type Size } from "./ffmpeg";

// Product shots (docs/DIRECTING_RULES.md, "Product shots"): the product's
// cut-out, made once per photo and kept beside it in the asset's folder, is
// placed on a generated plate of the spot in the scene. The original photo is
// never modified or replaced. Every paid call goes through src/main/fal.ts.

/**
 * Background removal steered by a prompt (Bria Guided Remove Background on
 * fal, $0.03 per image): keeps the product's own pixels and drops the hand
 * holding it, which plain removal (Bria RMBG 2.0) kept as part of the subject.
 * Tested live on 16 Nov with "only the tea pouch, without the hand"; this
 * wording is the brand-neutral form of it.
 */
const CUTOUT_ENDPOINT = "bria/guided-remove-background";
const CUTOUT_PROMPT = "only the product package, without the hand holding it";

const cutoutFile = (imageId: string) => `${imageId}.cutout.png`;

const running = new Map<string, Promise<CutoutResult | null>>();
const cutting = new Map<string, Promise<{ usable: boolean; paid: boolean }>>();

export class CutoutStopped extends Error {
  constructor() {
    super("Video đã dừng");
  }
}

export interface CutoutResult {
  file: string;
  costUsd: number;
}

export function productCutout(
  product: Asset,
  dir: string,
  alive: () => boolean,
): Promise<CutoutResult | null> {
  const key = `${product.id}|${dir}`;
  const current = running.get(key);
  if (current) return current;
  const task = makeCutout(product, dir, alive).finally(() => running.delete(key));
  running.set(key, task);
  return task;
}

/**
 * Removes the photo's background on fal (paid, CUTOUT_USD) and writes the PNG
 * with alpha to `out`, waiting for the answer: the product dialog
 * (src/main/product-cutout.ts). Videos use `queuedCutout`, which survives a restart.
 */
export async function removeBackground(
  client: Awaited<ReturnType<typeof falClient>>,
  photo: string,
  out: string,
  productId: string,
): Promise<void> {
  const [url] = await uploadImages(client, [photo]);
  const { data } = await falCall<{ image?: { url?: string } }>(
    client,
    CUTOUT_ENDPOINT,
    { image_url: url, prompt: CUTOUT_PROMPT },
    { purpose: "product-cutout", productId, cost: () => CUTOUT_USD },
  );
  const result = data.image?.url;
  if (!result?.startsWith("https:")) throw new Error("Không nhận được ảnh tách nền");
  const res = await fetch(result, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Không tải được ảnh tách nền (${res.status})`);
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CUTOUT_POLL_MS = 2000;

async function fetchTo(url: string | undefined, out: string): Promise<void> {
  if (!url?.startsWith("https:")) throw new Error("Không nhận được ảnh tách nền");
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) {
    throw Object.assign(new Error(`Không tải được ảnh tách nền (${res.status})`), {
      status: res.status,
    });
  }
  const part = `${out}.part`;
  await writeFile(part, Buffer.from(await res.arrayBuffer()));
  await rename(part, out);
}

async function queuedCutout(
  productId: string,
  photo: { id: string; file: string },
  source: string,
  out: string,
  alive: () => boolean,
): Promise<void> {
  const client = await falClient();
  const open = openCutout(await openFalRequests(), productId, photo.id, photo.file);
  let requestId = open?.requestId;
  let sentAt = open?.at ?? new Date().toISOString();
  if (!requestId) {
    const [url] = await uploadImages(client, [source]);
    requestId = await falSubmit(
      client,
      CUTOUT_ENDPOINT,
      { image_url: url, prompt: CUTOUT_PROMPT },
      { purpose: "product-cutout", productId, photoId: photo.id, photoFile: photo.file },
    );
    sentAt = new Date().toISOString();
  }
  for (;;) {
    if (!alive()) throw new CutoutStopped();
    if (requestOverdue("cutout", sentAt, Date.now())) {
      await falCancel(client, CUTOUT_ENDPOINT, requestId);
      throw new Error(timedOutMessage("cutout"));
    }
    const result = await falPoll<{ image?: { url?: string } }>(client, CUTOUT_ENDPOINT, requestId, {
      purpose: "product-cutout",
      productId,
      cost: () => CUTOUT_USD,
      keep: (data) => fetchTo(data.image?.url, out),
    });
    if (result.state === "done") return;
    if (result.state === "failed") throw new Error(result.message);
    await wait(CUTOUT_POLL_MS);
  }
}

function photoCutout(
  productId: string,
  photo: { id: string; file: string },
  alive: () => boolean,
): Promise<{ usable: boolean; paid: boolean }> {
  const key = `${productId}|${photo.id}`;
  const current = cutting.get(key);
  if (current) return current;
  const task = (async () => {
    const name = cutoutFile(photo.id);
    const path = join(assetDir(productId), name);
    const kept = await access(path).then(
      () => true,
      () => false,
    );
    if (!kept) {
      await queuedCutout(productId, photo, join(assetDir(productId), photo.file), path, alive);
    }
    const usable = await isUsableCutout(path);
    await mutate((ws) => {
      const image = ws.assets
        .find((a) => a.id === productId)
        ?.images.find((i) => i.id === photo.id);
      if (image) image.cutout = { file: name, usable };
    });
    return { usable, paid: !kept };
  })().finally(() => cutting.delete(key));
  cutting.set(key, task);
  return task;
}

/** Whether a cut-out shows the product alone (src/shared/product-shot.ts, usableCutout). */
export async function isUsableCutout(path: string): Promise<boolean> {
  const pixels = await readRgba(path, 4096);
  return usableCutout(
    alphaBox(pixels.data, pixels.width, pixels.height),
    pixels.width,
    pixels.height,
  );
}

async function makeCutout(
  product: Asset,
  dir: string,
  alive: () => boolean,
): Promise<CutoutResult | null> {
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
      const made = await photoCutout(product.id, photo, alive);
      if (made.paid) spent += CUTOUT_USD;
      if (!made.usable) continue;
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
