import { randomBytes } from "node:crypto";
import { mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app } from "electron";
import { childPath } from "./safe-path";

export function dataDir(): string {
  return process.env.HYAN_DATA_DIR ?? app.getPath("userData");
}

export const dataFile = (name: string) => join(dataDir(), name);

export const voicesDir = () => join(dataDir(), "voices");

export const mediaDir = (seriesId: string, sessionId?: string) =>
  sessionId
    ? childPath(join(dataDir(), "media"), seriesId, sessionId)
    : childPath(join(dataDir(), "media"), seriesId);

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

const TMP = /\.(\d+)(?:-[0-9a-f]+)?\.tmp$/;

export async function removeStaleTmp(dir: string): Promise<void> {
  const names = await readdir(dir).catch(() => [] as string[]);
  for (const name of names) {
    const pid = TMP.exec(name)?.[1];
    if (pid && Number(pid) !== process.pid) await rm(join(dir, name), { force: true });
  }
}

export const materialDir = (seriesId: string) => join(mediaDir(seriesId), "_material");

export const bookendsDir = (seriesId: string) => join(mediaDir(seriesId), "_bookends");
