import { videoUntouched } from "./edit-in-place";
import type { Asset, Series } from "./ipc";
import type { VideoJob } from "./video-job";

export const NO_PLACE = "Series chưa có bối cảnh";

export const hasPlace = (
  series: Pick<Series, "environmentIds"> | undefined,
  assets: readonly Pick<Asset, "id" | "images">[],
): boolean =>
  Boolean(series?.environmentIds?.some((id) => assets.find((a) => a.id === id)?.images.length));

export const stagedWithoutPlace = (job: VideoJob): boolean =>
  Boolean(job.plan) && !job.useEnvironment && videoUntouched(job);
