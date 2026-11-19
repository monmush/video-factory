import type { Asset, AssetImage } from "./ipc";

export const CUTOUT_USD = 0.03;

const TONE_MATCH_TO_PLATE_ENABLED = true;
const TONE_STRENGTH = 0.5;
export const TONE_CAP = 0.08;

export const PLACE = { heightShare: 0.4, maxWidthShare: 0.6, baseY: 0.63, centreX: 0.5 };

export const PARALLAX = { plate: 0.035, product: 0.075 };

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function alphaBox(
  bitmap: Uint8Array,
  width: number,
  height: number,
  threshold = 24,
): Box | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((bitmap[(y * width + x) * 4 + 3] ?? 0) < threshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

const EDGE_MARGIN_SHARE = 0.01;
const MIN_EDGE_MARGIN_PX = 2;
const SMALLEST_PRODUCT_AREA_SHARE = 0.02;

export function usableCutout(box: Box | null, width: number, height: number): boolean {
  if (!box) return false;
  const mx = Math.max(MIN_EDGE_MARGIN_PX, width * EDGE_MARGIN_SHARE);
  const my = Math.max(MIN_EDGE_MARGIN_PX, height * EDGE_MARGIN_SHARE);
  const standsFreeOfEveryEdge =
    box.x >= mx && box.y >= my && box.x + box.w <= width - mx && box.y + box.h <= height - my;
  const notASpeck = box.w * box.h >= width * height * SMALLEST_PRODUCT_AREA_SHARE;
  return standsFreeOfEveryEdge && notASpeck;
}

export const originals = (product: Pick<Asset, "images">): AssetImage[] =>
  product.images.filter((i) => i.origin !== "ai");

const usableImage = (product: Pick<Asset, "images">) =>
  originals(product).find((i) => i.cutout?.usable);

export function cutoutsToMake(product: Pick<Asset, "images">): number {
  if (usableImage(product)) return 0;
  return originals(product).filter((i) => !i.cutout).length;
}

export function cutoutUsd(
  productIds: readonly string[],
  assets: readonly Pick<Asset, "id" | "images">[],
): number {
  return productIds.reduce((n, id) => {
    const product = assets.find((a) => a.id === id);
    return n + (product ? cutoutsToMake(product) * CUTOUT_USD : 0);
  }, 0);
}

export function placement(
  size: { width: number; height: number },
  box: { w: number; h: number },
): { x: number; y: number; w: number; h: number; scale: number } {
  const evenForTheEncoder = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  let scale = (size.height * PLACE.heightShare) / box.h;
  if (box.w * scale > size.width * PLACE.maxWidthShare) {
    scale = (size.width * PLACE.maxWidthShare) / box.w;
  }
  const w = evenForTheEncoder(box.w * scale);
  const h = evenForTheEncoder(box.h * scale);
  return {
    w,
    h,
    scale,
    x: Math.round(size.width * PLACE.centreX - w / 2),
    y: Math.round(size.height * PLACE.baseY - h),
  };
}

export type Rgb = [number, number, number];

export function toneGains(product: Rgb, plate: Rgb, on = TONE_MATCH_TO_PLATE_ENABLED): Rgb {
  if (!on) return [1, 1, 1];
  return product.map((value, i) => {
    const gain = 1 + TONE_STRENGTH * ((plate[i] as number) / (value || 1) - 1);
    return Math.min(1 + TONE_CAP, Math.max(1 - TONE_CAP, gain));
  }) as Rgb;
}

export function meanColour(bitmap: Uint8Array, order: "rgba" | "bgra" = "rgba"): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let i = 0; i + 3 < bitmap.length; i += 4) {
    const alpha = (bitmap[i + 3] ?? 0) / 255;
    if (!alpha) continue;
    const c0 = bitmap[i] ?? 0;
    const c2 = bitmap[i + 2] ?? 0;
    r += (order === "rgba" ? c0 : c2) * alpha;
    g += (bitmap[i + 1] ?? 0) * alpha;
    b += (order === "rgba" ? c2 : c0) * alpha;
    a += alpha;
  }
  return a ? [r / a, g / a, b / a] : [128, 128, 128];
}
