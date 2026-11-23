import { type SpeakRequest, speakInput } from "../../shared/speak-request";
import { VIDEO_MODELS, type VideoModelId, videoModel } from "../../shared/video-models";

export type ShotRequest = SpeakRequest;

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

export const SHOT_ENDPOINTS = Object.fromEntries(
  VIDEO_MODELS.map((m) => [
    m.id,
    { input: (r: ShotRequest) => speakInput(m.id, r), read: readVideo },
  ]),
) as Record<VideoModelId, ShotEndpoint>;

export const shotEndpoint = (id: string): ShotEndpoint =>
  SHOT_ENDPOINTS[videoModel(id).id as VideoModelId];
