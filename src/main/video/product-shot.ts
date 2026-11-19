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

const CUTOUT_ENDPOINT = "bria/guided-remove-background";
const PROMPT_KEEPING_PRODUCT_WITHOUT_HOLDING_HAND =
  "only the product package, without the hand holding it";

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
    { image_url: url, prompt: PROMPT_KEEPING_PRODUCT_WITHOUT_HOLDING_HAND },
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
      { image_url: url, prompt: PROMPT_KEEPING_PRODUCT_WITHOUT_HOLDING_HAND },
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

async function layers(plate: string, cutout: string, size: Size) {
  const cut = await readRgba(cutout, 4096);
  const box = alphaBox(cut.data, cut.width, cut.height);
  if (!box) throw new Error("Ảnh tách nền trống");
  const place = placement(size, box);
  const small = await readRgba(plate, 256);
  const row = (share: number) => Math.round(small.height * share) * small.width * 4;
  const top = (place.y + place.h * 0.4) / size.height;
  const bottom = Math.min(1, (place.y + place.h * 1.1) / size.height);
  const band = small.data.slice(row(top), row(bottom));
  const product = await readRgba(cutout, 256);
  const gains: Rgb = toneGains(meanColour(product.data), meanColour(band));
  return { box, place, gains };
}

export async function productStillOn(
  plate: string,
  cutout: string,
  out: string,
  size: Size,
): Promise<void> {
  const layout = await layers(plate, cutout, size);
  await productShot({ plate, cutout, ...layout, frames: 1, size, zoom: PARALLAX, out });
}

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
