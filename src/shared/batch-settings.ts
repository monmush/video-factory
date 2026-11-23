import type { Series, Session, SessionSettings } from "./ipc";
import { type MediaLevelId, mediaLevel } from "./media-level";
import { legacyModel } from "./video-models";

export type SessionSettingKey = keyof NonNullable<Session["settings"]>;

export const RESOLUTIONS = {
  "720p": { width: 720, height: 1280 },
  "1080p": { width: 1080, height: 1920 },
} as const;

export type OutputResolution = keyof typeof RESOLUTIONS;

const DEFAULT_RESOLUTION: OutputResolution = "720p";

const isResolution = (r: unknown): r is OutputResolution =>
  typeof r === "string" && r in RESOLUTIONS;

export const outputResolution = (r?: string | null): OutputResolution =>
  isResolution(r) ? r : DEFAULT_RESOLUTION;

export const outputSize = (r?: string | null): { width: number; height: number } =>
  RESOLUTIONS[outputResolution(r)];

export function batchMediaLevel(
  session: Pick<Session, "settings"> | undefined,
  series: Pick<Series, "mediaLevel"> | undefined,
): { id: MediaLevelId; inherited: boolean } {
  const own = session?.settings?.mediaLevel;
  if (own) return { id: mediaLevel(own).id, inherited: false };
  return { id: mediaLevel(series?.mediaLevel).id, inherited: true };
}

export function videoLevel(
  session: Pick<Session, "settings"> | undefined,
  series: Pick<Series, "mediaLevel"> | undefined,
  scriptId: string,
): MediaLevelId {
  const own = session?.settings?.videoLevels?.[scriptId];
  return own ? mediaLevel(own).id : batchMediaLevel(session, series).id;
}

export function withBatchLevel(settings: SessionSettings, level: string | null): SessionSettings {
  const { mediaLevel: _, videoLevels: __, ...rest } = settings;
  return level ? { ...rest, mediaLevel: mediaLevel(level).id } : rest;
}

export function withVideoLevel(
  session: Pick<Session, "settings">,
  series: Pick<Series, "mediaLevel"> | undefined,
  scriptId: string,
  level: string,
): SessionSettings {
  const { videoLevels, ...rest } = session.settings ?? {};
  const levels = { ...videoLevels };
  const own = mediaLevel(level).id;
  if (own === batchMediaLevel(session, series).id) delete levels[scriptId];
  else levels[scriptId] = own;
  return Object.keys(levels).length ? { ...rest, videoLevels: levels } : rest;
}

export function migrateSettings<T extends { videoModel?: string; resolution?: string }>(
  settings: T,
): T {
  const legacy = legacyModel(settings.videoModel);
  if (!legacy) return settings;
  return {
    ...settings,
    videoModel: legacy.id,
    resolution: settings.resolution ?? legacy.resolution,
  };
}
