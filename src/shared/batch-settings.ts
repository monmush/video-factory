import type { Series, Session } from "./ipc";
import { type MediaLevelId, mediaLevel } from "./media-level";
import { legacyModel } from "./video-models";

// Output settings of a batch (a session). Each is optional on the session;
// missing means the series' value, else the default. A job resolves them
// once, when it is created, and keeps them: changing a setting affects only
// videos created afterwards. Aspect ratio, subtitles and the like join
// `SessionSettings` later.

export type SessionSettingKey = keyof NonNullable<Session["settings"]>;

/** Output size of the final video (9:16). */
export const RESOLUTIONS = {
  "720p": { width: 720, height: 1280 },
  "1080p": { width: 1080, height: 1920 },
} as const;

export type OutputResolution = keyof typeof RESOLUTIONS;

const DEFAULT_RESOLUTION: OutputResolution = "720p";

const isResolution = (r: unknown): r is OutputResolution =>
  typeof r === "string" && r in RESOLUTIONS;

/** A saved resolution, or 720p when missing (jobs saved before) or unknown. */
export const outputResolution = (r?: string | null): OutputResolution =>
  isResolution(r) ? r : DEFAULT_RESOLUTION;

/** Width and height of a job's final video and every clip in it. */
export const outputSize = (r?: string | null): { width: number; height: number } =>
  RESOLUTIONS[outputResolution(r)];

/** Experiment branch: the resolved Media level, and whether it comes from the series (or the default). */
export function batchMediaLevel(
  session: Pick<Session, "settings"> | undefined,
  series: Pick<Series, "mediaLevel"> | undefined,
): { id: MediaLevelId; inherited: boolean } {
  const own = session?.settings?.mediaLevel;
  if (own) return { id: mediaLevel(own).id, inherited: false };
  return { id: mediaLevel(series?.mediaLevel).id, inherited: true };
}

/**
 * Settings saved with a model id from before MiniMax became one entry: the
 * merged model, and the output size that id implied unless one is set.
 */
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
