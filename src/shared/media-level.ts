import type { OutputResolution } from "./batch-settings";
import { DEFAULT_IMAGE_MODEL, MODELS } from "./image-models";
import type { Rate } from "./live-plan";
import { DEFAULT_VIDEO_MODEL, videoModel } from "./video-models";

// "Chất lượng" (the Media level): the operator picks a quality/price level,
// never a model. Two are offered, "Nhanh" and "Cân bằng"; they differ in one
// thing only, whether wide and detail scenes really move (src/shared/recipe.ts,
// builtinRecipe). Three older ids stay readable so saved series, batches and
// videos still load; each reads as the offered level that makes the same video.

export type MediaLevelId = "fastest" | "fast" | "balanced" | "detailed" | "most-detailed";

export interface MediaLevel {
  id: MediaLevelId;
  label: string;
  /** What the director is told to favour (English, for the prompt). */
  preference: string;
  /** Size of the final video. */
  output: OutputResolution;
  /** Target keyframe size (9:16), or the model's nearest. */
  keyframe: { width: number; height: number };
  /** Wide and detail scenes are made by a motion model; otherwise a still with a slow zoom. */
  motion: boolean;
  /** What the level buys, for the operator (Vietnamese, no model or provider names). */
  points: string[];
  /** Offered in the menus. A level not offered reads as `sameAs`. */
  offered?: true;
  sameAs?: MediaLevelId;
}

const SPEAKS = "Nhân vật nói khớp môi";

export const MEDIA_LEVELS: readonly MediaLevel[] = [
  {
    id: "fastest",
    label: "Nhanh nhất",
    preference: "",
    output: "720p",
    keyframe: { width: 720, height: 1280 },
    motion: false,
    points: [],
    sameAs: "fast",
  },
  {
    id: "fast",
    label: "Nhanh",
    preference: "Shots that do not speak are still pictures with a slow push-in.",
    output: "720p",
    keyframe: { width: 864, height: 1536 },
    motion: false,
    points: [SPEAKS, "Cảnh toàn và cận cảnh: ảnh tĩnh, zoom chậm"],
    offered: true,
  },
  {
    id: "balanced",
    label: "Cân bằng",
    preference: "Shots that do not speak really move: people, light and camera.",
    output: "1080p",
    keyframe: { width: 1116, height: 2000 },
    motion: true,
    points: [SPEAKS, "Cảnh toàn và cận cảnh chuyển động thật: người, lá cây, ánh sáng"],
    offered: true,
  },
  {
    id: "detailed",
    label: "Chi tiết",
    preference: "",
    output: "1080p",
    keyframe: { width: 1116, height: 2000 },
    motion: true,
    points: [],
    sameAs: "balanced",
  },
  {
    id: "most-detailed",
    label: "Chi tiết nhất",
    preference: "",
    output: "1080p",
    keyframe: { width: 1440, height: 2560 },
    motion: true,
    points: [],
    sameAs: "balanced",
  },
];

/** The levels the menus offer, cheapest first. */
export const OFFERED_LEVELS: readonly MediaLevel[] = MEDIA_LEVELS.filter((l) => l.offered);

export const DEFAULT_MEDIA_LEVEL: MediaLevelId = "balanced";

const byId = (id: string | null | undefined) => MEDIA_LEVELS.find((l) => l.id === id);

/**
 * The offered level for this id: a level no longer offered reads as the one
 * that makes the same video; missing or unknown ids read as the default.
 */
export const mediaLevel = (id?: string | null): MediaLevel => {
  const level = byId(id);
  return (byId(level?.sameAs ?? level?.id) ?? byId(DEFAULT_MEDIA_LEVEL)) as MediaLevel;
};

// ---------------------------------------------------------------------------
// What a level costs. The same rates as the built-in recipe (recipe.ts uses
// these), so the menu, the batch button and the plan's cost table agree.
// ---------------------------------------------------------------------------

/** The motion model's rate for wide and detail shots ($0.045 a second, 2 s at least; read 16 Nov). */
export const MOTION_RATE: Rate = { usd: 0.045, unit: "seconds", minSeconds: 2 };

/** Rates for each paid role at this level; no motion rate when the level has no motion. */
export function levelRates(level: MediaLevel): {
  stills: Rate;
  speak: Rate;
  motion: Rate | null;
} {
  const speak = videoModel(DEFAULT_VIDEO_MODEL);
  return {
    stills: { usd: MODELS[DEFAULT_IMAGE_MODEL].fallbackUsd, unit: "images" },
    speak: {
      usd: speak.outputs["720p"].usdPerSec,
      unit: "seconds",
      ...(speak.minSec ? { minSeconds: speak.minSec } : {}),
    },
    motion: level.motion ? MOTION_RATE : null,
  };
}

/**
 * A typical 45-second video, from the plans made on 16–17 Nov: about seven
 * generated pictures, ~38 s of speaking scenes and ~7 s of wide and detail
 * scenes (paid motion on "Cân bằng", a free still with a zoom on "Nhanh").
 */
const TYPICAL_VIDEO = { seconds: 45, pictures: 7, speakSec: 38, motionSec: 7 } as const;

/**
 * Pictures, speaking scenes and motion for a typical video of `seconds` at
 * this level (the voice excluded: it depends on the words), scaled from
 * TYPICAL_VIDEO.
 */
export function levelMediaUsd(level: MediaLevel, seconds: number): number {
  const rates = levelRates(level);
  const scale = Math.max(1, seconds) / TYPICAL_VIDEO.seconds;
  return (
    TYPICAL_VIDEO.pictures * scale * (rates.stills.usd ?? 0) +
    TYPICAL_VIDEO.speakSec * scale * (rates.speak.usd ?? 0) +
    (rates.motion ? TYPICAL_VIDEO.motionSec * scale * (rates.motion.usd ?? 0) : 0)
  );
}
