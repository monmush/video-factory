import { describe, expect, it } from "vitest";
import type { Asset, AssetImage, PlaceFinding } from "./ipc";
import {
  cleanPrompt,
  cleanSize,
  findingLabel,
  flaggedPlaces,
  isFlagged,
  placeFinding,
  readFinding,
} from "./place-check";

const found = (people: boolean, packaging: string | null = null): PlaceFinding => ({
  people,
  packaging,
  checkedAt: "2026-11-13T00:00:00.000Z",
});

const photo = (id: string, placeCheck?: PlaceFinding): AssetImage => ({
  id,
  file: `${id}.png`,
  placeCheck,
});

const place = (id: string, images: AssetImage[], kind: Asset["kind"] = "environment"): Asset => ({
  id,
  kind,
  name: id,
  handle: id,
  description: "",
  images,
  createdAt: "",
  updatedAt: "",
});

describe("place photo findings", () => {
  it("flags people or packaging, nothing else", () => {
    expect(isFlagged(undefined)).toBe(false);
    expect(isFlagged(null)).toBe(false);
    expect(isFlagged(found(false))).toBe(false);
    expect(isFlagged(found(true))).toBe(true);
    expect(isFlagged(found(false, "gift box"))).toBe(true);
  });

  it("names what was found in one short line", () => {
    expect(findingLabel(found(true))).toBe("Có người trong ảnh");
    expect(findingLabel(found(false, "gift box"))).toBe("Có hộp có chữ");
    expect(findingLabel(found(true, "gift box"))).toBe("Có người và hộp có chữ");
    expect(findingLabel(found(false))).toBeNull();
    expect(findingLabel(undefined)).toBeNull();
  });

  it("reads the AI's answer, treating anything unclear as nothing found", () => {
    expect(readFinding({ people: true, packaging: "red box with gold text" })).toMatchObject({
      people: true,
      packaging: "red box with gold text",
    });
    expect(readFinding({ people: 2, packaging: null })).toMatchObject({ people: true });
    expect(readFinding({ people: 0, packaging: "none" })).toMatchObject({
      people: false,
      packaging: null,
    });
    expect(readFinding({ people: "yes", packaging: "  " })).toMatchObject({
      people: false,
      packaging: null,
    });
    expect(readFinding({}).checkedAt).toMatch(/^\d{4}-/);
  });

  it("lists only the series' places that still have a flagged photo", () => {
    const clean = place("clean", [photo("a", found(false)), photo("b")]);
    const dirty = place("dirty", [photo("c", found(false)), photo("d", found(true))]);
    const product = place("product", [photo("e", found(true))], "product");
    const assets = [clean, dirty, product];
    expect(flaggedPlaces(["clean", "dirty", "product", "gone"], assets)).toEqual([dirty]);
    expect(flaggedPlaces([], assets)).toEqual([]);
  });

  it("combines a place's flagged photos", () => {
    const both = place("p", [photo("a", found(true)), photo("b", found(false, "bag"))]);
    expect(placeFinding(both)).toMatchObject({ people: true, packaging: "bag" });
    expect(placeFinding(place("q", [photo("a", found(false))]))).toBeNull();
  });
});

describe("cleaning a place photo", () => {
  it("asks to remove only what was found and to keep everything else", () => {
    const people = cleanPrompt(found(true));
    expect(people).toContain("every person");
    expect(people).toContain("leave the seat empty");
    expect(people).not.toContain("packaging");
    const box = cleanPrompt(found(false, "gift box with lettering"));
    expect(box).toContain("gift box with lettering");
    expect(box).not.toContain("person");
    for (const prompt of [people, box, cleanPrompt(found(true, "box"))]) {
      expect(prompt).toContain("aspect ratio");
      expect(prompt).toContain("Do not add anything new");
    }
  });

  it("keeps the original's aspect ratio in model-friendly sizes", () => {
    expect(cleanSize(4000, 3000)).toEqual({ width: 1536, height: 1152 });
    expect(cleanSize(1080, 1920)).toEqual({ width: 864, height: 1536 });
    expect(cleanSize(1000, 1000)).toEqual({ width: 1536, height: 1536 });
    // Very wide panoramas are held to 3:1.
    expect(cleanSize(9000, 1000)).toEqual({ width: 1536, height: 512 });
    for (const [w, h] of [
      [1234, 987],
      [640, 1500],
    ] as const) {
      const size = cleanSize(w, h);
      expect(size.width % 16).toBe(0);
      expect(size.height % 16).toBe(0);
    }
    expect(cleanSize(0, 0)).toEqual({ width: 1024, height: 1536 });
  });
});
