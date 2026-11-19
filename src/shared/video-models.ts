type Output = "720p" | "1080p";

export type VideoLevel = "standard" | "high";

export const LEVEL_LABEL: Record<VideoLevel, string> = {
  standard: "Tiêu chuẩn",
  high: "Cao cấp",
};

export interface ModelOutput {
  resolution: string;
  usdPerSec: number;
}

export interface VideoModel {
  id: string;
  level: VideoLevel;
  name: string;
  maker: string;
  endpoint: string;
  outputs: Record<Output, ModelOutput>;
  minSec?: number;
  maxSec?: number;
  takesPrompt: boolean;
  longClip?: { overSec: number; factor: number };
  pick?: boolean;
  blurb: string;
  blurbProvisional?: boolean;
  renderMinPer10s?: number;
  live?: boolean;
  sample?: string;
  poster?: string;
}

const both = (resolution: string, usdPerSec: number): Record<Output, ModelOutput> => ({
  "720p": { resolution, usdPerSec },
  "1080p": { resolution, usdPerSec },
});

export const VIDEO_MODELS = [
  {
    id: "kling-avatar-v2-standard",
    level: "standard",
    name: "Kling Avatar v2 Standard",
    maker: "Kuaishou",
    endpoint: "fal-ai/kling-video/ai-avatar/v2/standard",
    outputs: both("720p", 0.0562),
    takesPrompt: true,
    pick: true,
    blurb: "Đầu và tay cử động tự nhiên, mặt hơi mềm.",
    blurbProvisional: true,
    renderMinPer10s: 4.5,
    live: true,
    sample: "kling-standard.mp4",
    poster: "kling-standard.jpg",
  },
  {
    id: "minimax-h3-lipsync",
    level: "standard",
    name: "MiniMax H3 Max Lip Sync",
    maker: "MiniMax",
    endpoint: "minimax/h3-max/lip-sync/image-to-video",
    outputs: {
      "720p": { resolution: "768p", usdPerSec: 0.08 },
      "1080p": { resolution: "1080p", usdPerSec: 0.16 },
    },
    takesPrompt: false,
    minSec: 5,
    maxSec: 900,
    longClip: { overSec: 15, factor: 1.2 },
    blurb: "Tạo nhanh nhất, mặt kém nét hơn.",
    blurbProvisional: true,
    renderMinPer10s: 1,
    sample: "minimax-h3.mp4",
    poster: "minimax-h3.jpg",
  },
  {
    id: "omnihuman-v2",
    level: "high",
    name: "OmniHuman 2.0",
    maker: "ByteDance",
    endpoint: "bytedance/omnihuman/v2",
    outputs: both("720p", 0.105),
    takesPrompt: true,
    minSec: 4,
    maxSec: 300,
    pick: true,
    blurb: "Khẩu hình khớp hơn, cử chỉ theo giọng nói.",
    blurbProvisional: true,
    renderMinPer10s: 2.9,
    sample: "omnihuman-v2.mp4",
    poster: "omnihuman-v2.jpg",
  },
  {
    id: "kling-avatar-v2-pro",
    level: "high",
    name: "Kling Avatar v2 Pro",
    maker: "Kuaishou",
    endpoint: "fal-ai/kling-video/ai-avatar/v2/pro",
    outputs: both("1080p", 0.115),
    takesPrompt: true,
    blurb: "Bản cao hơn của Tiêu chuẩn, chi tiết mặt nhiều hơn.",
    blurbProvisional: true,
    renderMinPer10s: 5.3,
  },
  {
    id: "fabric-1-720p",
    level: "high",
    name: "VEED Fabric 1.0",
    maker: "VEED",
    endpoint: "veed/fabric-1.0",
    outputs: both("720p", 0.15),
    takesPrompt: false,
    blurb: "Mặt nét, đúng khẩu hình, kiểu người dẫn chuyện.",
    blurbProvisional: true,
    sample: "fabric-1.mp4",
    poster: "fabric-1.jpg",
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

export const modelGroups = (): { level: VideoLevel; label: string; models: VideoModel[] }[] =>
  (Object.keys(LEVEL_LABEL) as VideoLevel[]).map((level) => ({
    level,
    label: LEVEL_LABEL[level],
    models: VIDEO_MODELS.filter((m) => m.level === level).sort(
      (a, b) => Number("pick" in b && b.pick) - Number("pick" in a && a.pick),
    ),
  }));

export const minutesFor45 = (model: VideoModel) =>
  model.renderMinPer10s === undefined ? undefined : Math.max(1, Math.round(model.renderMinPer10s));

export const videoUsd = (
  model: VideoModel,
  totalSec: number,
  lineSecs: readonly number[],
  output?: string | null,
) =>
  (totalSec + lineSecs.reduce((n, s) => n + Math.max(0, (model.minSec ?? 0) - s), 0)) *
  modelOutput(model, output).usdPerSec;
