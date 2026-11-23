import { LIP_SYNC_USD_PER_SEC } from "./cost/rates";

type Output = "720p" | "1080p";

export interface ModelOutput {
  resolution: string;
  usdPerSec: number;
}

export interface VideoModel {
  id: string;
  name: string;
  maker: string;
  endpoint: string;
  outputs: Record<Output, ModelOutput>;
  minSec?: number;
  maxSec?: number;
  takesPrompt: boolean;
  longClip?: { overSec: number; factor: number };
}

const both = (resolution: string, usdPerSec: number): Record<Output, ModelOutput> => ({
  "720p": { resolution, usdPerSec },
  "1080p": { resolution, usdPerSec },
});

export const VIDEO_MODELS = [
  {
    id: "kling-avatar-v2-standard",
    name: "Kling Avatar v2 Standard",
    maker: "Kuaishou",
    endpoint: "fal-ai/kling-video/ai-avatar/v2/standard",
    outputs: both("720p", LIP_SYNC_USD_PER_SEC.klingAvatarStandard),
    takesPrompt: true,
  },
  {
    id: "minimax-h3-lipsync",
    name: "MiniMax H3 Max Lip Sync",
    maker: "MiniMax",
    endpoint: "minimax/h3-max/lip-sync/image-to-video",
    outputs: {
      "720p": { resolution: "768p", usdPerSec: LIP_SYNC_USD_PER_SEC.minimaxLipSync768p },
      "1080p": { resolution: "1080p", usdPerSec: LIP_SYNC_USD_PER_SEC.minimaxLipSync1080p },
    },
    takesPrompt: false,
    minSec: 5,
    maxSec: 900,
    longClip: { overSec: 15, factor: 1.2 },
  },
  {
    id: "omnihuman-v2",
    name: "OmniHuman 2.0",
    maker: "ByteDance",
    endpoint: "bytedance/omnihuman/v2",
    outputs: both("720p", LIP_SYNC_USD_PER_SEC.omnihuman),
    takesPrompt: true,
    minSec: 4,
    maxSec: 300,
  },
  {
    id: "kling-avatar-v2-pro",
    name: "Kling Avatar v2 Pro",
    maker: "Kuaishou",
    endpoint: "fal-ai/kling-video/ai-avatar/v2/pro",
    outputs: both("1080p", LIP_SYNC_USD_PER_SEC.klingAvatarPro),
    takesPrompt: true,
  },
  {
    id: "fabric-1-720p",
    name: "VEED Fabric 1.0",
    maker: "VEED",
    endpoint: "veed/fabric-1.0",
    outputs: both("720p", LIP_SYNC_USD_PER_SEC.fabric720p),
    takesPrompt: false,
  },
] as const satisfies readonly VideoModel[];

export type VideoModelId = (typeof VIDEO_MODELS)[number]["id"];

export const DEFAULT_VIDEO_MODEL: VideoModelId = "kling-avatar-v2-standard";

const LEGACY: Record<string, { id: VideoModelId; resolution: Output }> = {
  "minimax-h3-lipsync-768p": { id: "minimax-h3-lipsync", resolution: "720p" },
  "minimax-h3-lipsync-1080p": { id: "minimax-h3-lipsync", resolution: "1080p" },
};

export const legacyModel = (id?: string | null) => (id ? LEGACY[id] : undefined);

const byId = new Map<string, VideoModel>(VIDEO_MODELS.map((m) => [m.id, m]));

export const videoModel = (id?: string | null): VideoModel =>
  byId.get(legacyModel(id)?.id ?? id ?? "") ?? (byId.get(DEFAULT_VIDEO_MODEL) as VideoModel);

const makes1080p = (id?: string | null): boolean =>
  videoModel(id).outputs["1080p"].resolution === "1080p";

export const fitResolution = <R extends string>(id: string | null | undefined, r: R): R | "720p" =>
  r === "1080p" && !makes1080p(id) ? "720p" : r;

export const modelOutput = (model: VideoModel, output?: string | null): ModelOutput =>
  model.outputs[output === "1080p" ? "1080p" : "720p"];

export function modelForClip(id: string | null | undefined, seconds: number): VideoModel {
  const model = videoModel(id);
  return model.maxSec !== undefined && seconds > model.maxSec ? videoModel() : model;
}

export const billedClipSec = (model: VideoModel, seconds: number) =>
  Math.max(model.minSec ?? 0, seconds);

export function clipUsd(model: VideoModel, seconds: number, output?: string | null): number {
  if (!(seconds > 0)) return 0;
  const billed = billedClipSec(model, seconds);
  const factor = model.longClip && billed > model.longClip.overSec ? model.longClip.factor : 1;
  return billed * modelOutput(model, output).usdPerSec * factor;
}
