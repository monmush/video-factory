import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BrowserWindow } from "electron";
import { boardOrder, clearMarks } from "../shared/board";
import {
  type Board,
  type ChatMessage,
  resolveChoice,
  type Script,
  type Series,
  type Session,
} from "../shared/ipc";
import {
  applyLineEdit,
  applyLineRemoval,
  type LineEdit,
  type LineRemoval,
  rememberHandEdit,
} from "../shared/line-edit";
import { mentionedProducts, newTopicProducts } from "../shared/product-mix";
import { checkScript, committedIds, finishedScripts } from "../shared/ready-check";
import {
  directionStates,
  directionText,
  effectiveMention,
  seriesTargetSec,
} from "../shared/series-guide";
import { copyScript } from "../shared/versions";
import { applyUndo, dropTouch, recordTouch, type TurnLog, turnUndo } from "./board-undo";
import { mediaDir, writeJsonAtomic } from "./paths";
import * as writer from "./script-writer";
import { draftSettled } from "./series-guide";
import { readSettings } from "./settings";
import { getWorkspace, updateSeries } from "./store";

export type { TurnLog };

const FILE = "board.json";
const cache = new Map<string, Board>();
const singleColdReadPerSession = new Map<string, Promise<Board>>();
const writesInOrderPerSession = new Map<string, Promise<unknown>>();
const scriptsBeingWrittenInThisProcess = new Set<string>();
export const runningRequests = new Set<string>();

export const now = () => new Date().toISOString();
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function findSession(sessionId: string) {
  const ws = await getWorkspace();
  const session = ws.sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error("Không tìm thấy phiên này");
  return { ws, session };
}

const lockedIds = (session: Session, board: Board) => new Set(committedIds(session, board.scripts));

export async function sentScriptIds(sessionId: string): Promise<Set<string>> {
  const { session } = await findSession(sessionId);
  return lockedIds(session, await load(sessionId));
}

function insertCopy(b: Board, source: Script): Script {
  const { copy, index } = copyScript(b.scripts, source, { id: randomUUID(), now: now() });
  b.scripts.splice(index, 0, copy);
  return copy;
}

function editTarget(b: Board, locked: ReadonlySet<string>, log: TurnLog, script: Script) {
  if (!locked.has(script.id)) return { target: script, copied: false, created: false };
  log.copies ??= new Map();
  const existing = b.scripts.find((x) => x.id === log.copies?.get(script.id) && !x.deletedAt);
  if (existing) return { target: existing, copied: true, created: false };
  const copy = insertCopy(b, script);
  copy.mark = "edited";
  const undoState = turnUndo(b, log);
  if (undoState) undoState.added = [...(undoState.added ?? []), copy.id];
  log.touched.add(copy.id);
  log.copies.set(script.id, copy.id);
  return { target: copy, copied: true, created: true };
}

function dropCopy(b: Board, log: TurnLog, copy: Script) {
  copy.deletedAt = now();
  for (const [source, id] of log.copies ?? []) if (id === copy.id) log.copies?.delete(source);
  const undoState = turnUndo(b, log);
  if (undoState?.added) undoState.added = undoState.added.filter((id) => id !== copy.id);
  log.touched.delete(copy.id);
}

function load(sessionId: string): Promise<Board> {
  const cached = cache.get(sessionId);
  if (cached) return Promise.resolve(cached);
  let pending = singleColdReadPerSession.get(sessionId);
  if (!pending) {
    pending = read(sessionId).finally(() => singleColdReadPerSession.delete(sessionId));
    singleColdReadPerSession.set(sessionId, pending);
  }
  return pending;
}

async function read(sessionId: string): Promise<Board> {
  const { session } = await findSession(sessionId);
  let board: Board;
  try {
    board = JSON.parse(
      await readFile(join(mediaDir(session.seriesId, session.id), FILE), "utf8"),
    ) as Board;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    board = {
      version: 1,
      scripts: [],
      messages: session.request
        ? [{ id: randomUUID(), role: "user", text: session.request, at: session.createdAt }]
        : [],
    };
  }
  for (const s of board.scripts) {
    if (scriptsBeingWrittenInThisProcess.has(s.id)) continue;
    if (s.status === "writing") s.status = s.lines.length ? "ready" : "failed";
    delete s.changing;
  }
  for (const m of board.messages) {
    if (m.pending && !runningRequests.has(m.id)) {
      m.pending = false;
      if (m.parts) m.outcome = "stopped";
      else m.text ||= "Đã dừng giữa chừng.";
    }
    if (m.queued && !runningRequests.has(m.id)) {
      m.queued = false;
      m.unsent = true;
    }
  }
  cache.set(sessionId, board);
  return board;
}

function broadcast(sessionId: string, board: Board) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("board:changed", { sessionId, board });
  }
}

type BoardListener = (sessionId: string, board: Board) => void;
const boardListeners = new Set<BoardListener>();

export function onBoardChanged(listener: BoardListener): () => void {
  boardListeners.add(listener);
  return () => boardListeners.delete(listener);
}

export function mutateBoard<T>(sessionId: string, change: (board: Board) => T): Promise<T> {
  const run = (writesInOrderPerSession.get(sessionId) ?? Promise.resolve()).then(async () => {
    const { session } = await findSession(sessionId);
    const board = structuredClone(await load(sessionId));
    const result = change(board);
    await writeJsonAtomic(join(mediaDir(session.seriesId, session.id), FILE), board);
    cache.set(sessionId, board);
    broadcast(sessionId, board);
    for (const listener of boardListeners) {
      try {
        listener(sessionId, structuredClone(board));
      } catch (error) {
        console.warn("[board] listener failed:", error);
      }
    }
    return result;
  });
  writesInOrderPerSession.set(
    sessionId,
    run.catch(() => undefined),
  );
  return run;
}

export async function getBoard(sessionId: string): Promise<Board> {
  return structuredClone(await load(sessionId));
}

const MAX_AVOID = 80;

export async function approvedSessionsUsing(assetId: string): Promise<string[]> {
  const ws = await getWorkspace();
  const names: string[] = [];
  for (const session of ws.sessions.filter((s) => s.approvedAt)) {
    const board = await load(session.id).catch(() => null);
    const uses = boardOrder(board?.scripts ?? []).some(
      (s) => s.productIds.includes(assetId) || s.lines.some((l) => l.characterId === assetId),
    );
    if (uses) names.push(session.name);
  }
  return names;
}

const readChoice = () => {
  const settings = readSettings();
  return { model: settings.chatModel, effort: settings.chatEffort };
};

export async function writerContext(sessionId: string): Promise<writer.WriterContext> {
  await draftSettled((await findSession(sessionId)).session.seriesId);
  const { ws, session } = await findSession(sessionId);
  const series = ws.series.find((s) => s.id === session.seriesId);
  if (!series) throw new Error("Không tìm thấy series");
  const pick = (ids: string[]) => ids.flatMap((id) => ws.assets.find((a) => a.id === id) ?? []);
  const avoid = new Set<string>();
  for (const other of ws.sessions.filter((s) => s.seriesId === series.id)) {
    if (avoid.size >= MAX_AVOID) break;
    const board = await load(other.id).catch(() => null);
    for (const s of [...(board?.scripts ?? [])].reverse()) {
      if (avoid.size >= MAX_AVOID) break;
      if (!s.deletedAt && s.title) avoid.add(s.title);
    }
  }
  const choice = resolveChoice((await load(sessionId)).agent ?? readChoice());
  const states = directionStates(series.guide);
  return {
    sessionId,
    model: choice.model,
    effort: choice.effort,
    direction: directionText(series),
    targetSec: seriesTargetSec(series),
    productMention: effectiveMention(series.guide, series.productIds.length),
    storyOrToneStated: states.storyOrTone,
    closingStated: states.closing,
    notes: { every: ws.notes ?? [], series: series.notes ?? [] },
    characters: pick(series.characterIds),
    products: pick(series.productIds),
    environments: pick(series.environmentIds),
    avoid: [...avoid],
  };
}

export function newScript(fields: Pick<Script, "brief"> & Partial<Script>): Script {
  return {
    id: randomUUID(),
    title: "",
    hook: "",
    lines: [],
    productIds: [],
    staging: "",
    status: "writing",
    mark: "new",
    pinned: false,
    deletedAt: null,
    createdAt: now(),
    updatedAt: now(),
    ...fields,
  };
}

export { clearMarks };

async function topicProducts(
  sessionId: string,
  b: Board,
  named: readonly (string | null | undefined)[],
  request?: string,
): Promise<(string | null | undefined)[]> {
  const { ws, session } = await findSession(sessionId);
  const series = ws.series.find((s) => s.id === session.seriesId);
  const mentioned = request
    ? mentionedProducts(
        request,
        ws.assets.filter((a) => a.kind === "product"),
      )
    : [];
  if (series) await joinSeries(series, mentioned);
  const siblings = ws.sessions
    .filter((s) => s.seriesId === session.seriesId)
    .sort((x, y) => x.createdAt.localeCompare(y.createdAt));
  return newTopicProducts({
    named,
    onBoard: boardOrder(b.scripts)
      .filter((s) => s.status !== "failed")
      .map((s) => s.productIds[0] ?? null),
    mentioned,
    savedMix: session.settings?.productMix,
    seriesProductIds: series?.productIds ?? [],
    withoutProducts: effectiveMention(series?.guide, series?.productIds.length ?? 0) === "none",
    offset: Math.max(
      0,
      siblings.findIndex((s) => s.id === sessionId),
    ),
  });
}

export async function joinSeries(
  series: Series,
  productIds: readonly (string | null | undefined)[],
) {
  const missing = productIds.filter(
    (id): id is string => Boolean(id) && !series.productIds.includes(id as string),
  );
  if (!missing.length) return;
  await updateSeries({
    id: series.id,
    productIds: [...new Set([...series.productIds, ...missing])],
  });
}

export async function send(sessionId: string, text: string, refs: string[]): Promise<null> {
  const clean = text.trim();
  if (!clean) return null;
  await begin(sessionId, clean, refs, true);
  return null;
}

export async function startFromRequest(sessionId: string): Promise<void> {
  const board = await load(sessionId);
  const first = board.messages[0];
  if (board.messages.length !== 1 || first?.role !== "user") return;
  await begin(sessionId, first.text, [], false);
}

async function begin(sessionId: string, text: string, refs: string[], addUserMessage: boolean) {
  const reply: ChatMessage = {
    id: randomUUID(),
    role: "assistant",
    text: "",
    pending: true,
    at: now(),
  };
  await mutateBoard(sessionId, (b) => {
    if (b.messages.some((m) => m.pending)) throw new Error("Đang làm yêu cầu trước, chờ một chút");
    clearMarks(b);
    if (addUserMessage) {
      b.messages.push({
        id: randomUUID(),
        role: "user",
        text,
        ...(refs.length ? { refs } : {}),
        at: now(),
      });
    }
    b.messages.push(reply);
  });
  runningRequests.add(reply.id);
  void runRequest(sessionId, reply.id, text, refs);
}

async function runRequest(sessionId: string, replyId: string, text: string, refs: string[]) {
  const say = (patch: Partial<ChatMessage>) =>
    mutateBoard(sessionId, (b) => {
      const m = b.messages.find((x) => x.id === replyId);
      if (m) Object.assign(m, patch);
    });
  try {
    const ctx = await writerContext(sessionId);
    const ordered = boardOrder((await load(sessionId)).scripts);
    const decision = await writer.route(ctx, ordered, text, refs);
    if (decision.action === "reply") await say({ text: decision.text });
    else if (decision.action === "add") await addScripts(sessionId, ctx, decision, text, say);
    else await editScripts(sessionId, ctx, ordered, decision, say);
  } catch (error) {
    console.error("[board] request failed", error);
    await say({ text: `Chưa làm được: ${message(error)}` }).catch(() => {});
  } finally {
    runningRequests.delete(replyId);
    await say({ pending: false }).catch(() => {});
  }
}

type Say = (patch: Partial<ChatMessage>) => Promise<void>;

async function addScripts(
  sessionId: string,
  ctx: writer.WriterContext,
  plan: Extract<writer.Route, { action: "add" }>,
  request: string,
  say: Say,
) {
  const cards = plan.topics.map((t) =>
    newScript({
      title: t.title,
      hook: t.hook,
      brief: {
        kind: "topic",
        ...(plan.direction ? { direction: plan.direction } : {}),
        targetSec: plan.targetSec ?? ctx.targetSec,
      },
    }),
  );
  for (const c of cards) scriptsBeingWrittenInThisProcess.add(c.id);
  const products = await topicProducts(
    sessionId,
    await load(sessionId),
    cards.map(() => undefined),
    request,
  );
  cards.forEach((c, i) => {
    if (products[i] !== undefined && c.brief.kind === "topic") c.brief.productId = products[i];
  });
  await mutateBoard(sessionId, (b) => {
    if (!b.scripts.some((s) => !s.deletedAt)) for (const c of cards) c.mark = null;
    b.scripts.push(...cards);
    const reply = b.messages.at(-1);
    if (reply?.pending) reply.text = `Đang viết ${cards.length} kịch bản…`;
  });
  const results = await Promise.all(cards.map((c) => writeCard(sessionId, c.id, ctx)));
  const failed = results.filter((ok) => !ok).length;
  const written = cards.length - failed;
  await say({
    text: failed
      ? `Đã viết ${written} kịch bản. ${failed} kịch bản chưa viết được.`
      : `Đã viết ${written} kịch bản.`,
  });
}

async function editScripts(
  sessionId: string,
  ctx: writer.WriterContext,
  ordered: Script[],
  plan: Extract<writer.Route, { action: "edit" }>,
  say: Say,
) {
  const targets =
    plan.targets === "all" ? ordered : plan.targets.flatMap((n) => ordered[n - 1] ?? []);
  const ready = targets.filter((s) => s.status === "ready");
  if (ready.length === 0) {
    await say({ text: "Chưa có kịch bản nào để sửa." });
    return;
  }
  const { session } = await findSession(sessionId);
  const copies: string[] = [];
  const chosen = await mutateBoard(sessionId, (b) => {
    const locked = lockedIds(session, b);
    const list = ready.map((s) => {
      if (!locked.has(s.id)) return s;
      const copy = insertCopy(b, s);
      copies.push(copy.id);
      return structuredClone(copy);
    });
    const ids = new Set(list.map((s) => s.id));
    for (const id of ids) scriptsBeingWrittenInThisProcess.add(id);
    for (const s of b.scripts) if (ids.has(s.id)) s.status = "writing";
    const reply = b.messages.at(-1);
    if (reply?.pending) reply.text = `Đang sửa ${list.length} kịch bản…`;
    return list;
  });

  const outcomes = await Promise.all(
    chosen.map(async (before) => {
      let outcome: "changed" | "same" | "failed" = "failed";
      let written: writer.WrittenScript | null = null;
      try {
        written = await writer.revise(ctx, before, plan.instruction, plan.targetSec);
        outcome = written ? "changed" : "same";
      } catch (error) {
        console.error("[board] revise failed", error);
      }
      scriptsBeingWrittenInThisProcess.delete(before.id);
      await mutateBoard(sessionId, (b) => {
        const s = b.scripts.find((x) => x.id === before.id);
        if (!s) return;
        if (written)
          Object.assign(s, written, { mark: "edited", changeUndo: undefined, updatedAt: now() });
        if (written && plan.targetSec) s.brief = { ...s.brief, targetSec: plan.targetSec };
        s.status = "ready";
      }).catch(() => {});
      return outcome;
    }),
  );

  const changed = chosen.filter((s, i) => outcomes[i] === "changed" && !copies.includes(s.id));
  const changedCopies = chosen.filter((s, i) => outcomes[i] === "changed" && copies.includes(s.id));
  const unchangedCopies = chosen.filter(
    (s, i) => outcomes[i] !== "changed" && copies.includes(s.id),
  );
  if (unchangedCopies.length) {
    await mutateBoard(sessionId, (b) => {
      for (const s of b.scripts)
        if (unchangedCopies.some((c) => c.id === s.id)) s.deletedAt = now();
    }).catch(() => {});
  }
  const count = changed.length + changedCopies.length;
  const failed = outcomes.filter((o) => o === "failed").length;
  const text =
    count === 0
      ? failed
        ? `Chưa sửa được ${failed} kịch bản.`
        : "Không có kịch bản nào cần sửa."
      : `Đã sửa ${count} kịch bản.${
          changedCopies.length ? " Kịch bản đã có video được sửa trên bản mới." : ""
        }${failed ? ` ${failed} kịch bản chưa sửa được.` : ""}`;
  await say({
    text,
    ...(count
      ? {
          undo: {
            before: changed.map((s) => ({ ...s, status: "ready", mark: null })),
            ...(changedCopies.length ? { added: changedCopies.map((s) => s.id) } : {}),
            undone: false,
          },
        }
      : {}),
  });
}

async function writeCard(
  sessionId: string,
  scriptId: string,
  context?: writer.WriterContext,
): Promise<boolean> {
  scriptsBeingWrittenInThisProcess.add(scriptId);
  try {
    const ctx = context ?? (await writerContext(sessionId));
    const board = await load(sessionId);
    const card = board.scripts.find((s) => s.id === scriptId);
    if (!card) return false;
    const library = (await getWorkspace()).assets;
    let written: writer.WrittenScript;
    if (card.brief.kind === "copy") {
      throw new Error("Bản sao không cần viết");
    } else if (card.brief.kind === "variant") {
      const { sourceId } = card.brief;
      const source = board.scripts.find((s) => s.id === sourceId);
      if (!source?.lines.length) throw new Error("Không còn kịch bản gốc");
      const product = source.productIds[0];
      written = writer.oneProduct(
        await writer.writeVariant(
          writer.withProduct(ctx, product, library),
          source,
          card.brief.direction,
          card.brief.targetSec,
        ),
        product,
      );
    } else {
      const { productId } = card.brief;
      written = writer.oneProduct(
        await writer.writeTopic(
          writer.withProduct(ctx, productId, library),
          card,
          card.brief.direction,
          card.brief.targetSec,
        ),
        productId,
      );
    }
    scriptsBeingWrittenInThisProcess.delete(scriptId);
    await mutateBoard(sessionId, (b) => {
      const s = b.scripts.find((x) => x.id === scriptId);
      if (s) Object.assign(s, written, { status: "ready", updatedAt: now() });
    });
    return true;
  } catch (error) {
    console.error("[board] write failed", error);
    scriptsBeingWrittenInThisProcess.delete(scriptId);
    await mutateBoard(sessionId, (b) => {
      const s = b.scripts.find((x) => x.id === scriptId);
      if (s) s.status = "failed";
    }).catch(() => {});
    return false;
  }
}

export async function variant(
  sessionId: string,
  scriptId: string,
  direction?: string,
): Promise<null> {
  const { ws, session } = await findSession(sessionId);
  const series = ws.series.find((s) => s.id === session.seriesId);
  const fallbackSec = seriesTargetSec(series ?? {});
  const card = newScript({
    brief: {
      kind: "variant",
      sourceId: scriptId,
      ...(direction?.trim() ? { direction: direction.trim() } : {}),
    },
  });
  scriptsBeingWrittenInThisProcess.add(card.id);
  try {
    await mutateBoard(sessionId, (b) => {
      const index = b.scripts.findIndex((s) => s.id === scriptId);
      const source = b.scripts[index];
      if (!source) throw new Error("Không tìm thấy kịch bản");
      clearMarks(b);
      card.mark = "new";
      const sourceSec = source.brief.targetSec ?? fallbackSec;
      card.brief.targetSec = writer.variantLength(direction, sourceSec) ?? sourceSec;
      card.pinned = source.pinned;
      b.scripts.splice(index + 1, 0, card);
    });
  } catch (error) {
    scriptsBeingWrittenInThisProcess.delete(card.id);
    throw error;
  }
  void writeCard(sessionId, card.id);
  return null;
}

export async function retry(sessionId: string, scriptId: string): Promise<null> {
  scriptsBeingWrittenInThisProcess.add(scriptId);
  const ok = await mutateBoard(sessionId, (b) => {
    const s = b.scripts.find((x) => x.id === scriptId);
    if (s?.status !== "failed") return false;
    s.status = "writing";
    return true;
  }).catch(() => false);
  if (ok) void writeCard(sessionId, scriptId);
  else scriptsBeingWrittenInThisProcess.delete(scriptId);
  return null;
}

async function changeBoard(sessionId: string, change: (b: Board) => void): Promise<null> {
  await mutateBoard(sessionId, change);
  return null;
}

export async function copy(sessionId: string, scriptId: string): Promise<string> {
  const { session } = await findSession(sessionId);
  return mutateBoard(sessionId, (b) => {
    const source = b.scripts.find((s) => s.id === scriptId && !s.deletedAt);
    if (!source) throw new Error("Không tìm thấy kịch bản");
    if (!lockedIds(session, b).has(source.id)) throw new Error("Kịch bản này vẫn sửa được");
    clearMarks(b);
    const card = insertCopy(b, source);
    return card.id;
  });
}

export const remove = (sessionId: string, ids: string[]) =>
  changeBoard(sessionId, (b) => {
    for (const s of b.scripts) if (ids.includes(s.id)) s.deletedAt = now();
  });

export const restore = (sessionId: string, ids: string[]) =>
  changeBoard(sessionId, (b) => {
    for (const s of b.scripts) if (ids.includes(s.id)) s.deletedAt = null;
  });

export const pin = (sessionId: string, scriptId: string, pinned: boolean) =>
  changeBoard(sessionId, (b) => {
    const s = b.scripts.find((x) => x.id === scriptId);
    if (s) s.pinned = pinned;
  });

export async function undo(
  sessionId: string,
  messageId: string,
  editable: ReadonlySet<string> = new Set(),
): Promise<string[]> {
  const { session } = await findSession(sessionId);
  return mutateBoard(sessionId, (b) => {
    const locked = new Set([...lockedIds(session, b)].filter((id) => !editable.has(id)));
    const before = b.messages.find((m) => m.id === messageId)?.undo?.before ?? [];
    applyUndo(b, messageId, locked);
    return before.map((s) => s.id).filter((id) => editable.has(id));
  });
}

export async function beginProductChange(
  sessionId: string,
  scriptId: string,
  productId: string | null,
  opts: { copy: boolean; log?: TurnLog },
): Promise<{ before: Script; targetId: string; created: boolean; copied: boolean } | null> {
  return mutateBoard(sessionId, (b) => {
    const s = b.scripts.find((x) => x.id === scriptId && !x.deletedAt);
    if (!s) throw new Error("Không tìm thấy kịch bản");
    if (s.status !== "ready") throw new Error("Kịch bản đang được viết, thử lại sau");
    if ((s.productIds[0] ?? null) === productId && s.productIds.length <= 1) return null;
    const { log } = opts;
    if (!log) clearMarks(b);
    let target = s;
    let created = false;
    if (opts.copy) {
      if (log) {
        const edit = editTarget(b, new Set([s.id]), log, s);
        target = edit.target;
        created = edit.created;
      } else {
        target = insertCopy(b, s);
        target.changeUndo = { copy: true };
        created = true;
      }
    } else if (log) {
      recordTouch(b, log, s);
    } else {
      s.changeUndo = {
        productIds: [...s.productIds],
        lines: structuredClone(s.lines),
        staging: s.staging,
      };
    }
    const before = { ...structuredClone(target), status: "ready" as const };
    target.status = "writing";
    target.changing = "product";
    scriptsBeingWrittenInThisProcess.add(target.id);
    return { before, targetId: target.id, created, copied: opts.copy };
  });
}

export async function finishProductChange(
  sessionId: string,
  targetId: string,
  written: writer.WrittenScript | null,
  opts: { created: boolean; log?: TurnLog },
): Promise<Script | null> {
  scriptsBeingWrittenInThisProcess.delete(targetId);
  return mutateBoard(sessionId, (b) => {
    const s = b.scripts.find((x) => x.id === targetId);
    if (!s) return null;
    s.status = "ready";
    delete s.changing;
    if (written) {
      Object.assign(s, {
        lines: written.lines,
        staging: written.staging,
        productIds: written.productIds,
        mark: "edited",
        updatedAt: now(),
      });
      if (!opts.log) rememberHandEdit(b, s.id);
      return structuredClone(s);
    }
    if (opts.created) {
      if (opts.log) dropCopy(b, opts.log, s);
      else s.deletedAt = now();
    } else if (opts.log) dropTouch(b, opts.log, s.id);
    else delete s.changeUndo;
    return null;
  });
}

export async function editLine(
  sessionId: string,
  scriptId: string,
  edit: LineEdit,
  opts: { copy: boolean },
): Promise<{ scriptId: string; copied: boolean } | null> {
  return mutateBoard(sessionId, (b) => {
    const s = b.scripts.find((x) => x.id === scriptId && !x.deletedAt);
    if (!s) throw new Error("Không tìm thấy kịch bản");
    return applyLineEdit(b, s, edit, { copy: opts.copy, id: randomUUID(), now: now() });
  });
}

export async function removeLine(
  sessionId: string,
  scriptId: string,
  removal: LineRemoval,
  opts: { copy: boolean },
): Promise<{ scriptId: string; copied: boolean }> {
  return mutateBoard(sessionId, (b) => {
    const s = b.scripts.find((x) => x.id === scriptId && !x.deletedAt);
    if (!s) throw new Error("Không tìm thấy kịch bản");
    return applyLineRemoval(b, s, removal, { copy: opts.copy, id: randomUUID(), now: now() });
  });
}

export async function undoChange(
  sessionId: string,
  scriptId: string,
): Promise<{ inPlace: boolean }> {
  return mutateBoard(sessionId, (b) => {
    const s = b.scripts.find((x) => x.id === scriptId && !x.deletedAt);
    const undo = s?.changeUndo;
    if (!s || !undo) throw new Error("Không còn gì để hoàn tác");
    if (s.status === "writing") throw new Error("Kịch bản đang được viết, thử lại sau");
    delete s.changeUndo;
    if (undo.copy) {
      s.deletedAt = now();
      return { inPlace: false };
    }
    Object.assign(s, {
      productIds: undo.productIds,
      lines: undo.lines,
      staging: undo.staging,
      mark: null,
      updatedAt: now(),
    });
    rememberHandEdit(b, s.id);
    return { inPlace: true };
  });
}

export async function orderedScripts(sessionId: string): Promise<Script[]> {
  return boardOrder((await load(sessionId)).scripts);
}

export async function agentUpdate(
  sessionId: string,
  scriptId: string,
  patch: Partial<Pick<Script, "title" | "hook" | "lines" | "productIds" | "staging">>,
  log: TurnLog,
): Promise<{ script: Script; copied: boolean }> {
  const { session } = await findSession(sessionId);
  return mutateBoard(sessionId, (b) => {
    const s = b.scripts.find((x) => x.id === scriptId && !x.deletedAt);
    if (!s) throw new Error("Không tìm thấy kịch bản");
    if (s.status !== "ready") throw new Error("Kịch bản đang được viết, thử lại sau");
    const { target, copied } = editTarget(b, lockedIds(session, b), log, s);
    if (!copied) recordTouch(b, log, target);
    Object.assign(target, patch, { mark: "edited", changeUndo: undefined, updatedAt: now() });
    return { script: structuredClone(target), copied };
  });
}

export async function agentCopy(
  sessionId: string,
  scriptId: string,
  log: TurnLog,
): Promise<Script> {
  return mutateBoard(sessionId, (b) => {
    const source = b.scripts.find((x) => x.id === scriptId && !x.deletedAt);
    if (!source) throw new Error("Không tìm thấy kịch bản");
    if (source.status !== "ready" || source.changing) {
      throw new Error("Kịch bản đang được viết, thử lại sau");
    }
    const copy = insertCopy(b, source);
    delete copy.changeUndo;
    const undoState = turnUndo(b, log);
    if (undoState) undoState.added = [...(undoState.added ?? []), copy.id];
    log.touched.add(copy.id);
    return structuredClone(copy);
  });
}

export type LengthSet =
  | { scriptId: string; outcome: "set" | "same"; script: Script; copied: boolean }
  | { scriptId: string; outcome: "writing" };

export async function agentSetLength(
  sessionId: string,
  scriptIds: string[],
  targetSec: number,
  log: TurnLog,
): Promise<LengthSet[]> {
  const { ws, session } = await findSession(sessionId);
  const fallbackSec = seriesTargetSec(ws.series.find((s) => s.id === session.seriesId) ?? {});
  return mutateBoard(sessionId, (b) => {
    const locked = lockedIds(session, b);
    return scriptIds.map((scriptId): LengthSet => {
      const s = b.scripts.find((x) => x.id === scriptId && !x.deletedAt);
      if (!s) throw new Error("Không tìm thấy kịch bản");
      if (s.status !== "ready" || s.changing) return { scriptId, outcome: "writing" };
      if ((s.brief.targetSec ?? fallbackSec) === targetSec) {
        return { scriptId, outcome: "same", script: structuredClone(s), copied: false };
      }
      const { target, copied } = editTarget(b, locked, log, s);
      if (!copied) recordTouch(b, log, target);
      Object.assign(target, {
        brief: { ...target.brief, targetSec },
        mark: "edited",
        changeUndo: undefined,
        updatedAt: now(),
      });
      return { scriptId, outcome: "set", script: structuredClone(target), copied };
    });
  });
}

export async function agentAdd(
  sessionId: string,
  plan: {
    topics: (writer.Topic & { productId?: string | null })[];
    direction: string;
    targetSec: number | null;
  },
  log: TurnLog,
): Promise<{ written: Script[]; failed: number }> {
  const ctx = await writerContext(sessionId);
  const products = await topicProducts(
    sessionId,
    await load(sessionId),
    plan.topics.map((t) => t.productId),
  );
  const cards = plan.topics.map((t, i) =>
    newScript({
      title: t.title,
      hook: t.hook,
      brief: {
        kind: "topic",
        ...(plan.direction ? { direction: plan.direction } : {}),
        ...(products[i] !== undefined ? { productId: products[i] } : {}),
        targetSec: plan.targetSec ?? ctx.targetSec,
      },
    }),
  );
  for (const c of cards) scriptsBeingWrittenInThisProcess.add(c.id);
  await mutateBoard(sessionId, (b) => {
    if (!b.scripts.some((s) => !s.deletedAt)) for (const c of cards) c.mark = null;
    b.scripts.push(...cards);
    const undoState = turnUndo(b, log);
    if (undoState) undoState.added = [...(undoState.added ?? []), ...cards.map((c) => c.id)];
    for (const c of cards) log.touched.add(c.id);
  });
  const results = await Promise.all(cards.map((c) => writeCard(sessionId, c.id, ctx)));
  const board = await load(sessionId);
  const written = cards.flatMap((c, i) =>
    results[i] ? (board.scripts.find((s) => s.id === c.id) ?? []) : [],
  );
  return { written, failed: results.filter((ok) => !ok).length };
}

export async function agentRewrite(
  sessionId: string,
  targets: Script[],
  instruction: string,
  targetSec: number | null,
  log: TurnLog,
): Promise<{ changed: Script[]; same: number; failed: number; copied: number }> {
  const { session } = await findSession(sessionId);
  const ctx = await writerContext(sessionId);
  const ready = targets.filter((s) => s.status === "ready");
  const fresh = new Set<string>();
  const copies = new Set<string>();
  const created = new Set<string>();
  const chosen = await mutateBoard(sessionId, (b) => {
    const locked = lockedIds(session, b);
    const list: Script[] = [];
    for (const before of ready) {
      const s = b.scripts.find((x) => x.id === before.id);
      if (s?.status !== "ready") continue;
      const edit = editTarget(b, locked, log, s);
      const target = edit.target;
      if (edit.created) created.add(target.id);
      if (edit.copied) copies.add(target.id);
      else if (recordTouch(b, log, target)) fresh.add(target.id);
      target.status = "writing";
      scriptsBeingWrittenInThisProcess.add(target.id);
      list.push({ ...structuredClone(target), status: "ready" });
    }
    return list;
  });
  const outcomes = await Promise.all(
    chosen.map(async (before) => {
      let written: writer.WrittenScript | null = null;
      let failed = false;
      try {
        written = await writer.revise(ctx, before, instruction, targetSec);
      } catch (error) {
        console.error("[board] agent rewrite failed", error);
        failed = true;
      }
      scriptsBeingWrittenInThisProcess.delete(before.id);
      return mutateBoard(sessionId, (b) => {
        const s = b.scripts.find((x) => x.id === before.id);
        if (!s) return { outcome: "failed" as const };
        s.status = "ready";
        if (!written) {
          if (fresh.has(s.id)) dropTouch(b, log, s.id);
          if (created.has(s.id)) dropCopy(b, log, s);
          return { outcome: failed ? ("failed" as const) : ("same" as const) };
        }
        Object.assign(s, written, { mark: "edited", changeUndo: undefined, updatedAt: now() });
        if (targetSec) s.brief = { ...s.brief, targetSec };
        return { outcome: "changed" as const, script: structuredClone(s) };
      }).catch(() => ({ outcome: "failed" as const }));
    }),
  );
  return {
    changed: outcomes.flatMap((o) => ("script" in o && o.script ? o.script : [])),
    same: outcomes.filter((o) => o.outcome === "same").length,
    failed: outcomes.filter((o) => o.outcome === "failed").length,
    copied: [...copies].filter((id) => outcomes.some((o) => "script" in o && o.script?.id === id))
      .length,
  };
}

export async function agentDelete(
  sessionId: string,
  scriptIds: string[],
  log: TurnLog,
): Promise<string[]> {
  const { session } = await findSession(sessionId);
  return mutateBoard(sessionId, (b) => {
    const locked = lockedIds(session, b);
    const kept: string[] = [];
    for (const s of b.scripts) {
      if (!scriptIds.includes(s.id) || s.deletedAt || s.status === "writing") continue;
      if (locked.has(s.id)) {
        kept.push(s.id);
        continue;
      }
      recordTouch(b, log, s);
      s.deletedAt = now();
    }
    return kept;
  });
}

export async function assertApprovable(sessionId: string): Promise<void> {
  const board = await load(sessionId);
  if (board.messages.some((m) => m.pending)) throw new Error("Đang làm yêu cầu trong khung chat");
  const scripts = boardOrder(board.scripts);
  if (scripts.length === 0) throw new Error("Chưa có kịch bản");
  if (scripts.some((s) => s.status === "writing")) throw new Error("Đang viết kịch bản");
  if (!scripts.some((s) => s.status === "ready")) throw new Error("Chưa có kịch bản viết xong");
}

export async function scriptsToCommit(sessionId: string, ids?: string[]): Promise<string[]> {
  const { ws, session } = await findSession(sessionId);
  if (!session.approvedAt) await assertApprovable(sessionId);
  const board = await load(sessionId);
  const done = committedIds(session, board.scripts);
  const open = finishedScripts(board.scripts).filter((s) => !done.includes(s.id));
  const chosen = ids ? open.filter((s) => ids.includes(s.id)) : open;
  if (ids && chosen.length !== new Set(ids).size)
    throw new Error("Kịch bản này không làm video được");
  const fallbackSec = seriesTargetSec(ws.series.find((s) => s.id === session.seriesId) ?? {});
  if (chosen.some((s) => checkScript(s, ws.assets, fallbackSec).blockers.length)) {
    throw new Error("Có kịch bản cần sửa trước khi tạo video");
  }
  if (chosen.length === 0) throw new Error("Không còn kịch bản nào để tạo video");
  return chosen.map((s) => s.id);
}

export async function linkSpeaker(
  sessionId: string,
  speaker: string,
  characterId: string,
): Promise<null> {
  const { ws, session } = await findSession(sessionId);
  const character = ws.assets.find((a) => a.id === characterId && a.kind === "character");
  if (!character) throw new Error("Không tìm thấy nhân vật");
  const key = speaker.trim().toLocaleLowerCase("vi");
  await mutateBoard(sessionId, (board) => {
    const done = committedIds(session, board.scripts);
    for (const script of board.scripts) {
      if (done.includes(script.id) || script.status !== "ready") continue;
      let changed = false;
      for (const line of script.lines) {
        const known = line.characterId && ws.assets.some((a) => a.id === line.characterId);
        if (known || line.speaker.trim().toLocaleLowerCase("vi") !== key) continue;
        line.characterId = character.id;
        line.speaker = character.name;
        changed = true;
      }
      if (changed) {
        script.updatedAt = now();
        delete script.changeUndo;
      }
    }
  });
  return null;
}
