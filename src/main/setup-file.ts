import { access, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Workspace } from "../shared/ipc";
import { isSafeSegment } from "../shared/safe-segment";
import {
  buildShare,
  INVALID_SHARE_MESSAGE,
  mergeShare,
  parseShare,
  SHARE_FILE,
  type ShareFile,
} from "../shared/setup-share";
import { childPath } from "./safe-path";
import {
  InvalidZipError,
  openStoredZip,
  type StoredZip,
  writeStoredZip,
  type ZipSource,
} from "./stored-zip";

export const SETUP_EXTENSION = "vfsetup";
export const MAX_SETUP_BYTES = 3.5 * 1024 ** 3;
export const TOO_LARGE_MESSAGE = "Thiết lập quá lớn để xuất thành một tệp.";
const SERIES_FOLDERS = ["_material", "_look", "_bookends"];

async function filesIn(dataDir: string, folder: string[]): Promise<ZipSource[]> {
  const dir = childPath(dataDir, ...folder);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && isSafeSegment(entry.name))
    .map((entry) => ({ path: [...folder, entry.name].join("/"), file: join(dir, entry.name) }));
}

async function setupSources(dataDir: string, ws: Workspace): Promise<ZipSource[]> {
  const folders = [
    ...ws.assets.map((asset) => ["assets", asset.id]),
    ["voices"],
    ...ws.series.flatMap((series) => SERIES_FOLDERS.map((f) => ["media", series.id, f])),
  ];
  return (await Promise.all(folders.map((folder) => filesIn(dataDir, folder)))).flat();
}

async function totalBytes(sources: readonly ZipSource[]): Promise<number> {
  const sizes = await Promise.all(
    sources.map((source) =>
      "bytes" in source ? source.bytes.length : stat(source.file).then((s) => s.size),
    ),
  );
  return sizes.reduce((sum, size) => sum + size, 0);
}

const pad = (n: number) => String(n).padStart(2, "0");

function setupFileName(now: Date, attempt: number): string {
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `thiet-lap-${stamp}${attempt > 1 ? `-${attempt}` : ""}.${SETUP_EXTENSION}`;
}

async function writeUnderFreeName(destination: string, now: Date, sources: readonly ZipSource[]) {
  await mkdir(destination, { recursive: true });
  for (let attempt = 1; ; attempt++) {
    const file = join(destination, setupFileName(now, attempt));
    try {
      await writeStoredZip(file, sources);
      return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}

export async function exportSetup(input: {
  dataDir: string;
  destination: string;
  ws: Workspace;
  appVersion: string;
  now?: Date;
}): Promise<string> {
  const now = input.now ?? new Date();
  const share = buildShare(input.ws, {
    createdAt: now.toISOString(),
    appVersion: input.appVersion,
  });
  const sources: ZipSource[] = [
    { path: SHARE_FILE, bytes: new TextEncoder().encode(`${JSON.stringify(share, null, 2)}\n`) },
    ...(await setupSources(input.dataDir, input.ws)),
  ];
  if ((await totalBytes(sources)) > MAX_SETUP_BYTES) throw new Error(TOO_LARGE_MESSAGE);
  return writeUnderFreeName(input.destination, now, sources);
}

export interface SetupImport {
  series: number;
  assets: number;
  skipped: number;
}

interface Added {
  assetIds: ReadonlySet<string>;
  seriesIds: ReadonlySet<string>;
}

type Target = { path: string; onlyIfMissing: boolean };

function entryTarget(dataDir: string, entryPath: string, added: Added): Target | null {
  const parts = entryPath.split("/");
  if (!parts.every(isSafeSegment)) return null;
  const [top, id = "", folder = ""] = parts;
  const voice = top === "voices" && parts.length === 2;
  const assetFile = top === "assets" && parts.length === 3 && added.assetIds.has(id);
  const seriesFile =
    top === "media" &&
    parts.length === 4 &&
    SERIES_FOLDERS.includes(folder) &&
    added.seriesIds.has(id);
  if (!voice && !assetFile && !seriesFile) return null;
  return { path: childPath(dataDir, ...parts), onlyIfMissing: voice };
}

async function readShare(zip: StoredZip): Promise<ShareFile> {
  const text = await zip.readText(SHARE_FILE);
  if (text === null) throw new Error(INVALID_SHARE_MESSAGE);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(INVALID_SHARE_MESSAGE);
  }
  return parseShare(raw);
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

async function extractAdded(zip: StoredZip, dataDir: string, added: Added) {
  const created: string[] = [];
  const makeFolder = async (path: string) => {
    const first = await mkdir(path, { recursive: true });
    if (first) created.push(first);
  };
  try {
    for (const entry of zip.entries) {
      const target = entryTarget(dataDir, entry.path, added);
      if (!target || (target.onlyIfMissing && (await exists(target.path)))) continue;
      await makeFolder(dirname(target.path));
      created.push(target.path);
      await zip.extract(entry, target.path);
    }
    for (const seriesId of added.seriesIds) await makeFolder(childPath(dataDir, "media", seriesId));
  } catch (error) {
    await Promise.all(created.map((path) => rm(path, { recursive: true, force: true })));
    throw error;
  }
}

export async function importSetup(input: {
  file: string;
  dataDir: string;
  ws: Workspace;
}): Promise<SetupImport> {
  const zip = await openStoredZip(input.file).catch((error) => {
    throw error instanceof InvalidZipError ? error : new Error(INVALID_SHARE_MESSAGE);
  });
  try {
    const merge = mergeShare(input.ws, await readShare(zip));
    await extractAdded(zip, input.dataDir, {
      assetIds: new Set(merge.addedAssetIds),
      seriesIds: new Set(merge.addedSeriesIds),
    });
    input.ws.series = merge.series;
    input.ws.assets = merge.assets;
    if (merge.notes.length || input.ws.notes) input.ws.notes = merge.notes;
    return {
      series: merge.addedSeriesIds.length,
      assets: merge.addedAssetIds.length,
      skipped: merge.skipped,
    };
  } finally {
    await zip.close();
  }
}
