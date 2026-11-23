import type { OutputResolution } from "./batch-settings";
import { type VideoModelId, videoModel } from "./video-models";

export interface SpeakRequest {
  imageUrl: string;
  audioUrl: string;
  prompt: string;
  resolution: OutputResolution;
}

type SpeakInput = (req: SpeakRequest) => Record<string, unknown>;

const kling: SpeakInput = (r) => ({
  image_url: r.imageUrl,
  audio_url: r.audioUrl,
  prompt: r.prompt,
  enable_safety_checker: true,
});

const MINIMAX_SIZE_IN_A_720P_VIDEO = "768P";

const SPEAK_INPUTS: Record<VideoModelId, SpeakInput> = {
  "kling-avatar-v2-standard": kling,
  "kling-avatar-v2-pro": kling,
  "omnihuman-v2": (r) => ({ image_url: r.imageUrl, audio_url: r.audioUrl, prompt: r.prompt }),
  "fabric-1-720p": (r) => ({ image_url: r.imageUrl, audio_url: r.audioUrl, resolution: "720p" }),
  "minimax-h3-lipsync": (r) => ({
    image_url: r.imageUrl,
    audio_url: r.audioUrl,
    resolution: r.resolution === "1080p" ? "1080P" : MINIMAX_SIZE_IN_A_720P_VIDEO,
    enable_safety_checker: true,
  }),
};

export const speakInput = (id: string, req: SpeakRequest): Record<string, unknown> =>
  SPEAK_INPUTS[videoModel(id).id as VideoModelId](req);
