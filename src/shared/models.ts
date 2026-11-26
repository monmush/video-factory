import { DEFAULT_IMAGE_MODEL, isImageModelId, MODELS } from "./image-models";
import type { AngleModel } from "./ipc";
import { AUTO_VIDEO_MODEL, isVideoModelId, VIDEO_MODELS, type VideoModelId } from "./video-models";

export type ImageModelId = AngleModel;

export interface SeriesModels {
  image?: ImageModelId;
  video?: VideoModelId;
}

export interface JobModels {
  image: ImageModelId;
  video: VideoModelId;
}

export type ModelKind = keyof JobModels;

export const AUTO_MODELS: JobModels = { image: DEFAULT_IMAGE_MODEL, video: AUTO_VIDEO_MODEL };

export interface ModelChoice {
  id: string;
  name: string;
}

export const MODEL_KINDS: readonly { kind: ModelKind; label: string; models: ModelChoice[] }[] = [
  {
    kind: "image",
    label: "Hình ảnh",
    models: Object.entries(MODELS).map(([id, m]) => ({ id, name: m.name })),
  },
  {
    kind: "video",
    label: "Video",
    models: VIDEO_MODELS.map((m) => ({ id: m.id, name: m.name })),
  },
];

const isModel = (kind: ModelKind, id: unknown) =>
  kind === "image" ? isImageModelId(id) : isVideoModelId(id);

export function seriesModels(raw: unknown): SeriesModels | undefined {
  const given = (raw ?? {}) as Record<string, unknown>;
  const picked: SeriesModels = {
    ...(isImageModelId(given.image) ? { image: given.image } : {}),
    ...(isVideoModelId(given.video) ? { video: given.video } : {}),
  };
  return Object.keys(picked).length ? picked : undefined;
}

export const resolvedModels = (picked?: SeriesModels): JobModels => ({
  image: picked?.image ?? AUTO_MODELS.image,
  video: picked?.video ?? AUTO_MODELS.video,
});

export const modelName = (kind: ModelKind, id: string): string =>
  MODEL_KINDS.find((k) => k.kind === kind)?.models.find((m) => m.id === id)?.name ?? id;

export const AUTO_LABEL = "Tự động";

export function pickedLabel(picked?: SeriesModels): string {
  const names = (["video", "image"] as const).flatMap((kind) => {
    const id = picked?.[kind];
    return id && isModel(kind, id) ? [modelName(kind, id)] : [];
  });
  return names.length ? names.join(" · ") : AUTO_LABEL;
}

export const modelsLabel = (models: JobModels): string =>
  `${modelName("video", models.video)} · ${modelName("image", models.image)}`;

export function withModel(picked: SeriesModels | undefined, kind: ModelKind, id: string | null) {
  const { [kind]: _, ...rest } = picked ?? {};
  return seriesModels(id && isModel(kind, id) ? { ...rest, [kind]: id } : rest) ?? {};
}
