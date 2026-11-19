import type { Asset, AssetImage, PlaceFinding } from "./ipc";

// Place photos (docs/SERIES_SETUP_DECISIONS.md, "Clean place photos"): the
// image model copies what a place photo shows into every still, so people
// and lettered packaging in it end up redrawn in scenes. The user's own AI
// looks at each photo once; a flagged photo can be cleaned by the image-edit
// model. Pure, so the dialog, the ready check and tests share one answer.

/** The photo shows people or packaging. */
export const isFlagged = (finding: PlaceFinding | null | undefined): finding is PlaceFinding =>
  Boolean(finding && (finding.people || finding.packaging));

/** One short line naming what was found, or null when nothing was. */
export function findingLabel(finding: PlaceFinding | null | undefined): string | null {
  if (!isFlagged(finding)) return null;
  if (finding.people && finding.packaging) return "Có người và hộp có chữ";
  return finding.people ? "Có người trong ảnh" : "Có hộp có chữ";
}

/** A place's photos whose check found something. */
const flaggedImages = (place: Pick<Asset, "images">): AssetImage[] =>
  place.images.filter((i) => isFlagged(i.placeCheck));

/** The series' places that still have a flagged photo, in the series' order. */
export function flaggedPlaces(placeIds: readonly string[], assets: readonly Asset[]): Asset[] {
  return placeIds
    .map((id) => assets.find((a) => a.id === id && a.kind === "environment"))
    .filter((a): a is Asset => Boolean(a && flaggedImages(a).length));
}

/**
 * The answer of the user's AI read into a finding. Anything unreadable
 * counts as nothing found: a check never blocks.
 */
export function readFinding(answer: { people?: unknown; packaging?: unknown }): PlaceFinding {
  const people = answer.people === true || (typeof answer.people === "number" && answer.people > 0);
  const packaging =
    typeof answer.packaging === "string" &&
    answer.packaging.trim() &&
    !/^(none|null|no)$/i.test(answer.packaging.trim())
      ? answer.packaging.trim().slice(0, 120)
      : null;
  return { people, packaging, checkedAt: new Date().toISOString() };
}

/** The question asked of the user's AI for each place photo. */
export const PLACE_CHECK_QUESTION = `This photo is a reference of a place where video scenes are staged. Look at it and answer:
{"people": true if any person or part of a person (face, body, hands) is visible, otherwise false,
 "packaging": any product packaging (box, bag, pouch, tin, carton, bottle or jar with a label) or any box, bag, label or sign with lettering on it, in a few words; null if none}`;

/**
 * The image-edit request that removes what the check found. Everything else
 * stays: the place, furniture, objects, light, framing and aspect ratio.
 */
export function cleanPrompt(finding: PlaceFinding): string {
  const remove = [
    finding.people ? "every person (whole bodies, faces, hands and anything they are wearing)" : "",
    finding.packaging
      ? `all product packaging and every box, bag, label or sign with lettering on it (seen here: ${finding.packaging})`
      : "",
  ].filter(Boolean);
  return [
    "Edit this photo of a place.",
    `Remove ${remove.join(", and ")} completely.`,
    "Fill each area they covered with what would naturally be behind them, continuing the surfaces, furniture and background around it.",
    finding.people ? "Where a person sat, leave the seat empty." : "",
    "Keep everything else exactly as it is: the place, the architecture, the furniture and every other object in the same position, the materials, colours, light and shadows, the camera position, the framing and the aspect ratio.",
    "Do not add anything new: no people, objects, props, plants, text, logos or decoration that are not already in the photo.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Longest side asked of the image model for a cleaned photo. */
const CLEAN_LONG_SIDE = 1536;

/**
 * The output size for a cleaned photo: the original's aspect ratio (within
 * 1:3 and 3:1), long side CLEAN_LONG_SIDE, both sides multiples of 16.
 */
export function cleanSize(width: number, height: number): { width: number; height: number } {
  if (!(width > 0 && height > 0)) return { width: 1024, height: 1536 };
  const ratio = Math.min(3, Math.max(1 / 3, width / height));
  const round = (n: number) => Math.max(16, Math.round(n / 16) * 16);
  return ratio >= 1
    ? { width: CLEAN_LONG_SIDE, height: round(CLEAN_LONG_SIDE / ratio) }
    : { width: round(CLEAN_LONG_SIDE * ratio), height: CLEAN_LONG_SIDE };
}

/** What a place's flagged photos show together, for one line about the place. */
export function placeFinding(place: Pick<Asset, "images">): PlaceFinding | null {
  const flagged = flaggedImages(place).map((i) => i.placeCheck as PlaceFinding);
  if (!flagged.length) return null;
  return {
    people: flagged.some((f) => f.people),
    packaging: flagged.find((f) => f.packaging)?.packaging ?? null,
    checkedAt: flagged[0]?.checkedAt ?? "",
  };
}
