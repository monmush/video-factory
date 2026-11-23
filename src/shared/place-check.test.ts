import { describe, expect, it } from "vitest";
import type { Asset, AssetImage, PlaceFinding } from "./ipc";
import {
  cleanPrompt,
  cleanSize,
  findingLabel,
  flaggedPlaces,
  isFlagged,
  placeFinding,
  placeWarning,
  readFinding,
  setAccepted,
  withCheck,
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
    expect(findingLabel(found(true))).toBe("Có người");
    expect(findingLabel(found(false, "gift box"))).toBe("Có hộp có chữ");
    expect(findingLabel(found(true, "gift box"))).toBe("Có người và hộp có chữ");
    expect(findingLabel(found(false))).toBeNull();
    expect(findingLabel(undefined)).toBeNull();
  });

  it("says which place photo is affected and why it matters for the video", () => {
    expect(placeWarning("Văn phòng hy an", found(false, "gift box"))).toEqual({
      what: 'Ảnh bối cảnh "Văn phòng hy an" có hộp có chữ',
      why: "Hộp này có thể xuất hiện lại trong video, chữ dễ bị méo.",
    });
    expect(placeWarning("Quán", found(true))?.what).toBe('Ảnh bối cảnh "Quán" có người');
    expect(placeWarning("Quán", found(false))).toBeNull();
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

describe("keeping a flagged place photo as it is", () => {
  const office = place("office", [photo("a", found(false, "gift box")), photo("b", found(true))]);
  const kept = { ...office, images: setAccepted(office.images, ["a", "b"], true) };

  it("stops flagging the place once its findings are accepted", () => {
    expect(flaggedPlaces(["office"], [office])).toEqual([office]);
    expect(flaggedPlaces(["office"], [kept])).toEqual([]);
    expect(placeFinding(kept)).toBeNull();
    expect(findingLabel(kept.images[0]?.placeCheck)).toBe("Có hộp có chữ");
  });

  it("flags again when the decision is undone", () => {
    const undone = { ...kept, images: setAccepted(kept.images, ["a"], false) };
    expect(undone.images.map((i) => isFlagged(i.placeCheck))).toEqual([true, false]);
  });

  it("keeps the decision when the same photo is checked again", () => {
    const [accepted] = kept.images as [AssetImage];
    const rechecked = withCheck(accepted, accepted.file, found(false, "gift box"));
    expect(isFlagged(rechecked.placeCheck)).toBe(false);
  });

  it("checks a different photo afresh", () => {
    const [accepted] = kept.images as [AssetImage];
    const replaced = { ...accepted, file: "cleaned.png", placeCheck: undefined };
    expect(withCheck(replaced, "cleaned.png", found(false, "gift box")).placeCheck).toEqual(
      found(false, "gift box"),
    );
    expect(withCheck(accepted, "other.png", found(true)).placeCheck).toBe(accepted.placeCheck);
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
