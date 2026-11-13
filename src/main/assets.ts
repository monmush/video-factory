import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { HANDLE_PATTERN } from "../shared/handle";
import {
  type Asset,
  type AssetImage,
  type AssetInput,
  type BatchProductItem,
  type ImageRef,
  MAX_CHARACTER_IMAGES,
  type Workspace,
} from "../shared/ipc";
import { voiceById } from "../shared/voices";
import { assetDir, imageRefPath } from "./media";
import { carryOverCheck } from "./place-check";
import { checkSets } from "./product-sets";
import { mutate } from "./store";

function validate(ws: Workspace, input: AssetInput, selfId?: string) {
  if (!["character", "product", "environment"].includes(input.kind)) {
    throw new Error(`Unknown asset kind: ${input.kind}`);
  }
  // Brand fidelity: product references must be original photos, never AI renders.
  if (
    input.kind === "product" &&
    input.images.some((i) => i.source === "staged" && i.origin === "ai")
  ) {
    throw new Error("Sản phẩm chỉ dùng ảnh gốc, không dùng ảnh AI");
  }
  // Cleaned photos are for places only (src/main/place-check.ts).
  if (
    input.kind !== "environment" &&
    input.images.some((i) => (i.source === "staged" ? i.cleanOf : i.restore))
  ) {
    throw new Error("Chỉ bối cảnh mới có ảnh làm sạch");
  }
  if (!input.name.trim()) throw new Error("Tên không được để trống");
  if (input.images.length > MAX_CHARACTER_IMAGES) {
    throw new Error(`Tối đa ${MAX_CHARACTER_IMAGES} ảnh cho mỗi mục`);
  }
  if (!HANDLE_PATTERN.test(input.handle)) throw new Error("Mã gắn thẻ không hợp lệ");
  if (ws.assets.some((a) => a.handle === input.handle && a.id !== selfId)) {
    throw new Error(`@${input.handle} đã được dùng`);
  }
}

const cleanContains = (ids: string[] | undefined) => {
  const unique = [...new Set(ids ?? [])];
  return unique.length ? unique : undefined;
};

/** A known catalogue id for characters; anything else is "no voice". */
const cleanVoice = (kind: AssetInput["kind"], id: string | undefined) =>
  kind === "character" ? voiceById(id)?.id : undefined;

/** Saved images by id for one asset. */
const imageFiles = (asset?: Asset) => new Map(asset?.images.map((i) => [i.id, i.file]));

/** Every file an image keeps in the asset folder. */
const filesOf = (image: AssetImage) => [
  image.file,
  ...(image.cutout ? [image.cutout.file] : []),
  ...(image.original ? [image.original.file] : []),
];

/**
 * Resolves the ordered refs into the asset's image list: staged files are
 * copied into the asset folder (the staged copy stays until the next start,
 * so a failed save can be retried), existing images are kept. A cleaned place
 * photo replaces its original, which stays on disk as `original`; a restore
 * swaps it back. Returns the files no image uses any more; delete them only
 * once the workspace is saved.
 */
async function applyImages(assetId: string, refs: ImageRef[], previous: AssetImage[]) {
  const dir = assetDir(assetId);
  await mkdir(dir, { recursive: true });
  const existing = new Map(previous.map((i) => [i.id, i]));
  /** Copies a staged file in; a place photo's check comes with it. */
  const copyIn = async (stagedId: string) => {
    const file = `${randomUUID()}${extname(stagedId)}`;
    const from = imageRefPath({ source: "staged", id: stagedId });
    await copyFile(from, join(dir, file));
    return { file, placeCheck: carryOverCheck(from, join(dir, file)) };
  };
  const images: AssetImage[] = [];
  for (const ref of refs) {
    if (ref.source === "asset") {
      const kept = existing.get(ref.id);
      if (!kept || ref.assetId !== assetId) continue;
      if (ref.restore && kept.original) {
        const { original, ...rest } = kept;
        images.push({
          ...rest,
          file: original.file,
          origin: original.origin,
          placeCheck: original.placeCheck,
          angle: ref.angle,
        });
      } else {
        images.push({ ...kept, angle: ref.angle });
      }
      continue;
    }
    const copied = await copyIn(ref.id);
    const image: AssetImage = {
      id: randomUUID(),
      file: copied.file,
      origin: ref.origin ?? "upload",
      angle: ref.angle,
      placeCheck: copied.placeCheck,
    };
    const source = ref.cleanOf;
    if (source?.source === "asset" && source.assetId === assetId) {
      // Cleaning a cleaned photo keeps the first original.
      const replaced = existing.get(source.id);
      if (replaced) {
        image.original = replaced.original ?? {
          file: replaced.file,
          origin: replaced.origin,
          placeCheck: replaced.placeCheck,
        };
      }
    } else if (source?.source === "staged") {
      const original = await copyIn(source.id);
      image.original = {
        file: original.file,
        origin: source.origin ?? "upload",
        placeCheck: original.placeCheck,
      };
    }
    images.push(image);
  }
  // A removed photo takes its kept cut-out (src/main/video/product-shot.ts)
  // and its original with it.
  const inUse = new Set(images.flatMap(filesOf));
  const removed = previous
    .flatMap(filesOf)
    .filter((file) => !inUse.has(file))
    .map((file) => join(dir, file));
  return { images, removed };
}

/** Runs a save that creates asset folders; the folders go again if it fails. */
async function withNewFolders<T>(ids: string[], save: () => Promise<T>): Promise<T> {
  try {
    return await save();
  } catch (error) {
    await Promise.all(ids.map((id) => rm(assetDir(id), { recursive: true, force: true })));
    throw error;
  }
}

const now = () => new Date().toISOString();

async function buildAsset(input: AssetInput, id: string = randomUUID()): Promise<Asset> {
  return {
    id,
    kind: input.kind,
    name: input.name.trim(),
    handle: input.handle,
    description: input.description.trim(),
    images: (await applyImages(id, input.images, [])).images,
    contains: input.kind === "product" ? cleanContains(input.contains) : undefined,
    voiceId: cleanVoice(input.kind, input.voiceId),
    createdAt: now(),
    updatedAt: now(),
  };
}

export function createAsset(input: AssetInput): Promise<Asset> {
  const id = randomUUID();
  return withNewFolders([id], () =>
    mutate(async (ws) => {
      validate(ws, input);
      checkSets([...ws.assets, { id, kind: input.kind, contains: cleanContains(input.contains) }]);
      const asset = await buildAsset(input, id);
      ws.assets.unshift(asset);
      return asset;
    }),
  );
}

/** Creates several products at once (batch import); sets refer to items by index. */
export function createProductBatch(items: BatchProductItem[]): Promise<Asset[]> {
  const ids = items.map(() => randomUUID());
  return withNewFolders(ids, () =>
    mutate(async (ws) => {
      if (items.length === 0) return [];
      const handles = new Set<string>();
      for (const { input } of items) {
        if (input.kind !== "product") throw new Error("Chỉ nhập hàng loạt sản phẩm");
        validate(ws, input);
        if (handles.has(input.handle)) throw new Error(`@${input.handle} bị trùng trong danh sách`);
        handles.add(input.handle);
      }
      const contains = items.map((item) =>
        cleanContains(
          item.containsIndexes.map((i) => {
            const id = ids[i];
            if (!id) throw new Error("Bộ sản phẩm không hợp lệ");
            return id;
          }),
        ),
      );
      checkSets([
        ...ws.assets,
        ...ids.map((id, i) => ({ id, kind: "product" as const, contains: contains[i] })),
      ]);
      const created: Asset[] = [];
      for (const [i, item] of items.entries()) {
        created.push(await buildAsset({ ...item.input, contains: contains[i] }, ids[i] as string));
      }
      ws.assets.unshift(...created);
      return created;
    }),
  );
}

export async function updateAsset(id: string, input: AssetInput): Promise<Asset> {
  let removed: string[] = [];
  const saved = await mutate(async (ws) => {
    const asset = ws.assets.find((a) => a.id === id);
    if (!asset) throw new Error(`Asset not found: ${id}`);
    validate(ws, input, id);
    // Omitted contains keeps the current set (the edit dialog does not send it).
    const contains =
      input.contains === undefined || asset.kind !== "product"
        ? asset.contains
        : cleanContains(input.contains);
    checkSets(ws.assets.map((a) => (a.id === id ? { ...a, contains } : a)));
    asset.name = input.name.trim();
    asset.handle = input.handle;
    asset.description = input.description.trim();
    const applied = await applyImages(id, input.images, asset.images);
    asset.images = applied.images;
    removed = applied.removed;
    asset.contains = contains;
    if (input.voiceId !== undefined) asset.voiceId = cleanVoice(asset.kind, input.voiceId);
    asset.updatedAt = now();
    return asset;
  });
  // Only now that the workspace no longer points at them.
  await Promise.all(removed.map((file) => rm(file, { force: true })));
  return saved;
}

export function deleteAsset(id: string): Promise<null> {
  return mutate(async (ws) => {
    ws.assets = ws.assets.filter((a) => a.id !== id);
    for (const series of ws.series) {
      series.characterIds = series.characterIds.filter((c) => c !== id);
      series.productIds = series.productIds.filter((c) => c !== id);
      series.environmentIds = series.environmentIds.filter((c) => c !== id);
    }
    // A deleted product leaves any set it was in.
    for (const asset of ws.assets) {
      if (asset.contains?.includes(id)) {
        asset.contains = cleanContains(asset.contains.filter((c) => c !== id));
      }
    }
    await rm(assetDir(id), { recursive: true, force: true });
    return null;
  });
}

/** Absolute paths for refs, looking up saved images in the workspace. */
export function refPaths(ws: Workspace, refs: ImageRef[]): string[] {
  return refs.map((ref) =>
    imageRefPath(
      ref,
      ref.source === "asset" ? imageFiles(ws.assets.find((a) => a.id === ref.assetId)) : undefined,
    ),
  );
}
