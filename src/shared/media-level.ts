import type { OutputResolution } from "./batch-settings";
import { DEFAULT_IMAGE_MODEL, MODELS } from "./image-models";
import type { Rate } from "./live-plan";
import { DEFAULT_VIDEO_MODEL, videoModel } from "./video-models";

export type MediaLevelId = "fastest" | "fast" | "balanced" | "detailed" | "most-detailed";

export interface MediaLevel {
  id: MediaLevelId;
  label: string;
  preference: string;
  output: OutputResolution;
  keyframe: { width: number; height: number };
  motion: boolean;
  points: string[];
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

export const OFFERED_LEVELS: readonly MediaLevel[] = MEDIA_LEVELS.filter((l) => l.offered);

export const DEFAULT_MEDIA_LEVEL: MediaLevelId = "balanced";

const byId = (id: string | null | undefined) => MEDIA_LEVELS.find((l) => l.id === id);

export const mediaLevel = (id?: string | null): MediaLevel => {
  const level = byId(id);
  return (byId(level?.sameAs ?? level?.id) ?? byId(DEFAULT_MEDIA_LEVEL)) as MediaLevel;
};

export const MOTION_RATE: Rate = { usd: 0.045, unit: "seconds", minSeconds: 2 };

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

const TYPICAL_VIDEO = { seconds: 45, pictures: 7, speakSec: 38, motionSec: 7 } as const;

export function levelMediaUsd(level: MediaLevel, seconds: number): number {
  const rates = levelRates(level);
  const scale = Math.max(1, seconds) / TYPICAL_VIDEO.seconds;
  return (
    TYPICAL_VIDEO.pictures * scale * (rates.stills.usd ?? 0) +
    TYPICAL_VIDEO.speakSec * scale * (rates.speak.usd ?? 0) +
    (rates.motion ? TYPICAL_VIDEO.motionSec * scale * (rates.motion.usd ?? 0) : 0)
  );
}
