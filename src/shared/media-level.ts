import type { OutputResolution } from "./batch-settings";
import { MOTION_RATE, STILL_RATE } from "./cost/rates";
import type { Rate } from "./live-plan";
import type { SpeechModelId } from "./speech-models";
import {
  DEFAULT_VIDEO_MODEL,
  type VideoModel,
  type VideoModelId,
  videoModel,
} from "./video-models";

export type MediaLevelId = "fastest" | "fast" | "balanced" | "detailed" | "most-detailed" | "high";

export interface MediaLevel {
  id: MediaLevelId;
  label: string;
  preference: string;
  output: OutputResolution;
  motion: boolean;
  sound: boolean;
  speaker: VideoModelId;
  speech: SpeechModelId;
  points: string[];
  offered?: true;
  sameAs?: MediaLevelId;
}

const SPEAKS = "Nhân vật nói khớp môi";
const MOVES = "Cảnh toàn và cận cảnh chuyển động thật: người, lá cây, ánh sáng";
const SOUND = "Có âm thanh nền";
const MOVING_PREFERENCE = "Shots that do not speak really move: people, light and camera.";
const SPEAKER_WITH_CLOSER_LIPS: VideoModelId = "omnihuman-v2";
const FAST_SPEECH: SpeechModelId = "minimax-h3-max";
const BALANCED_SPEECH: SpeechModelId = "wan-3";
const HIGH_SPEECH: SpeechModelId = "veo-3.1-fast";

export const MEDIA_LEVELS: readonly MediaLevel[] = [
  {
    id: "fastest",
    label: "Nhanh nhất",
    preference: "",
    output: "720p",
    motion: false,
    sound: false,
    speaker: DEFAULT_VIDEO_MODEL,
    speech: FAST_SPEECH,
    points: [],
    sameAs: "fast",
  },
  {
    id: "fast",
    label: "Nhanh",
    preference: "Shots that do not speak are still pictures with a slow push-in.",
    output: "720p",
    motion: false,
    sound: false,
    speaker: DEFAULT_VIDEO_MODEL,
    speech: FAST_SPEECH,
    points: [SPEAKS, "Cảnh toàn và cận cảnh: ảnh tĩnh, zoom chậm"],
    offered: true,
  },
  {
    id: "balanced",
    label: "Cân bằng",
    preference: MOVING_PREFERENCE,
    output: "1080p",
    motion: true,
    sound: true,
    speaker: DEFAULT_VIDEO_MODEL,
    speech: BALANCED_SPEECH,
    points: [SPEAKS, MOVES, SOUND],
    offered: true,
  },
  {
    id: "high",
    label: "Cao cấp",
    preference: MOVING_PREFERENCE,
    output: "1080p",
    motion: true,
    sound: true,
    speaker: SPEAKER_WITH_CLOSER_LIPS,
    speech: HIGH_SPEECH,
    points: ["Khẩu hình khớp hơn", MOVES, SOUND],
    offered: true,
  },
  {
    id: "detailed",
    label: "Chi tiết",
    preference: "",
    output: "1080p",
    motion: true,
    sound: true,
    speaker: DEFAULT_VIDEO_MODEL,
    speech: BALANCED_SPEECH,
    points: [],
    sameAs: "balanced",
  },
  {
    id: "most-detailed",
    label: "Chi tiết nhất",
    preference: "",
    output: "1080p",
    motion: true,
    sound: true,
    speaker: DEFAULT_VIDEO_MODEL,
    speech: BALANCED_SPEECH,
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

export const levelSpeaker = (level: MediaLevel) => videoModel(level.speaker);

export const speakRate = (speaker: VideoModel): Rate => ({
  usd: speaker.outputs["720p"].usdPerSec,
  unit: "seconds",
  ...(speaker.minSec ? { minSeconds: speaker.minSec } : {}),
});

export function levelRates(level: MediaLevel): {
  stills: Rate;
  speak: Rate;
  motion: Rate | null;
} {
  return {
    stills: STILL_RATE,
    speak: speakRate(levelSpeaker(level)),
    motion: level.motion ? MOTION_RATE : null,
  };
}
