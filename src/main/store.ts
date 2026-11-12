import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { BrowserWindow, shell } from "electron";
import {
  type AssetKind,
  SERIES_ASSET_FIELD,
  type Series,
  type SeriesInput,
  type Session,
  type Workspace,
} from "../shared/ipc";
import { dataFile, mediaDir, writeJsonAtomic } from "./paths";

const FILE = "workspace.json";
const empty = (): Workspace => ({ version: 1, series: [], sessions: [], assets: [] });

let cache: Workspace | null = null;
// Serialise writes so two quick IPC calls cannot interleave read-modify-write.
let queue: Promise<unknown> = Promise.resolve();

async function load(): Promise<Workspace> {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(await readFile(dataFile(FILE), "utf8")) as Workspace;
    cache = { ...empty(), ...parsed };
    // Series saved before they carried assets.
    cache.series = cache.series.map((s: Partial<Series> & Pick<Series, "id">) => ({
      ...(s as Series),
      characterIds: s.characterIds ?? [],
      productIds: s.productIds ?? [],
      environmentIds: s.environmentIds ?? [],
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    cache = empty();
  }
  return cache;
}

export function mutate<T>(change: (ws: Workspace) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const ws = structuredClone(await load());
    const result = await change(ws);
    await writeJsonAtomic(dataFile(FILE), ws);
    cache = ws;
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send("workspace:changed", ws);
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

const now = () => new Date().toISOString();

export async function getWorkspace(): Promise<Workspace> {
  return structuredClone(await load());
}

/** First line of the description, cut at a word, as a default series name. */
function nameFrom(guidance: string): string {
  const line =
    guidance
      .trim()
      .split(/[\n.!?]/)[0]
      ?.trim() ?? "";
  if (line.length <= 48) return line;
  return `${line.slice(0, 48).replace(/\s+\S*$/, "")}…`;
}

/** Keeps only ids of existing assets of the given kind, without duplicates. */
function assetIds(ws: Workspace, ids: string[], kind: AssetKind): string[] {
  return [...new Set(ids)].filter((id) => ws.assets.some((a) => a.id === id && a.kind === kind));
}

export function createSeries(input: SeriesInput): Promise<Series> {
  return mutate(async (ws) => {
    const guidance = input.guidance.trim();
    const series: Series = {
      id: randomUUID(),
      name: input.name.trim() || nameFrom(guidance) || "Series mới",
      guidance,
      characterIds: assetIds(ws, input.characterIds, "character"),
      productIds: assetIds(ws, input.productIds, "product"),
      environmentIds: assetIds(ws, input.environmentIds ?? [], "environment"),
      createdAt: now(),
      updatedAt: now(),
    };
    ws.series.push(series);
    await mkdir(mediaDir(series.id), { recursive: true });
    return series;
  });
}

export function updateSeries(
  input: { id: string; pinned?: boolean } & Partial<SeriesInput>,
): Promise<Series> {
  return mutate((ws) => {
    const series = ws.series.find((s) => s.id === input.id);
    if (!series) throw new Error(`Series not found: ${input.id}`);
    if (input.name !== undefined) series.name = input.name.trim() || series.name;
    if (input.guidance !== undefined) series.guidance = input.guidance.trim();
    if (input.pinned !== undefined) setPinned(series, input.pinned);
    for (const [kind, field] of Object.entries(SERIES_ASSET_FIELD) as [
      AssetKind,
      keyof SeriesInput & keyof Series,
    ][]) {
      const ids = input[field];
      if (Array.isArray(ids)) (series[field] as string[]) = assetIds(ws, ids, kind);
    }
    series.updatedAt = now();
    return series;
  });
}

/** Deletes a series with its sessions. Media goes to the Trash so a mistake is recoverable. */
export function deleteSeries(id: string): Promise<null> {
  return mutate(async (ws) => {
    if (!ws.series.some((s) => s.id === id)) return null;
    ws.series = ws.series.filter((s) => s.id !== id);
    ws.sessions = ws.sessions.filter((s) => s.seriesId !== id);
    await shell.trashItem(mediaDir(id)).catch(() => undefined);
    return null;
  });
}

function setPinned(item: { pinnedAt?: string }, pinned: boolean) {
  if (pinned) item.pinnedAt ??= now();
  else delete item.pinnedAt;
}

export function updateSession(input: {
  id: string;
  name?: string;
  pinned?: boolean;
}): Promise<Session> {
  return mutate((ws) => {
    const session = ws.sessions.find((s) => s.id === input.id);
    if (!session) throw new Error(`Session not found: ${input.id}`);
    if (input.name !== undefined) session.name = input.name.trim() || session.name;
    if (input.pinned !== undefined) setPinned(session, input.pinned);
    session.updatedAt = now();
    return session;
  });
}

/** Deletes one session. Its media goes to the Trash so a mistake is recoverable. */
export function deleteSession(id: string): Promise<null> {
  return mutate(async (ws) => {
    const session = ws.sessions.find((s) => s.id === id);
    if (!session) return null;
    ws.sessions = ws.sessions.filter((s) => s.id !== id);
    await shell.trashItem(mediaDir(session.seriesId, id)).catch(() => undefined);
    return null;
  });
}

/** Session-level script approval; the board is read-only afterwards. */
export function approveSession(sessionId: string): Promise<Session> {
  return mutate((ws) => {
    const session = ws.sessions.find((s) => s.id === sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    session.approvedAt ??= now();
    session.updatedAt = now();
    return session;
  });
}

export function createSession(input: { seriesId: string; request?: string }): Promise<Session> {
  return mutate(async (ws) => {
    if (!ws.series.some((s) => s.id === input.seriesId)) {
      throw new Error(`Series not found: ${input.seriesId}`);
    }
    const base = `Video ${new Date().toLocaleDateString("vi-VN")}`;
    const sameDay = ws.sessions.filter(
      (s) => s.seriesId === input.seriesId && s.name.startsWith(base),
    ).length;
    const session: Session = {
      id: randomUUID(),
      seriesId: input.seriesId,
      name: sameDay ? `${base} · ${sameDay + 1}` : base,
      ...(input.request?.trim() ? { request: input.request.trim() } : {}),
      approvedAt: null,
      createdAt: now(),
      updatedAt: now(),
    };
    ws.sessions.unshift(session);
    await mkdir(mediaDir(session.seriesId, session.id), { recursive: true });
    return session;
  });
}
