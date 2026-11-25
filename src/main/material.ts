import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { BrowserWindow } from "electron";
import { type Asset, MAX_CHARACTER_IMAGES, type Workspace } from "../shared/ipc";
import {
  type ClipDraft,
  finishedVideo,
  type MaterialDraft,
  type MaterialItem,
  materialOfVideo,
  type PictureDraft,
  type SeriesMaterial,
  sceneIdOfVideo,
  usedBy,
} from "../shared/material";
import type { Picture, ShotList } from "../shared/shot-list";
import type { VideoJob } from "../shared/video-job";
import { chosenVersion, chosenView } from "../shared/video-takes";
import { updateAsset } from "./assets";
import { stageImages } from "./media";
import { materialDir, writeJsonAtomic } from "./paths";
import { childPath } from "./safe-path";
import { getWorkspace } from "./store";

const INDEX_FILE = "material.json";
const SHOT_LIST_FILE = "shot-list.json";
const FULL_CHARACTER = "Nhân vật đã đủ ảnh. Xóa bớt một ảnh trong Thư viện trước.";

const indexPath = (seriesId: string) => join(materialDir(seriesId), INDEX_FILE);
const itemPath = (seriesId: string, item: Pick<MaterialItem, "file">) =>
  childPath(materialDir(seriesId), item.file);

async function readMaterial(seriesId: string): Promise<SeriesMaterial> {
  try {
    return JSON.parse(await readFile(indexPath(seriesId), "utf8")) as SeriesMaterial;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, items: [] };
    throw error;
  }
}

const queues = new Map<string, Promise<unknown>>();

function inSeriesOrder<T>(seriesId: string, work: () => Promise<T>): Promise<T> {
  const run = (queues.get(seriesId) ?? Promise.resolve()).then(work);
  queues.set(
    seriesId,
    run.catch(() => undefined),
  );
  return run;
}

type MaterialListener = (seriesId: string) => void;
const listeners = new Set<MaterialListener>();

export function onMaterialChanged(listener: MaterialListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce(seriesId: string) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("material:changed", { seriesId });
  }
  for (const listener of listeners) listener(seriesId);
}

interface Edit {
  material: SeriesMaterial;
  dropFiles: (items: readonly MaterialItem[]) => void;
}

function editMaterial<T>(seriesId: string, change: (edit: Edit) => Promise<T> | T): Promise<T> {
  return inSeriesOrder(seriesId, async () => {
    const material = await readMaterial(seriesId);
    const before = JSON.stringify(material);
    const dropped: MaterialItem[] = [];
    const result = await change({ material, dropFiles: (items) => dropped.push(...items) });
    if (JSON.stringify(material) !== before) {
      await writeJsonAtomic(indexPath(seriesId), material);
      announce(seriesId);
    }
    await Promise.all(dropped.map((item) => rm(itemPath(seriesId, item), { force: true })));
    return result;
  });
}

const withClipsOf = (items: readonly MaterialItem[], gone: readonly MaterialItem[]) => {
  const pictures = new Set(gone.filter((i) => i.kind === "picture").map((i) => i.id));
  return items.filter((i) => gone.includes(i) || (i.pictureId && pictures.has(i.pictureId)));
};

function removeItems(edit: Edit, gone: readonly MaterialItem[]) {
  const removed = withClipsOf(edit.material.items, gone);
  edit.material.items = edit.material.items.filter((i) => !removed.includes(i));
  edit.dropFiles(removed);
}

const cloneFile = (from: string, to: string) => copyFile(from, to, constants.COPYFILE_FICLONE);

const freeIdFor = (material: SeriesMaterial, draft: MaterialDraft) => {
  const key = draft.kind === "picture" ? draft.key : undefined;
  return key && !material.items.some((i) => i.id === key) ? key : randomUUID();
};

const derivedFields = (draft: MaterialDraft) => {
  const { picture: _picture, key: _key, ...fields } = draft as ClipDraft & { key?: string };
  return fields;
};

async function filed(
  seriesId: string,
  folder: string,
  draft: MaterialDraft,
  pictureId: string | undefined,
  id: string,
): Promise<MaterialItem | null> {
  const file = `${id}${extname(draft.source.file)}`;
  try {
    await mkdir(materialDir(seriesId), { recursive: true });
    await cloneFile(childPath(folder, draft.source.file), childPath(materialDir(seriesId), file));
  } catch (error) {
    console.error(`[material] could not file ${draft.source.file}`, error);
    return null;
  }
  return {
    ...derivedFields(draft),
    id,
    file,
    ...(pictureId ? { pictureId } : {}),
    kept: false,
    reusable: true,
    uses: [],
  };
}

async function picturesOf(folder: string): Promise<Picture[]> {
  try {
    const list = JSON.parse(await readFile(join(folder, SHOT_LIST_FILE), "utf8")) as ShotList;
    return list.pictures ?? [];
  } catch {
    return [];
  }
}

const placeOf = (ws: Workspace, seriesId: string) =>
  ws.series
    .find((s) => s.id === seriesId)
    ?.environmentIds.map((id) => ws.assets.find((a) => a.id === id))
    .find((a): a is Asset => Boolean(a?.images.length));

const fromVideo = (job: Pick<VideoJob, "sessionId" | "scriptId">) => (item: MaterialItem) =>
  item.source.sessionId === job.sessionId && item.source.scriptId === job.scriptId;

function refreshed(item: MaterialItem, draft: MaterialDraft): MaterialItem {
  const { madeFrom: _madeFrom, ...fields } = derivedFields(draft);
  const { scene: _scene, sceneId: _sceneId, ...kept } = item;
  return { ...kept, ...fields };
}

async function addDrafts(edit: Edit, job: VideoJob, folder: string, drafts: MaterialDraft[]) {
  const ours = () => edit.material.items.filter(fromVideo(job));
  const existing = (file: string) => ours().find((i) => i.source.file === file);
  const pictureIdOf = (picture: PictureDraft) =>
    ours().find((i) => i.kind === "picture" && i.source.file === picture.source.file)?.id;
  const add = async (draft: MaterialDraft, pictureId: string | undefined) => {
    const item = await filed(
      job.seriesId,
      folder,
      draft,
      pictureId,
      freeIdFor(edit.material, draft),
    );
    if (item) edit.material.items.push(item);
  };
  const refresh = (item: MaterialItem, draft: MaterialDraft) => {
    edit.material.items = edit.material.items.map((i) => (i === item ? refreshed(i, draft) : i));
  };
  for (const draft of drafts.filter((d) => d.kind === "picture")) {
    const item = existing(draft.source.file);
    if (item) refresh(item, draft);
    else await add(draft, undefined);
  }
  for (const draft of drafts.filter((d): d is ClipDraft => d.kind === "clip")) {
    const pictureId = pictureIdOf(draft.picture);
    if (!pictureId) continue;
    const item = existing(draft.source.file);
    if (item) refresh(item, draft);
    else await add(draft, pictureId);
  }
}

function placeInScene(edit: Edit, job: VideoJob) {
  const sceneId = sceneIdOfVideo(job, edit.material.items);
  edit.material.items = edit.material.items.map((i) =>
    fromVideo(job)(i) && sceneId ? { ...i, sceneId } : i,
  );
}

export function syncVideoMaterial(working: VideoJob, folder: string): Promise<void> {
  const job = chosenView(working);
  if (!finishedVideo(job)) return Promise.resolve();
  return editMaterial(job.seriesId, async (edit) => {
    const ws = await getWorkspace();
    const drafts = materialOfVideo(
      job,
      await picturesOf(folder),
      placeOf(ws, job.seriesId),
      ws.assets,
    );
    const kept = new Set(drafts.map((d) => d.source.file));
    removeItems(
      edit,
      edit.material.items.filter(fromVideo(job)).filter((i) => !kept.has(i.source.file)),
    );
    await addDrafts(edit, job, folder, drafts);
    placeInScene(edit, job);
  });
}

const filedCut = (job: VideoJob) => {
  const view = chosenView(job);
  return finishedVideo(view) ? `${chosenVersion(job)}|${view.final}|${view.cutRev ?? 0}` : null;
};

export function fileWhenFinished(before: VideoJob, after: VideoJob, folder: string) {
  const cut = filedCut(after);
  if (!cut || cut === filedCut(before)) return;
  void syncVideoMaterial(after, folder).catch((error) =>
    console.error("[material] could not file the video", error),
  );
}

export async function fileFinishedVideos(videos: { job: VideoJob; folder: string }[]) {
  for (const { job, folder } of videos) {
    await syncVideoMaterial(job, folder).catch((error) =>
      console.error(`[material] could not file ${job.scriptId}`, error),
    );
  }
}

export function markVideoKept(job: VideoJob): Promise<void> {
  return editMaterial(job.seriesId, ({ material }) => {
    for (const item of material.items.filter(fromVideo(job))) item.kept = true;
  });
}

export function recordUse(
  seriesId: string,
  itemId: string,
  job: Pick<VideoJob, "sessionId" | "scriptId">,
  at: string,
): Promise<void> {
  return editMaterial(seriesId, ({ material }) => {
    const item = material.items.find((i) => i.id === itemId);
    if (!item || usedBy(item, job)) return;
    item.uses.push({ sessionId: job.sessionId, scriptId: job.scriptId, at });
  });
}

export async function placeMaterialFile(seriesId: string, item: MaterialItem, to: string) {
  await rm(to, { force: true });
  await cloneFile(itemPath(seriesId, item), to);
}

export async function listMaterial(seriesId: string): Promise<MaterialItem[]> {
  return (await inSeriesOrder(seriesId, () => readMaterial(seriesId))).items;
}

const itemOf = (material: SeriesMaterial, itemId: string) => {
  const item = material.items.find((i) => i.id === itemId);
  if (!item) throw new Error("Không tìm thấy tư liệu");
  return item;
};

export function setMaterialReusable(
  seriesId: string,
  itemId: string,
  reusable: boolean,
): Promise<null> {
  return editMaterial(seriesId, ({ material }) => {
    const item = itemOf(material, itemId);
    for (const i of withClipsOf(material.items, [item])) i.reusable = reusable === true;
    return null;
  });
}

export function removeMaterial(seriesId: string, itemId: string): Promise<null> {
  return editMaterial(seriesId, (edit) => {
    removeItems(edit, [itemOf(edit.material, itemId)]);
    return null;
  });
}

export async function addMaterialToCharacter(seriesId: string, itemId: string): Promise<Asset> {
  const item = itemOf(await inSeriesOrder(seriesId, () => readMaterial(seriesId)), itemId);
  const characterId = item.people[0];
  const character = (await getWorkspace()).assets.find(
    (a) => a.id === characterId && a.kind === "character",
  );
  if (item.kind !== "picture" || item.role !== "character" || !character) {
    throw new Error("Ảnh này không thuộc nhân vật nào");
  }
  if (character.images.length >= MAX_CHARACTER_IMAGES) throw new Error(FULL_CHARACTER);
  const [staged] = await stageImages([itemPath(seriesId, item)]);
  if (!staged) throw new Error("Không đọc được ảnh tư liệu");
  return updateAsset(character.id, {
    kind: character.kind,
    name: character.name,
    handle: character.handle,
    description: character.description,
    images: [
      ...character.images.map((image) => ({
        source: "asset" as const,
        assetId: character.id,
        id: image.id,
        angle: image.angle,
      })),
      { source: "staged", id: staged.id, origin: "ai", angle: "other" },
    ],
    contains: character.contains,
  });
}
