import { seriesBookends } from "./bookends";
import type { Series } from "./ipc";
import { seriesModels } from "./models";

export type SavedSeries = Partial<Series> &
  Pick<Series, "id"> & { videoModel?: unknown; resolution?: unknown; mediaLevel?: unknown };

export function withoutOldSeriesFields(saved: SavedSeries): Series {
  const {
    videoModel: _model,
    resolution: _size,
    mediaLevel: _level,
    models,
    bookends: savedBookends,
    ...series
  } = saved;
  const picked = seriesModels(models);
  const bookends = seriesBookends(savedBookends);
  return {
    ...(series as Series),
    characterIds: series.characterIds ?? [],
    productIds: series.productIds ?? [],
    environmentIds: series.environmentIds ?? [],
    ...(picked ? { models: picked } : {}),
    ...(bookends ? { bookends } : {}),
  };
}
