import type { Route } from "./live-plan";
import { plannedShotSec } from "./live-plan";
import type { Framing, ShotKind } from "./shot-plan";

// How a planned shot reads on the "Dàn dựng" tab: its framing as a short label,
// whether it moves, how long it lasts and what the viewer sees. The director
// writes no shot size into its brief (src/main/video/shot-list-prompt.md), so
// the label comes from the shot and the picture it starts from, here.

export type SceneFraming =
  | "Qua vai"
  | "Cận mặt"
  | "Trung cảnh"
  | "Toàn cảnh"
  | "Sản phẩm"
  | "Cận chi tiết";

interface SceneShot {
  kind: ShotKind;
  framing: Framing | null;
  productId: string | null;
  route?: Route;
  keyframe?: string;
}

/** The framing label of a shot, from its kind and the (English) framing of its starting picture. */
export function sceneFraming(
  shot: SceneShot,
  keyframes: { id: string; framing: string }[] = [],
): SceneFraming {
  switch (shot.kind) {
    case "speaker":
    case "listener": {
      const picture = shot.keyframe ? keyframes.find((k) => k.id === shot.keyframe) : undefined;
      if (picture && /shoulder/i.test(picture.framing)) return "Qua vai";
      return shot.framing === "close" ? "Cận mặt" : "Trung cảnh";
    }
    case "wide":
      return "Toàn cảnh";
    case "detail":
      return shot.productId ? "Sản phẩm" : "Cận chi tiết";
  }
}

/** The camera moves through the shot (a motion clip), rather than holding on a speaker or a still. */
export const sceneMoves = (shot: Pick<SceneShot, "route">) => shot.route === "motion";

/** Whole seconds on screen (at least 1): its place in the video once known, else as planned. */
export function sceneSeconds(shot: {
  text: string;
  hold?: number;
  start?: number;
  end?: number;
}): number {
  const sec =
    shot.start !== undefined && shot.end !== undefined
      ? shot.end - shot.start
      : plannedShotSec(shot);
  return Math.max(1, Math.round(sec));
}

/**
 * Words a brief needs to describe a moment. Plans made before briefs became
 * sentences carry two to five words ("Cận Lan, hơi ngượng"): no description.
 */
const BRIEF_MIN_WORDS = 6;

/** What the viewer sees, or null when the plan has no real description for this shot. */
export function sceneBrief(shot: { brief?: string }): string | null {
  const text = shot.brief?.replace(/\s+/g, " ").trim() ?? "";
  return text.split(" ").filter(Boolean).length >= BRIEF_MIN_WORDS ? text : null;
}

/** The spoken words split into speech and bracketed sounds ("[cười khẽ]"), in order. */
export function spokenParts(text: string): { text: string; sound: boolean }[] {
  return text
    .split(/(\[[^\]]*\])/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => ({ text: part, sound: /^\[[^\]]*\]$/.test(part) }));
}
