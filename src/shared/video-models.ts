// Models that make speaking shots (a still and its audio into a lip-synced
// clip), what each costs and what the "Mô hình AI" picker says about it
// (docs/VIDEO_GENERATION_DECISIONS.md, "Speaking-shot models"). Model names
// and makers are shown to everyone; the middleman we call them through never
// is. Pure, so the board, the Video tab, job costs and tests share one answer.
//
// Prices, ids and limits were read from fal's public model pages and queue
// OpenAPI schemas on 13 Nov 2026; only Kling Avatar v2 Standard has run live.
// How each endpoint's request is built lives in the main process
// (src/main/video/shot-models.ts).

/** The final video's size setting ("Độ phân giải"); see src/shared/batch-settings.ts. */
type Output = "720p" | "1080p";

export type VideoLevel = "standard" | "high";

export const LEVEL_LABEL: Record<VideoLevel, string> = {
  standard: "Tiêu chuẩn",
  high: "Cao cấp",
};

/** What a model produces, and costs, when the video is made at one output size. */
export interface ModelOutput {
  /** The model's own output resolution, as its maker names it. */
  resolution: string;
  usdPerSec: number;
}

export interface VideoModel {
  /** Stable id, saved on series, batches, jobs and shots. */
  id: string;
  level: VideoLevel;
  name: string;
  maker: string;
  /** fal endpoint id (never shown). */
  endpoint: string;
  /** Per output size: what the model is asked for and what it costs. */
  outputs: Record<Output, ModelOutput>;
  /**
   * Shortest audio the model takes: shorter audio is padded with silence to
   * this length (the padding is trimmed in assembly) and billed as this long.
   */
  minSec?: number;
  /** Longest audio the model takes; a longer shot is made with the default model. */
  maxSec?: number;
  /**
   * The endpoint takes a text prompt: only these models hear what the person
   * does and what moves behind them (the ambient motion of the seat).
   */
  takesPrompt: boolean;
  /** Clips longer than `overSec` are billed at `factor` times the rate. */
  longClip?: { overSec: number; factor: number };
  /** The model suggested for its level ("Đề xuất"), and the level's default. */
  pick?: boolean;
  /** One line on what to expect, in the hover card. */
  blurb: string;
  /** The blurb is a draft until Minh has seen the model's output; replace these. */
  blurbProvisional?: boolean;
  /** Reported minutes to render a 10-second clip; absent when unknown. */
  renderMinPer10s?: number;
  /** Has made a real video in this app ("Đã dùng thật"). */
  live?: boolean;
  /** Muted example loop and its poster, files in src/renderer/src/assets/model-samples/. */
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
    // Asked for 768P in a 720p video and 1080P in a 1080p one.
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
    // Reported 0.3 min at 480p; about 1 at our sizes.
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
    // Provisional until Minh has compared the candidates.
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
    // No 1080p: always asked for 720p.
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

/**
 * Ids saved before MiniMax became one entry (13 Nov), with the output size
 * each one implied. Settings and jobs saved with them are read as the merged
 * model at that size (`legacyModel`).
 */
const LEGACY: Record<string, { id: VideoModelId; resolution: Output }> = {
  "minimax-h3-lipsync-768p": { id: "minimax-h3-lipsync", resolution: "720p" },
  "minimax-h3-lipsync-1080p": { id: "minimax-h3-lipsync", resolution: "1080p" },
};

/** A saved id from before a merge: the entry it now is, and the output size it implied. */
export const legacyModel = (id?: string | null) => (id ? LEGACY[id] : undefined);

const byId = new Map<string, VideoModel>(VIDEO_MODELS.map((m) => [m.id, m]));

/** The model with this id; missing (saved before models could be chosen) or unknown ids read as the default. */
export const videoModel = (id?: string | null): VideoModel =>
  byId.get(legacyModel(id)?.id ?? id ?? "") ?? (byId.get(DEFAULT_VIDEO_MODEL) as VideoModel);

/** The model can make 1080p clips; otherwise a 1080p video would only enlarge them. */
export const makes1080p = (id?: string | null): boolean =>
  videoModel(id).outputs["1080p"].resolution === "1080p";

/** The output size a video with this model is made at: 1080p only when the model makes it. */
export const fitResolution = <R extends string>(id: string | null | undefined, r: R): R | "720p" =>
  r === "1080p" && !makes1080p(id) ? "720p" : r;

/** What a model makes and costs in a video of this output size (720p when absent). */
export const modelOutput = (model: VideoModel, output?: string | null): ModelOutput =>
  model.outputs[output === "1080p" ? "1080p" : "720p"];

/** The model that makes a clip this long: the chosen one, or the default when the clip is too long for it. */
export function modelForClip(id: string | null | undefined, seconds: number): VideoModel {
  const model = videoModel(id);
  return model.maxSec !== undefined && seconds > model.maxSec ? videoModel() : model;
}

/** Seconds billed for a clip of `seconds`: never under the model's minimum. */
export const billedClipSec = (model: VideoModel, seconds: number) =>
  Math.max(model.minSec ?? 0, seconds);

/** What one clip costs in a video of this output size. Nothing made (0 seconds) costs nothing. */
export function clipUsd(model: VideoModel, seconds: number, output?: string | null): number {
  if (!(seconds > 0)) return 0;
  const billed = billedClipSec(model, seconds);
  const factor = model.longClip && billed > model.longClip.overSec ? model.longClip.factor : 1;
  return billed * modelOutput(model, output).usdPerSec * factor;
}

/** The suggested model of each level. */
export const levelPick = (level: VideoLevel): VideoModel =>
  VIDEO_MODELS.find((m) => m.level === level && "pick" in m && m.pick) ?? videoModel();

/** The picker's groups: each level with its models, the suggested one first. */
export const modelGroups = (): { level: VideoLevel; label: string; models: VideoModel[] }[] =>
  (Object.keys(LEVEL_LABEL) as VideoLevel[]).map((level) => ({
    level,
    label: LEVEL_LABEL[level],
    models: VIDEO_MODELS.filter((m) => m.level === level).sort(
      (a, b) => Number("pick" in b && b.pick) - Number("pick" in a && a.pick),
    ),
  }));

/**
 * Approximate minutes to make the speaking shots of a 45-second video: every
 * shot is sent at once, so about one render of a clip of up to ten seconds.
 * fal's queue can add to it when the account's limit is lower than the shot
 * count. Undefined when the render time is unknown.
 */
export const minutesFor45 = (model: VideoModel) =>
  model.renderMinPer10s === undefined ? undefined : Math.max(1, Math.round(model.renderMinPer10s));

/**
 * Picture of a video before it is planned: every second of it at the
 * model's rate (as the estimates always have), plus what the model's minimum
 * adds to lines shorter than it (each line is about one clip).
 */
export const videoUsd = (
  model: VideoModel,
  totalSec: number,
  lineSecs: readonly number[],
  output?: string | null,
) =>
  (totalSec + lineSecs.reduce((n, s) => n + Math.max(0, (model.minSec ?? 0) - s), 0)) *
  modelOutput(model, output).usdPerSec;
