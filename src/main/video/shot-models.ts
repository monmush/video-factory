import type { OutputResolution } from "../../shared/batch-settings";
import { type VideoModelId, videoModel } from "../../shared/video-models";

export interface ShotRequest {
  imageUrl: string;
  audioUrl: string;
  prompt: string;
  resolution: OutputResolution;
}

export interface ShotResult {
  url?: string;
  seconds?: number;
}

interface ShotEndpoint {
  input: (req: ShotRequest) => Record<string, unknown>;
  read: (data: unknown) => ShotResult;
}

type VideoResult = { video?: { url?: string }; duration?: number };

const readVideo = (data: unknown): ShotResult => {
  const d = (data ?? {}) as VideoResult;
  return {
    url: d.video?.url,
    seconds: typeof d.duration === "number" && d.duration > 0 ? d.duration : undefined,
  };
};

const kling: ShotEndpoint = {
  input: (r) => ({
    image_url: r.imageUrl,
    audio_url: r.audioUrl,
    prompt: r.prompt,
    enable_safety_checker: true,
  }),
  read: readVideo,
};

const MINIMAX_SIZE_IN_A_720P_VIDEO = "768P";

const minimax: ShotEndpoint = {
  input: (r) => ({
    image_url: r.imageUrl,
    audio_url: r.audioUrl,
    resolution: r.resolution === "1080p" ? "1080P" : MINIMAX_SIZE_IN_A_720P_VIDEO,
    enable_safety_checker: true,
  }),
  read: readVideo,
};

export const SHOT_ENDPOINTS: Record<VideoModelId, ShotEndpoint> = {
  "kling-avatar-v2-standard": kling,
  "kling-avatar-v2-pro": kling,
  "omnihuman-v2": {
    input: (r) => ({ image_url: r.imageUrl, audio_url: r.audioUrl, prompt: r.prompt }),
    read: readVideo,
  },
  "fabric-1-720p": {
    input: (r) => ({ image_url: r.imageUrl, audio_url: r.audioUrl, resolution: "720p" }),
    read: readVideo,
  },
  "minimax-h3-lipsync": minimax,
};

export const shotEndpoint = (id: string): ShotEndpoint =>
  SHOT_ENDPOINTS[videoModel(id).id as VideoModelId];
