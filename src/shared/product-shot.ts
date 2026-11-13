import type { Asset, AssetImage } from "./ipc";

// The product moment (docs/DIRECTING_RULES.md, "Product shots"): the
// product's own pixels are never generated or altered beyond one uniform,
// mild tone adjustment; everything around it may be generated. A product
// detail shot is the product's cut-out (its photo with the background
// removed, made once per photo and kept beside it) standing on a generated
// "plate" (the planned spot in the scene, empty), with a soft contact shadow,
// moved in two layers. Pure, so placement, tone and estimates are tested.

/** Background removal, per photo, once (fal's Bria RMBG 2.0 rate, 13 Nov 2026). */
export const CUTOUT_USD = 0.018;

/** Switch the uniform tone match to the plate off (false) to place the cut-out untouched. */
export const TONE_MATCH = true;
/** How far toward the plate's colour the product moves (0–1)… */
export const TONE_STRENGTH = 0.5;
/** …and never more than this per channel (±). */
export const TONE_CAP = 0.08;

/**
 * Where the product stands in a 9:16 product shot. The plate is asked for an
 * empty spot just below the middle, on a surface filling the lower half, so
 * the product's base sits on it: height, base line and centre as shares of
 * the frame. The base stays above the subtitles (centred about 28% from the
 * bottom), so they never cover the label.
 */
export const PLACE = { heightShare: 0.4, maxWidthShare: 0.6, baseY: 0.63, centreX: 0.5 };

/** Slow push-in over the shot: the scene a little, the product (nearer the camera) more. */
export const PARALLAX = { plate: 0.035, product: 0.075 };

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The bounding box of the opaque pixels of an RGBA/BGRA bitmap (alpha is byte 3). */
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

/**
 * The simple rule for "the product alone" (no per-photo record exists): the
 * cut-out stands free of every edge of the photo. A hand or arm holding the
 * product enters from an edge and stays in the cut-out, and a product cropped
 * by the frame cannot stand on a table either, so both are refused.
 */
export function usableCutout(box: Box | null, width: number, height: number): boolean {
  if (!box) return false;
  const mx = Math.max(2, width * 0.01);
  const my = Math.max(2, height * 0.01);
  const free =
    box.x >= mx && box.y >= my && box.x + box.w <= width - mx && box.y + box.h <= height - my;
  return free && box.w * box.h >= width * height * 0.02;
}

/** A product's photos to try, in order: the originals (never AI-made images). */
export const originals = (product: Pick<Asset, "images">): AssetImage[] =>
  product.images.filter((i) => i.origin !== "ai");

/** The photo whose cut-out is used: the first usable one, if any has been made. */
export const usableImage = (product: Pick<Asset, "images">) =>
  originals(product).find((i) => i.cutout?.usable);

/**
 * Cut-outs a product may still need, at most: none once one is usable,
 * else every original not tried yet (they are tried in order until one is).
 */
export function cutoutsToMake(product: Pick<Asset, "images">): number {
  if (usableImage(product)) return 0;
  return originals(product).filter((i) => !i.cutout).length;
}

/** What missing cut-outs add to a script's price: only with a place, only once ever per photo. */
export function cutoutUsd(
  productIds: readonly string[],
  assets: readonly Pick<Asset, "id" | "images">[],
): number {
  return productIds.reduce((n, id) => {
    const product = assets.find((a) => a.id === id);
    return n + (product ? cutoutsToMake(product) * CUTOUT_USD : 0);
  }, 0);
}

/**
 * Where the cut-out goes on a frame of `size`: scaled from its opaque box to
 * a believable height (narrower ones capped), base on the surface line.
 * Sizes are even, for the encoder.
 */
export function placement(
  size: { width: number; height: number },
  box: { w: number; h: number },
): { x: number; y: number; w: number; h: number; scale: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  let scale = (size.height * PLACE.heightShare) / box.h;
  if (box.w * scale > size.width * PLACE.maxWidthShare) {
    scale = (size.width * PLACE.maxWidthShare) / box.w;
  }
  const w = even(box.w * scale);
  const h = even(box.h * scale);
  return {
    w,
    h,
    scale,
    x: Math.round(size.width * PLACE.centreX - w / 2),
    y: Math.round(size.height * PLACE.baseY - h),
  };
}

export type Rgb = [number, number, number];

/**
 * One gain per channel, applied to every product pixel alike: part of the
 * way from the product's average colour toward the plate's around it, never
 * more than TONE_CAP. Off (all 1) when TONE_MATCH is false.
 */
export function toneGains(product: Rgb, plate: Rgb, on = TONE_MATCH): Rgb {
  if (!on) return [1, 1, 1];
  return product.map((value, i) => {
    const gain = 1 + TONE_STRENGTH * ((plate[i] as number) / (value || 1) - 1);
    return Math.min(1 + TONE_CAP, Math.max(1 - TONE_CAP, gain));
  }) as Rgb;
}

/** Average colour of the opaque pixels of an RGBA bitmap (alpha-weighted). */
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
