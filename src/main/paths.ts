import { randomBytes } from "node:crypto";
import { mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app } from "electron";

/**
 * Everything the app persists lives under one folder:
 *
 *   <userData>/
 *     workspace.json   series and sessions
 *     settings.json    window/theme preferences
 *     secrets.json     provider keys, encrypted with the OS keychain (safeStorage)
 *     media/<seriesId>/<sessionId>/   board.json (scripts and chat), later audio, clips and exports
 *
 * Set HYAN_DATA_DIR to point development at a disposable folder.
 */
export function dataDir(): string {
  return process.env.HYAN_DATA_DIR ?? app.getPath("userData");
}

export const dataFile = (name: string) => join(dataDir(), name);

export const mediaDir = (seriesId: string, sessionId?: string) =>
  sessionId ? join(dataDir(), "media", seriesId, sessionId) : join(dataDir(), "media", seriesId);

/**
 * Write-then-rename so a crash mid-write never leaves a truncated JSON file:
 * the file is either the old one or the new one, whole. The temporary file is
 * flushed to disk before the rename (so even a power cut cannot swap in an
 * empty file) and named per write, so two writes of one file never share it.
 * A write cut off leaves only `<file>.<pid>-<id>.tmp`, removed by `removeStaleTmp`.
 */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`;
  const file = await open(tmp, "w");
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

/** `writeJsonAtomic`'s temporary files (also the older `<file>.<pid>.tmp`), with the writer's pid. */
const TMP = /\.(\d+)(?:-[0-9a-f]+)?\.tmp$/;

/** Removes temporary files that writes of an earlier run left in `dir` (never this run's). */
export async function removeStaleTmp(dir: string): Promise<void> {
  const names = await readdir(dir).catch(() => [] as string[]);
  for (const name of names) {
    const pid = TMP.exec(name)?.[1];
    if (pid && Number(pid) !== process.pid) await rm(join(dir, name), { force: true });
  }
}
