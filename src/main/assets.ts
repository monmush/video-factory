import { randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
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
import { assetDir, imageRefPath } from "./media";
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
  if (!input.name.trim()) throw new Error("Tên không được để trống");
  if (input.images.length > MAX_CHARACTER_IMAGES) {
    throw new Error(`Tối đa ${MAX_CHARACTER_IMAGES} ảnh cho mỗi mục`);
  }
  if (!HANDLE_PATTERN.test(input.handle)) throw new Error("Mã gắn thẻ không hợp lệ");
  if (ws.assets.some((a) => a.handle === input.handle && a.id !== selfId)) {
    throw new Error(`@${input.handle} đã được dùng`);
  }
}

/**
 * Product sets are one level deep: a set contains products, never sets, and a
 * contained product cannot contain others. Checked on the would-be state.
 */
function checkSets(assets: Pick<Asset, "id" | "kind" | "contains">[]) {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const children = new Set<string>();
  for (const parent of assets) {
    for (const childId of parent.contains ?? []) {
      const child = byId.get(childId);
      if (parent.kind !== "product" || child?.kind !== "product") {
        throw new Error("Chỉ sản phẩm mới ghép được thành bộ");
      }
      if (childId === parent.id) throw new Error("Sản phẩm không thể nằm trong chính nó");
      if (child.contains?.length) throw new Error("Một bộ không thể nằm trong bộ khác");
      children.add(childId);
    }
  }
  for (const parent of assets) {
    if (parent.contains?.length && children.has(parent.id)) {
      throw new Error("Một bộ không thể nằm trong bộ khác");
    }
  }
}

const cleanContains = (ids: string[] | undefined) => {
  const unique = [...new Set(ids ?? [])];
  return unique.length ? unique : undefined;
};

/** Saved images by id for one asset. */
const imageFiles = (asset?: Asset) => new Map(asset?.images.map((i) => [i.id, i.file]));

/**
 * Resolves the ordered refs into the asset's image list: staged files are moved
 * into the asset folder, existing images are kept, removed ones are deleted.
 */
async function applyImages(assetId: string, refs: ImageRef[], previous: AssetImage[]) {
  const dir = assetDir(assetId);
  await mkdir(dir, { recursive: true });
  const existing = new Map(previous.map((i) => [i.id, i]));
  const images: AssetImage[] = [];
  for (const ref of refs) {
    if (ref.source === "asset") {
      const kept = existing.get(ref.id);
      if (kept && ref.assetId === assetId) images.push({ ...kept, angle: ref.angle });
      continue;
    }
    const id = randomUUID();
    const file = `${id}${extname(ref.id)}`;
    await rename(imageRefPath(ref), join(dir, file));
    images.push({ id, file, origin: ref.origin ?? "upload", angle: ref.angle });
  }
  const keep = new Set(images.map((i) => i.id));
  for (const old of previous) {
    if (!keep.has(old.id)) await rm(join(dir, old.file), { force: true });
  }
  return images;
}

const now = () => new Date().toISOString();

async function buildAsset(input: AssetInput, id: string = randomUUID()): Promise<Asset> {
  return {
    id,
    kind: input.kind,
    name: input.name.trim(),
    handle: input.handle,
    description: input.description.trim(),
    images: await applyImages(id, input.images, []),
    contains: input.kind === "product" ? cleanContains(input.contains) : undefined,
    createdAt: now(),
    updatedAt: now(),
  };
}

export function createAsset(input: AssetInput): Promise<Asset> {
  return mutate(async (ws) => {
    validate(ws, input);
    const id = randomUUID();
    checkSets([...ws.assets, { id, kind: input.kind, contains: cleanContains(input.contains) }]);
    const asset = await buildAsset(input, id);
    ws.assets.unshift(asset);
    return asset;
  });
}

/** Creates several products at once (batch import); sets refer to items by index. */
export function createProductBatch(items: BatchProductItem[]): Promise<Asset[]> {
  return mutate(async (ws) => {
    if (items.length === 0) return [];
    const handles = new Set<string>();
    for (const { input } of items) {
      if (input.kind !== "product") throw new Error("Chỉ nhập hàng loạt sản phẩm");
      validate(ws, input);
      if (handles.has(input.handle)) throw new Error(`@${input.handle} bị trùng trong danh sách`);
      handles.add(input.handle);
    }
    const ids = items.map(() => randomUUID());
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
  });
}

export function updateAsset(id: string, input: AssetInput): Promise<Asset> {
  return mutate(async (ws) => {
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
    asset.images = await applyImages(id, input.images, asset.images);
    asset.contains = contains;
    asset.updatedAt = now();
    return asset;
  });
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
