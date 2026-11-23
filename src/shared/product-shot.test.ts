import { describe, expect, it } from "vitest";
import type { AssetImage } from "./ipc";
import {
  alphaBox,
  cutoutsToMake,
  PLACE,
  placement,
  TONE_CAP,
  toneGains,
  usableCutout,
} from "./product-shot";
import { SUBTITLE_BOTTOM_MARGIN_SHARE } from "./subtitles";

function bitmap(w: number, h: number, box: { x: number; y: number; w: number; h: number }) {
  const data = new Uint8Array(w * h * 4);
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) data[(y * w + x) * 4 + 3] = 255;
  }
  return data;
}

describe("cut-outs", () => {
  it("finds the product's opaque box", () => {
    expect(alphaBox(bitmap(100, 200, { x: 30, y: 40, w: 20, h: 100 }), 100, 200)).toEqual({
      x: 30,
      y: 40,
      w: 20,
      h: 100,
    });
    expect(alphaBox(new Uint8Array(40), 10, 1)).toBeNull();
  });

  it("is usable only when the product stands free of every edge (a holding hand reaches one) and is more than a speck", () => {
    expect(usableCutout({ x: 30, y: 40, w: 40, h: 100 }, 100, 200)).toBe(true);
    expect(usableCutout({ x: 20, y: 30, w: 50, h: 170 }, 100, 200)).toBe(false);
    expect(usableCutout(null, 100, 200)).toBe(false);
    expect(usableCutout({ x: 50, y: 50, w: 3, h: 3 }, 100, 200)).toBe(false);
  });

  it("are made once per photo and tried in order", () => {
    const photo = (id: string, cutout?: AssetImage["cutout"]): AssetImage => ({
      id,
      file: `${id}.jpg`,
      ...(cutout ? { cutout } : {}),
    });
    const ai: AssetImage = { id: "x", file: "x.png", origin: "ai" };
    expect(cutoutsToMake({ images: [photo("a"), photo("b"), ai] })).toBe(2);
    expect(
      cutoutsToMake({ images: [photo("a", { file: "a.c.png", usable: false }), photo("b")] }),
    ).toBe(1);
    expect(
      cutoutsToMake({ images: [photo("a"), photo("b", { file: "b.c.png", usable: true })] }),
    ).toBe(0);
  });
});

describe("placing the product", () => {
  it("stands on the surface line at a believable height, at both sizes", () => {
    for (const size of [
      { width: 720, height: 1280 },
      { width: 1080, height: 1920 },
    ]) {
      const place = placement(size, { w: 500, h: 1300 });
      expect(place.y + place.h).toBeCloseTo(size.height * PLACE.baseY, -1);
      expect(place.h).toBeCloseTo(size.height * PLACE.heightShare, -1);
      expect(place.x + place.w / 2).toBeCloseTo(size.width / 2, -1);
      expect(place.w % 2).toBe(0);
      expect(place.h % 2).toBe(0);
    }
    const wide = placement({ width: 720, height: 1280 }, { w: 1000, h: 500 });
    expect(wide.w).toBeLessThanOrEqual(720 * PLACE.maxWidthShare + 2);
  });

  it("keeps the product's base above the subtitles, so they never cover its label", () => {
    expect(PLACE.baseY).toBeLessThan(1 - SUBTITLE_BOTTOM_MARGIN_SHARE);
  });

  it("tone match is one mild gain per channel, capped, and can be switched off", () => {
    const gains = toneGains([200, 200, 200], [100, 150, 210]);
    for (const g of gains) expect(Math.abs(g - 1)).toBeLessThanOrEqual(TONE_CAP + 1e-9);
    expect(gains[0]).toBeLessThan(1);
    expect(toneGains([120, 120, 120], [126, 120, 114])).toEqual([1.025, 1, 0.975]);
    expect(toneGains([200, 200, 200], [100, 150, 210], false)).toEqual([1, 1, 1]);
  });
});
