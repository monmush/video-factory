import { VIDEO_USD_PER_SEC } from "./cost/rates";

export interface VideoRequest {
  prompt: string;
  imageUrl: string;
  seconds: number;
}

export interface SpeechRequest extends VideoRequest {
  voiceUrl: string;
}

export interface VideoModel {
  id: string;
  name: string;
  speechEndpoint: string;
  motionEndpoint: string;
  speechUsdPerSec: number;
  motionUsdPerSec: number;
  minSec: number;
  maxSec: number;
  runsLongerSec?: number;
  speech: (req: SpeechRequest) => Record<string, unknown>;
  motion: (req: VideoRequest) => Record<string, unknown>;
}

const VERTICAL = "9:16";

const wanMotion = (r: VideoRequest) => ({
  prompt: r.prompt,
  start_image_url: r.imageUrl,
  duration: r.seconds,
  resolution: "720p",
  audio: false,
});

const wanSpeech = (r: SpeechRequest) => ({
  prompt: r.prompt,
  reference_image_urls: [r.imageUrl],
  reference_audio_urls: [r.voiceUrl],
  duration: r.seconds,
  resolution: "720p",
  aspect_ratio: VERTICAL,
  audio: true,
});

const minimaxMotion = (r: VideoRequest) => ({
  prompt: r.prompt,
  image_url: r.imageUrl,
  duration: r.seconds,
  resolution: "768P",
  prompt_expansion_mode: "disabled",
});

const minimaxSpeech = (r: SpeechRequest) => ({
  prompt: r.prompt,
  image_url: r.imageUrl,
  reference_image_urls: [r.imageUrl],
  reference_audio_urls: [r.voiceUrl],
  duration: r.seconds,
  resolution: "768P",
  aspect_ratio: VERTICAL,
  prompt_expansion_mode: "disabled",
});

export const VIDEO_MODELS = [
  {
    id: "wan-3",
    name: "Wan 3.0",
    speechEndpoint: "alibaba/wan-3.0/reference-to-video",
    motionEndpoint: "alibaba/wan-3.0/image-to-video",
    speechUsdPerSec: VIDEO_USD_PER_SEC.wan.speech,
    motionUsdPerSec: VIDEO_USD_PER_SEC.wan.motion,
    minSec: 2,
    maxSec: 30,
    speech: wanSpeech,
    motion: wanMotion,
  },
  {
    id: "minimax-h3-max",
    name: "MiniMax H3 Max",
    speechEndpoint: "minimax/h3-max/reference-to-video",
    motionEndpoint: "minimax/h3-max/image-to-video",
    speechUsdPerSec: VIDEO_USD_PER_SEC.minimaxH3.speech,
    motionUsdPerSec: VIDEO_USD_PER_SEC.minimaxH3.motion,
    minSec: 1,
    maxSec: 15,
    runsLongerSec: 0.7,
    speech: minimaxSpeech,
    motion: minimaxMotion,
  },
] as const satisfies readonly VideoModel[];

export type VideoModelId = (typeof VIDEO_MODELS)[number]["id"];

export const AUTO_VIDEO_MODEL: VideoModelId = "wan-3";

const byId = new Map<string, VideoModel>(VIDEO_MODELS.map((m) => [m.id, m]));

export const isVideoModelId = (id: unknown): id is VideoModelId =>
  typeof id === "string" && byId.has(id);

export const videoModel = (id?: string | null): VideoModel =>
  byId.get(id ?? "") ?? (byId.get(AUTO_VIDEO_MODEL) as VideoModel);

export function askedSec(model: VideoModel, wantedSec: number): number | null {
  const whole = Math.max(model.minSec, Math.ceil(Math.max(0, wantedSec) - 1e-9));
  return whole <= model.maxSec ? whole : null;
}

const LONGER_STEP_SEC = 2;

export const longerSpeechSec = (askedSec: number) => askedSec + LONGER_STEP_SEC;

export function speechModelToTry(
  chosen: string,
  rejected: readonly string[],
  wantedSec: number,
): VideoModel | null {
  const order = [...new Set([videoModel(chosen).id, ...VIDEO_MODELS.map((m) => m.id)])];
  return (
    order
      .map((id) => videoModel(id))
      .find((m) => !rejected.includes(m.id) && askedSec(m, wantedSec) !== null) ?? null
  );
}

export const speechUsd = (model: VideoModel, asked: number) => asked * model.speechUsdPerSec;

export const motionSec = (model: VideoModel, shotSec: number) =>
  Math.min(model.maxSec, askedSec(model, shotSec) ?? model.maxSec);

export const motionUsd = (model: VideoModel, shotSec: number) =>
  motionSec(model, shotSec) * model.motionUsdPerSec;

export const SPEECH_MARGIN_SEC = 1;
