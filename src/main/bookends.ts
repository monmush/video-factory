import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { BrowserWindow, dialog } from "electron";
import {
  BOOKEND_MAX_SEC,
  BOOKEND_SLOTS,
  type BookendChanges,
  type StagedBookend,
} from "../shared/bookends";
import { mediaUrl } from "../shared/ipc";
import { OUTPUT_SIZE } from "../shared/output-size";
import { stagingDir } from "./media";
import { bookendsDir } from "./paths";
import { type PlacedBookends, setSeriesBookends } from "./store";
import { bookendClip, probeSeconds, probeStreams } from "./video/ffmpeg";

const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "webm"];
const NOT_A_VIDEO = "Tệp này không phải video";
const TOO_LONG = `Video dài quá ${BOOKEND_MAX_SEC} giây`;
const STAGED_VIDEO = /^[0-9a-f-]+\.mp4$/;

async function pickedVideo(): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: "Chọn video",
    properties: ["openFile"],
    filters: [{ name: "Video", extensions: VIDEO_EXTENSIONS }],
  };
  const win = BrowserWindow.getFocusedWindow();
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

async function videoSeconds(path: string): Promise<number> {
  const found = await Promise.all([probeStreams(path), probeSeconds(path)]).catch(() => null);
  if (!found?.[0].video) throw new Error(NOT_A_VIDEO);
  return found[1];
}

export async function pickBookend(): Promise<StagedBookend | null> {
  const source = await pickedVideo();
  if (!source) return null;
  if ((await videoSeconds(source)) > BOOKEND_MAX_SEC) throw new Error(TOO_LONG);
  await mkdir(stagingDir(), { recursive: true });
  const id = `${randomUUID()}.mp4`;
  const out = join(stagingDir(), id);
  try {
    await bookendClip(source, out, OUTPUT_SIZE);
    return { id, url: mediaUrl.staged(id), seconds: await probeSeconds(out) };
  } catch (error) {
    await rm(out, { force: true });
    throw error;
  }
}

async function stagedVideo(id: unknown): Promise<string> {
  if (typeof id !== "string" || !STAGED_VIDEO.test(id)) throw new Error("Invalid staged video");
  const path = join(stagingDir(), id);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw new Error("Không tìm thấy video đã chọn");
  return path;
}

export async function saveSeriesBookends(seriesId: string, changes: BookendChanges) {
  const dir = bookendsDir(seriesId);
  const placed: PlacedBookends = {};
  const moved: string[] = [];
  let replaced: string[];
  try {
    for (const slot of BOOKEND_SLOTS) {
      const change = changes[slot];
      if (change === undefined) continue;
      if (change === null) {
        placed[slot] = null;
        continue;
      }
      const source = await stagedVideo(change.staged);
      const file = `${slot}-${randomUUID()}.mp4`;
      await mkdir(dir, { recursive: true });
      await rename(source, join(dir, file));
      moved.push(join(dir, file));
      placed[slot] = { file, seconds: await probeSeconds(join(dir, file)) };
    }
    ({ replaced } = await setSeriesBookends(seriesId, placed));
  } catch (error) {
    await Promise.all(moved.map((path) => rm(path, { force: true })));
    throw error;
  }
  await Promise.all(replaced.map((file) => rm(join(dir, file), { force: true })));
}
