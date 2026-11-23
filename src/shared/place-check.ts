import type { Asset, AssetImage, PlaceFinding } from "./ipc";

const foundSomething = (finding: PlaceFinding | null | undefined): finding is PlaceFinding =>
  Boolean(finding && (finding.people || finding.packaging));

export const isFlagged = (finding: PlaceFinding | null | undefined): finding is PlaceFinding =>
  foundSomething(finding) && !finding.accepted;

export const isAccepted = (finding: PlaceFinding | null | undefined): finding is PlaceFinding =>
  foundSomething(finding) && Boolean(finding.accepted);

export function findingLabel(finding: PlaceFinding | null | undefined): string | null {
  if (!foundSomething(finding)) return null;
  if (finding.people && finding.packaging) return "Có người và hộp có chữ";
  return finding.people ? "Có người" : "Có hộp có chữ";
}

export function findingReason(finding: PlaceFinding | null | undefined): string | null {
  if (!foundSomething(finding)) return null;
  if (finding.people && finding.packaging) {
    return "Người và hộp này có thể xuất hiện lại trong video, chữ dễ bị méo.";
  }
  return finding.people
    ? "Người này có thể xuất hiện lại trong video."
    : "Hộp này có thể xuất hiện lại trong video, chữ dễ bị méo.";
}

export function placeWarning(placeName: string, finding: PlaceFinding | null | undefined) {
  const label = findingLabel(finding);
  const reason = findingReason(finding);
  if (!label || !reason) return null;
  return { what: `Ảnh bối cảnh "${placeName}" ${label.toLocaleLowerCase("vi")}`, why: reason };
}

const flaggedImages = (place: Pick<Asset, "images">): AssetImage[] =>
  place.images.filter((i) => isFlagged(i.placeCheck));

export function flaggedPlaces(placeIds: readonly string[], assets: readonly Asset[]): Asset[] {
  return placeIds
    .map((id) => assets.find((a) => a.id === id && a.kind === "environment"))
    .filter((a): a is Asset => Boolean(a && flaggedImages(a).length));
}

export function setAccepted(
  images: readonly AssetImage[],
  imageIds: readonly string[],
  accepted: boolean,
): AssetImage[] {
  return images.map((image) => {
    if (!imageIds.includes(image.id) || !foundSomething(image.placeCheck)) return image;
    const { accepted: _, ...finding } = image.placeCheck;
    return { ...image, placeCheck: accepted ? { ...finding, accepted } : finding };
  });
}

export function withCheck(image: AssetImage, file: string, finding: PlaceFinding): AssetImage {
  return image.file === file && !image.placeCheck ? { ...image, placeCheck: finding } : image;
}

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

export const PLACE_CHECK_QUESTION = `This photo is a reference of a place where video scenes are staged. Look at it and answer:
{"people": true if any person or part of a person (face, body, hands) is visible, otherwise false,
 "packaging": any product packaging (box, bag, pouch, tin, carton, bottle or jar with a label) or any box, bag, label or sign with lettering on it, in a few words; null if none}`;

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

const CLEAN_LONG_SIDE = 1536;

export function cleanSize(width: number, height: number): { width: number; height: number } {
  if (!(width > 0 && height > 0)) return { width: 1024, height: 1536 };
  const ratio = Math.min(3, Math.max(1 / 3, width / height));
  const round = (n: number) => Math.max(16, Math.round(n / 16) * 16);
  return ratio >= 1
    ? { width: CLEAN_LONG_SIDE, height: round(CLEAN_LONG_SIDE / ratio) }
    : { width: round(CLEAN_LONG_SIDE * ratio), height: CLEAN_LONG_SIDE };
}

export function placeFinding(place: Pick<Asset, "images">): PlaceFinding | null {
  const flagged = flaggedImages(place).map((i) => i.placeCheck as PlaceFinding);
  if (!flagged.length) return null;
  return {
    people: flagged.some((f) => f.people),
    packaging: flagged.find((f) => f.packaging)?.packaging ?? null,
    checkedAt: flagged[0]?.checkedAt ?? "",
  };
}
