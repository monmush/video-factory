import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { BrowserWindow, shell } from "electron";
import { migrateSettings, outputResolution } from "../shared/batch-settings";
import {
  type AssetKind,
  SERIES_ASSET_FIELD,
  type Series,
  type SeriesInput,
  type Session,
  type Workspace,
} from "../shared/ipc";
import { mediaLevel } from "../shared/media-level";
import { MAX_NOTE_LENGTH, type Note, type NoteArea, putNote } from "../shared/notes";
import { mixProblem, type ProductMix } from "../shared/product-mix";
import { videoModel } from "../shared/video-models";
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
    cache.series = cache.series.map((s: Partial<Series> & Pick<Series, "id">) =>
      migrateSettings({
        ...(s as Series),
        characterIds: s.characterIds ?? [],
        productIds: s.productIds ?? [],
        environmentIds: s.environmentIds ?? [],
      }),
    );
    // Model ids from before MiniMax became one entry.
    cache.sessions = cache.sessions.map((s) =>
      s.settings ? { ...s, settings: migrateSettings(s.settings) } : s,
    );
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
      ...(input.videoModel ? { videoModel: videoModel(input.videoModel).id } : {}),
      ...(input.resolution ? { resolution: outputResolution(input.resolution) } : {}),
      ...(input.mediaLevel ? { mediaLevel: mediaLevel(input.mediaLevel).id } : {}),
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
    // Unknown ids are saved as the default, so a series never names a missing model.
    if (input.videoModel !== undefined) series.videoModel = videoModel(input.videoModel).id;
    if (input.resolution !== undefined) series.resolution = outputResolution(input.resolution);
    if (input.mediaLevel !== undefined) series.mediaLevel = mediaLevel(input.mediaLevel).id;
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
  settings?: {
    videoModel?: string | null;
    resolution?: string | null;
    mediaLevel?: string | null;
    productMix?: ProductMix | null;
  };
}): Promise<Session> {
  return mutate((ws) => {
    const session = ws.sessions.find((s) => s.id === input.id);
    if (!session) throw new Error(`Session not found: ${input.id}`);
    if (input.name !== undefined) session.name = input.name.trim() || session.name;
    if (input.pinned !== undefined) setPinned(session, input.pinned);
    if (input.settings) {
      // Only videos created afterwards use them; jobs keep their own. Null:
      // back to the series' value. Unknown values are saved as the default.
      const next = { ...session.settings };
      const { videoModel: model, resolution } = input.settings;
      if (model === null) delete next.videoModel;
      else if (model !== undefined) next.videoModel = videoModel(model).id;
      if (resolution === null) delete next.resolution;
      else if (resolution !== undefined) next.resolution = outputResolution(resolution);
      const level = input.settings.mediaLevel;
      if (level === null) delete next.mediaLevel;
      else if (level !== undefined) next.mediaLevel = mediaLevel(level).id;
      const mix = input.settings.productMix;
      if (mix === null || (mix && mix.length === 0)) delete next.productMix;
      else if (mix) {
        const problem = mixProblem(mix, (id) =>
          ws.assets.some((a) => a.id === id && a.kind === "product"),
        );
        if (problem) throw new Error(problem);
        next.productMix = mix.map(({ productId, share }) => ({ productId, share }));
        // A product in the mix is one the series uses: the writer must know it.
        const series = ws.series.find((s) => s.id === session.seriesId);
        if (series) {
          for (const { productId } of mix) {
            if (!series.productIds.includes(productId)) series.productIds.push(productId);
          }
        }
      }
      if (Object.keys(next).length) session.settings = next;
      else delete session.settings;
    }
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

/**
 * Session-level script approval; the board is read-only afterwards. Records
 * which scripts were committed; a later call adds more (the rest after a test).
 */
export function approveSession(sessionId: string, scriptIds: string[]): Promise<Session> {
  return mutate((ws) => {
    const session = ws.sessions.find((s) => s.id === sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    // Approved before commits were recorded: everything is already committed.
    if (session.approvedAt && !session.committedScriptIds) return session;
    const committed = session.committedScriptIds ?? [];
    session.committedScriptIds = [
      ...committed,
      ...scriptIds.filter((id) => !committed.includes(id)),
    ];
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

// ---------------------------------------------------------------- learned preferences

/** Where a note lives: the series' list, or the workspace's for every series. */
function noteList(ws: Workspace, seriesId: string | null) {
  if (seriesId === null) return { get: () => ws.notes ?? [], set: (l: Note[]) => (ws.notes = l) };
  const series = ws.series.find((s) => s.id === seriesId);
  if (!series) throw new Error(`Series not found: ${seriesId}`);
  return { get: () => series.notes ?? [], set: (l: Note[]) => (series.notes = l) };
}

const cleanNote = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, MAX_NOTE_LENGTH);

/**
 * Saves a note for one series, or for every series when `seriesId` is null.
 * `replaceId` replaces that note wherever it is (a scope change moves it).
 * Throws at the cap (MAX_NOTES per scope).
 */
export function saveNote(input: {
  seriesId: string | null;
  text: string;
  area: NoteArea;
  replaceId?: string;
  from?: Note["from"];
}): Promise<{ note: Note; replaced: boolean }> {
  return mutate((ws) => {
    const text = cleanNote(input.text);
    if (!text) throw new Error("Ghi nhớ trống");
    const target = noteList(ws, input.seriesId);
    const note: Note = {
      id: randomUUID(),
      text,
      area: input.area,
      at: now(),
      ...(input.from ? { from: input.from } : {}),
    };
    // Replacing a note saved in the other scope: take it out there first.
    let moved = false;
    if (input.replaceId && !target.get().some((n) => n.id === input.replaceId)) {
      for (const list of allNoteLists(ws)) {
        if (list.get().some((n) => n.id === input.replaceId)) {
          list.set(list.get().filter((n) => n.id !== input.replaceId));
          moved = true;
        }
      }
    }
    const { list, replaced } = putNote(target.get(), note, input.replaceId);
    target.set(list);
    const saved = list.find((n) => n.text === text) ?? note;
    return { note: saved, replaced: replaced || moved };
  });
}

function allNoteLists(ws: Workspace) {
  return [noteList(ws, null), ...ws.series.map((s) => noteList(ws, s.id))];
}

export function updateNote(id: string, text: string): Promise<null> {
  return mutate((ws) => {
    const clean = cleanNote(text);
    if (!clean) throw new Error("Ghi nhớ trống");
    for (const list of allNoteLists(ws)) {
      if (list.get().some((n) => n.id === id)) {
        list.set(list.get().map((n) => (n.id === id ? { ...n, text: clean } : n)));
      }
    }
    return null;
  });
}

export function removeNote(id: string): Promise<null> {
  return mutate((ws) => {
    for (const list of allNoteLists(ws)) {
      if (list.get().some((n) => n.id === id)) list.set(list.get().filter((n) => n.id !== id));
    }
    return null;
  });
}
