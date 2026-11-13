import type { OutputResolution } from "../../shared/batch-settings";
import { type VideoModelId, videoModel } from "../../shared/video-models";

// How each speaking-shot model is asked and answered on fal, by registry id
// (src/shared/video-models.ts). Inputs follow each endpoint's public queue
// OpenAPI schema as read on 13 Nov 2026; only Kling Avatar v2 Standard has
// run live. Pure (no Electron), so it is tested beside.

export interface ShotRequest {
  imageUrl: string;
  audioUrl: string;
  /** What the person does; models without a prompt input ignore it. */
  prompt: string;
  /** The video's output size; models with a size choice follow it. */
  resolution: OutputResolution;
}

export interface ShotResult {
  url?: string;
  /** Seconds the provider reports (and bills); absent when it reports none. */
  seconds?: number;
}

interface ShotEndpoint {
  input: (req: ShotRequest) => Record<string, unknown>;
  read: (data: unknown) => ShotResult;
}

type VideoResult = { video?: { url?: string }; duration?: number };

/** `{ video: { url }, duration }`, the shape every candidate answers with. */
const readVideo = (data: unknown): ShotResult => {
  const d = (data ?? {}) as VideoResult;
  return {
    url: d.video?.url,
    seconds: typeof d.duration === "number" && d.duration > 0 ? d.duration : undefined,
  };
};

const kling: ShotEndpoint = {
  // Same input as the successful test (experiments/speaking-shot/fal-avatar.mjs).
  input: (r) => ({
    image_url: r.imageUrl,
    audio_url: r.audioUrl,
    prompt: r.prompt,
    enable_safety_checker: true,
  }),
  read: readVideo,
};

const minimax: ShotEndpoint = {
  // No prompt input. 768P in a 720p video, 1080P in a 1080p one. Transcription
  // (on by default) guides the lips from the words.
  input: (r) => ({
    image_url: r.imageUrl,
    audio_url: r.audioUrl,
    resolution: r.resolution === "1080p" ? "1080P" : "768P",
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
    // No prompt input; resolution is required. No 1080p, never 480p: always 720p.
    input: (r) => ({ image_url: r.imageUrl, audio_url: r.audioUrl, resolution: "720p" }),
    // Answers with the video only: seconds come from the audio sent.
    read: readVideo,
  },
  "minimax-h3-lipsync": minimax,
};

/** By id; ids from before a merge and unknown ids resolve like `videoModel`. */
export const shotEndpoint = (id: string): ShotEndpoint =>
  SHOT_ENDPOINTS[videoModel(id).id as VideoModelId];
