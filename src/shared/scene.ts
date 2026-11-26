import type { Route } from "./live-plan";
import { plannedShotSec } from "./live-plan";
import type { Framing, ShotKind } from "./shot-plan";

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

export const sceneMoves = (shot: Pick<SceneShot, "route">) => shot.route === "motion";

export function sceneSeconds(
  shot: {
    text: string;
    hold?: number;
    start?: number;
    end?: number;
  },
  pace: number,
): number {
  const sec =
    shot.start !== undefined && shot.end !== undefined
      ? shot.end - shot.start
      : plannedShotSec(shot, pace);
  return Math.max(1, Math.round(sec));
}

const BRIEF_MIN_WORDS = 6;

export function sceneBrief(shot: { brief?: string }): string | null {
  const text = shot.brief?.replace(/\s+/g, " ").trim() ?? "";
  return text.split(" ").filter(Boolean).length >= BRIEF_MIN_WORDS ? text : null;
}

export function spokenParts(text: string): { text: string; sound: boolean }[] {
  return text
    .split(/(\[[^\]]*\])/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => ({ text: part, sound: /^\[[^\]]*\]$/.test(part) }));
}
