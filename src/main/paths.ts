import { mkdir, rename, writeFile } from "node:fs/promises";
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

/** Write-then-rename so a crash mid-write never leaves a truncated JSON file. */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}
