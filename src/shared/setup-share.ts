import { z } from "zod";
import { HANDLE_PATTERN } from "./handle";
import { type Asset, type AssetKind, SERIES_ASSET_FIELD, type Series, type Workspace } from "./ipc";
import { NOTE_AREAS, type Note } from "./notes";
import { isSafeSegment } from "./safe-segment";
import { withoutOldSeriesFields } from "./saved-series";
import { type SavedAsset, withVoiceTexts } from "./voices";

export const SHARE_FORMAT = "video-factory-setup";
export const SHARE_VERSION = 1;
export const SHARE_FILE = "share.json";
export const NEWER_SHARE_MESSAGE =
  "Tệp này được tạo bằng phiên bản mới hơn. Hãy cập nhật ứng dụng.";
export const INVALID_SHARE_MESSAGE = "Tệp không hợp lệ.";
const MAX_HANDLE_LENGTH = 40;

export interface ShareFile {
  format: typeof SHARE_FORMAT;
  version: typeof SHARE_VERSION;
  createdAt: string;
  appVersion: string;
  series: Series[];
  assets: Asset[];
  notes: Note[];
}

export function buildShare(ws: Workspace, about: { createdAt: string; appVersion: string }) {
  return {
    format: SHARE_FORMAT,
    version: SHARE_VERSION,
    createdAt: about.createdAt,
    appVersion: about.appVersion,
    series: ws.series.map(({ pinnedAt: _pinned, ...series }) => series),
    assets: ws.assets,
    notes: ws.notes ?? [],
  } satisfies ShareFile;
}

const segment = z.string().refine(isSafeSegment);
const ids = z.array(z.string()).optional();

const imageSchema = z.looseObject({
  id: segment,
  file: segment,
  cutout: z.looseObject({ file: segment }).optional(),
  original: z.looseObject({ file: segment }).optional(),
});

const assetSchema = z.looseObject({
  id: segment,
  kind: z.enum(["character", "product", "environment"]),
  name: z.string(),
  handle: z.string().max(MAX_HANDLE_LENGTH).regex(HANDLE_PATTERN),
  description: z.string(),
  images: z.array(imageSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const seriesSchema = z.looseObject({
  id: segment,
  name: z.string(),
  guidance: z.string(),
  characterIds: ids,
  productIds: ids,
  environmentIds: ids,
  createdAt: z.string(),
  updatedAt: z.string(),
});

const noteSchema = z.looseObject({
  id: segment,
  text: z.string(),
  area: z.enum(NOTE_AREAS),
  at: z.string(),
});

const shareSchema = z.looseObject({
  format: z.literal(SHARE_FORMAT),
  version: z.literal(SHARE_VERSION),
  createdAt: z.string(),
  appVersion: z.string(),
  series: z.array(seriesSchema),
  assets: z.array(assetSchema),
  notes: z.array(noteSchema).optional(),
});

const versionSchema = z.looseObject({ format: z.literal(SHARE_FORMAT), version: z.number() });

export function parseShare(raw: unknown): ShareFile {
  const header = versionSchema.safeParse(raw);
  if (header.success && header.data.version > SHARE_VERSION) throw new Error(NEWER_SHARE_MESSAGE);
  const parsed = shareSchema.safeParse(raw);
  if (!parsed.success) throw new Error(INVALID_SHARE_MESSAGE);
  const share = parsed.data;
  return {
    ...share,
    series: share.series.map((s) => withoutOldSeriesFields(s as Partial<Series> & { id: string })),
    assets: withVoiceTexts(share.assets as SavedAsset[]),
    notes: share.notes ?? [],
  };
}

function freeHandle(handle: string, taken: ReadonlySet<string>): string {
  if (!taken.has(handle)) return handle;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const stem = handle.slice(0, MAX_HANDLE_LENGTH - suffix.length).replace(/-+$/, "");
    const candidate = `${stem}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export interface ShareMerge {
  series: Series[];
  assets: Asset[];
  notes: Note[];
  addedSeriesIds: string[];
  addedAssetIds: string[];
  skipped: number;
}

export function mergeShare(ws: Workspace, share: ShareFile): ShareMerge {
  const knownAssets = new Set(ws.assets.map((a) => a.id));
  const handles = new Set(ws.assets.map((a) => a.handle));
  const newAssets: Asset[] = [];
  for (const asset of share.assets) {
    if (knownAssets.has(asset.id)) continue;
    knownAssets.add(asset.id);
    const handle = freeHandle(asset.handle, handles);
    handles.add(handle);
    newAssets.push({ ...asset, handle });
  }
  const assets = [...ws.assets, ...newAssets];
  const kindOf = new Map(assets.map((a) => [a.id, a.kind]));
  const ofKind = (list: string[], kind: AssetKind) => list.filter((id) => kindOf.get(id) === kind);

  const assetFields = Object.entries(SERIES_ASSET_FIELD) as [AssetKind, keyof Series][];
  const incomingSeries = new Map(share.series.map((s) => [s.id, s]));
  const justAdded = new Set(newAssets.map((a) => a.id));
  const withNewlySharedAssets = (local: Series): Series => {
    const incoming = incomingSeries.get(local.id);
    if (!incoming) return local;
    const linked = { ...local };
    for (const [kind, field] of assetFields) {
      const mine = local[field] as string[];
      const arriving = ofKind(incoming[field] as string[], kind).filter(
        (id) => justAdded.has(id) && !mine.includes(id),
      );
      if (arriving.length) (linked[field] as string[]) = [...mine, ...arriving];
    }
    return linked;
  };

  const knownSeries = new Set(ws.series.map((s) => s.id));
  const newSeries: Series[] = [];
  for (const series of share.series) {
    if (knownSeries.has(series.id)) continue;
    knownSeries.add(series.id);
    const linked = { ...series };
    for (const [kind, field] of assetFields) {
      (linked[field] as string[]) = ofKind(series[field] as string[], kind);
    }
    newSeries.push(linked);
  }

  const notes = [...(ws.notes ?? [])];
  for (const note of share.notes) {
    if (notes.some((n) => n.id === note.id || n.text === note.text)) continue;
    notes.push(note);
  }

  return {
    series: [...ws.series.map(withNewlySharedAssets), ...newSeries],
    assets,
    notes,
    addedSeriesIds: newSeries.map((s) => s.id),
    addedAssetIds: newAssets.map((a) => a.id),
    skipped: share.assets.length - newAssets.length + (share.series.length - newSeries.length),
  };
}
