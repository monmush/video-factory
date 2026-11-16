import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BrowserWindow } from "electron";
import { boardOrder, DEFAULT_TARGET_SEC } from "../shared/board";
import {
  type Board,
  type ChatMessage,
  resolveChoice,
  type Script,
  type Session,
} from "../shared/ipc";
import { assignProducts } from "../shared/product-mix";
import { checkScript, committedIds, finishedScripts } from "../shared/ready-check";
import { copyScript } from "../shared/versions";
import { applyUndo, dropTouch, recordTouch, type TurnLog, turnUndo } from "./board-undo";
import { mediaDir, writeJsonAtomic } from "./paths";
import * as writer from "./script-writer";
import { readSettings } from "./settings";
import { getWorkspace } from "./store";

export type { TurnLog };

// A session's script board and chat, saved as board.json in the session's
// folder. The main process owns all writing work, so it keeps running when the
// operator leaves the screen; every change is pushed to the renderer with
// "board:changed". Work stops if the app quits: on the next start, interrupted
// cards become "failed" (with "Thử lại") or keep their previous text.
// Rules: docs/SCRIPT_BOARD_DECISIONS.md.

const FILE = "board.json";
const cache = new Map<string, Board>();
// One file read per session at a time. Two overlapping cold reads could
// otherwise finish after a write and put the older board back in the cache.
const reading = new Map<string, Promise<Board>>();
const queues = new Map<string, Promise<unknown>>();
// Work running in this process. Anything else marked as writing was interrupted.
const runningScripts = new Set<string>();
/** Assistant messages whose turn is running in this process (pipeline or agent). */
export const runningRequests = new Set<string>();

export const now = () => new Date().toISOString();
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function findSession(sessionId: string) {
  const ws = await getWorkspace();
  const session = ws.sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error("Không tìm thấy phiên này");
  return { ws, session };
}

/**
 * Scripts sent to video. They never change; edits go to a new version
 * (docs/VIDEO_COMMIT_DECISIONS.md, "Moving between Kịch bản and Video").
 */
const lockedIds = (session: Session, board: Board) => new Set(committedIds(session, board.scripts));

/** Ids of the session's scripts sent to video. */
export async function sentScriptIds(sessionId: string): Promise<Set<string>> {
  const { session } = await findSession(sessionId);
  return lockedIds(session, await load(sessionId));
}

/** Inserts a new version of `source` after its chain and returns it. */
function insertCopy(b: Board, source: Script): Script {
  const { copy, index } = copyScript(b.scripts, source, { id: randomUUID(), now: now() });
  b.scripts.splice(index, 0, copy);
  return copy;
}

/**
 * The script an agent edit should change: the script itself, or for one sent
 * to video, its new version in this turn (made on first use and recorded as
 * added, so the turn's undo removes it).
 */
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

/** Takes back a version this turn made when it turned out identical. */
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
  let pending = reading.get(sessionId);
  if (!pending) {
    pending = read(sessionId).finally(() => reading.delete(sessionId));
    reading.set(sessionId, pending);
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
    // A new session: the request typed on the series page opens the chat.
    board = {
      version: 1,
      scripts: [],
      messages: session.request
        ? [{ id: randomUUID(), role: "user", text: session.request, at: session.createdAt }]
        : [],
    };
  }
  for (const s of board.scripts) {
    if (s.status === "writing" && !runningScripts.has(s.id)) {
      s.status = s.lines.length ? "ready" : "failed";
    }
  }
  for (const m of board.messages) {
    if (m.pending && !runningRequests.has(m.id)) {
      m.pending = false;
      if (m.parts) m.outcome = "stopped";
      else m.text ||= "Đã dừng giữa chừng.";
    }
    // Queued behind a turn when the app quit: never sent.
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

/** Serialised per session, like the workspace store. */
export function mutateBoard<T>(sessionId: string, change: (board: Board) => T): Promise<T> {
  const run = (queues.get(sessionId) ?? Promise.resolve()).then(async () => {
    // Throws once the session is deleted, so late results never recreate its folder.
    const { session } = await findSession(sessionId);
    const board = structuredClone(await load(sessionId));
    const result = change(board);
    await writeJsonAtomic(join(mediaDir(session.seriesId, session.id), FILE), board);
    cache.set(sessionId, board);
    broadcast(sessionId, board);
    return result;
  });
  queues.set(
    sessionId,
    run.catch(() => undefined),
  );
  return run;
}

export async function getBoard(sessionId: string): Promise<Board> {
  return structuredClone(await load(sessionId));
}

/** Most recent series titles the writer is told to avoid repeating. */
const MAX_AVOID = 80;

/**
 * Names of approved sessions whose scripts use an asset. Videos are made from
 * approved scripts, so their characters and products must not disappear.
 */
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

/** The last model chosen in any chat; sessions without their own choice use it. */
const readChoice = () => {
  const settings = readSettings();
  return { model: settings.chatModel, effort: settings.chatEffort };
};

export async function writerContext(sessionId: string): Promise<writer.WriterContext> {
  const { ws, session } = await findSession(sessionId);
  const series = ws.series.find((s) => s.id === session.seriesId);
  if (!series) throw new Error("Không tìm thấy series");
  const pick = (ids: string[]) => ids.flatMap((id) => ws.assets.find((a) => a.id === id) ?? []);
  // Recent titles in the series, so new stories do not repeat old ones. Capped
  // so prompts stay small as the series grows (sessions are newest first).
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
  return {
    sessionId,
    model: choice.model,
    effort: choice.effort,
    guidance: series.guidance,
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

/** Marks show what the latest request did; a new request starts clean (and so does a card's undo). */
export function clearMarks(board: Board) {
  for (const s of board.scripts) {
    s.mark = null;
    delete s.productUndo;
  }
}

/**
 * Products for new topic cards (docs/SCRIPT_BOARD_DECISIONS.md, "Product per
 * video"): one named for a topic is kept; the others follow the batch's mix
 * and what the board already has. Undefined: the writer chooses.
 */
async function topicProducts(
  sessionId: string,
  b: Board,
  named: readonly (string | null | undefined)[],
): Promise<(string | null | undefined)[]> {
  const { session } = await findSession(sessionId);
  const onBoard = boardOrder(b.scripts)
    .filter((s) => s.status !== "failed")
    .map((s) => s.productIds[0] ?? null);
  const given = named.filter((p): p is string | null => p !== undefined);
  const assigned = assignProducts(
    session.settings?.productMix,
    [...onBoard, ...given],
    named.filter((p) => p === undefined).length,
  );
  let next = 0;
  return named.map((p) => (p !== undefined ? p : assigned[next++]));
}

// ---------------------------------------------------------------- chat requests

/** fal pipeline: add scripts, edit in place, or answer. Returns once the message is on the board. */
export async function send(sessionId: string, text: string, refs: string[]): Promise<null> {
  const clean = text.trim();
  if (!clean) return null;
  await begin(sessionId, clean, refs, true);
  return null;
}

/** fal pipeline: starts the request typed on the series page, already the board's first message. */
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
    else if (decision.action === "add") await addScripts(sessionId, ctx, decision, say);
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

/** Topic cards appear first; dialogue is written into each in parallel. */
async function addScripts(
  sessionId: string,
  ctx: writer.WriterContext,
  plan: Extract<writer.Route, { action: "add" }>,
  say: Say,
) {
  const cards = plan.topics.map((t) =>
    newScript({
      title: t.title,
      hook: t.hook,
      brief: {
        kind: "topic",
        ...(plan.direction ? { direction: plan.direction } : {}),
        targetSec: plan.targetSec ?? DEFAULT_TARGET_SEC,
      },
    }),
  );
  for (const c of cards) runningScripts.add(c.id);
  const products = await topicProducts(
    sessionId,
    await load(sessionId),
    cards.map(() => undefined),
  );
  cards.forEach((c, i) => {
    if (products[i] !== undefined && c.brief.kind === "topic") c.brief.productId = products[i];
  });
  await mutateBoard(sessionId, (b) => {
    // "Mới" only tells later additions apart; a session's first batch is all new.
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

/** Chat edits change scripts in place; one undo restores them all. */
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
  // Scripts sent to video are edited on a new version (a fresh copy each).
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
    for (const id of ids) runningScripts.add(id);
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
        written = await writer.revise(
          ctx,
          before,
          plan.instruction,
          plan.targetSec ?? before.brief.targetSec ?? DEFAULT_TARGET_SEC,
        );
        outcome = written ? "changed" : "same";
      } catch (error) {
        console.error("[board] revise failed", error);
      }
      runningScripts.delete(before.id);
      await mutateBoard(sessionId, (b) => {
        const s = b.scripts.find((x) => x.id === before.id);
        if (!s) return;
        if (written)
          Object.assign(s, written, { mark: "edited", productUndo: undefined, updatedAt: now() });
        // A stated length sticks, so later variants of this script keep it.
        if (written && plan.targetSec) s.brief = { ...s.brief, targetSec: plan.targetSec };
        s.status = "ready";
      }).catch(() => {});
      return outcome;
    }),
  );

  // Copies are new cards: undo removes them rather than restoring them.
  const changed = chosen.filter((s, i) => outcomes[i] === "changed" && !copies.includes(s.id));
  const changedCopies = chosen.filter((s, i) => outcomes[i] === "changed" && copies.includes(s.id));
  const unchangedCopies = chosen.filter(
    (s, i) => outcomes[i] !== "changed" && copies.includes(s.id),
  );
  // A copy that did not change is only a duplicate: take it away again.
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

/** Writes dialogue into a topic or variant card. Returns false if it failed. */
async function writeCard(
  sessionId: string,
  scriptId: string,
  context?: writer.WriterContext,
): Promise<boolean> {
  runningScripts.add(scriptId);
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
      // A variant features its source's product.
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
      // The product given to the topic (the batch's mix or the chat), else the writer's choice.
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
    runningScripts.delete(scriptId);
    await mutateBoard(sessionId, (b) => {
      const s = b.scripts.find((x) => x.id === scriptId);
      if (s) Object.assign(s, written, { status: "ready", updatedAt: now() });
    });
    return true;
  } catch (error) {
    console.error("[board] write failed", error);
    runningScripts.delete(scriptId);
    await mutateBoard(sessionId, (b) => {
      const s = b.scripts.find((x) => x.id === scriptId);
      if (s) s.status = "failed";
    }).catch(() => {});
    return false;
  }
}

// ---------------------------------------------------------------- card actions

/** A new independent script directly after its source. */
export async function variant(
  sessionId: string,
  scriptId: string,
  direction?: string,
): Promise<null> {
  const card = newScript({
    brief: {
      kind: "variant",
      sourceId: scriptId,
      ...(direction?.trim() ? { direction: direction.trim() } : {}),
    },
  });
  runningScripts.add(card.id);
  try {
    await mutateBoard(sessionId, (b) => {
      const index = b.scripts.findIndex((s) => s.id === scriptId);
      const source = b.scripts[index];
      if (!source) throw new Error("Không tìm thấy kịch bản");
      clearMarks(b);
      card.mark = "new";
      // Variants keep the source's length.
      card.brief.targetSec = source.brief.targetSec ?? DEFAULT_TARGET_SEC;
      // A pinned source keeps its variant beside it in the pinned group.
      card.pinned = source.pinned;
      b.scripts.splice(index + 1, 0, card);
    });
  } catch (error) {
    runningScripts.delete(card.id);
    throw error;
  }
  void writeCard(sessionId, card.id);
  return null;
}

export async function retry(sessionId: string, scriptId: string): Promise<null> {
  runningScripts.add(scriptId);
  const ok = await mutateBoard(sessionId, (b) => {
    const s = b.scripts.find((x) => x.id === scriptId);
    if (s?.status !== "failed") return false;
    s.status = "writing";
    return true;
  }).catch(() => false);
  if (ok) void writeCard(sessionId, scriptId);
  else runningScripts.delete(scriptId);
  return null;
}

async function changeBoard(sessionId: string, change: (b: Board) => void): Promise<null> {
  await mutateBoard(sessionId, change);
  return null;
}

/**
 * "Sửa" on a script sent to video: a new version after its chain, ready to
 * edit through the chat and made into its own video. Returns its id.
 */
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

/**
 * Restores every script a chat turn changed, and removes the scripts it added.
 * `editable`: scripts sent to video whose video has not started, which may
 * still change (a product change edits them in place); returns the ones of
 * those it restored, whose plan no longer fits.
 */
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

// ---------------------------------------------------------------- product per video

/**
 * Starts a product change on one ready script (src/main/product-change.ts):
 * on the script itself, or on a new version when `copy` (its video has
 * started). Saves what undo needs in the same write: the chat turn's log, or
 * on the card. Returns the script as the writer should revise it, or null
 * when it already has that product.
 */
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
        target.productUndo = { copy: true };
        created = true;
      }
    } else if (log) {
      recordTouch(b, log, s);
    } else {
      s.productUndo = {
        productIds: [...s.productIds],
        lines: structuredClone(s.lines),
        staging: s.staging,
      };
    }
    const before = { ...structuredClone(target), status: "ready" as const };
    target.status = "writing";
    target.changing = "product";
    runningScripts.add(target.id);
    return { before, targetId: target.id, created, copied: opts.copy };
  });
}

/** Ends a product change: the revised lines and staging, or the script as it was when writing failed. */
export async function finishProductChange(
  sessionId: string,
  targetId: string,
  written: writer.WrittenScript | null,
  opts: { created: boolean; log?: TurnLog },
): Promise<Script | null> {
  runningScripts.delete(targetId);
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
      return structuredClone(s);
    }
    if (opts.created) {
      if (opts.log) dropCopy(b, opts.log, s);
      else s.deletedAt = now();
    } else if (opts.log) dropTouch(b, opts.log, s.id);
    else delete s.productUndo;
    return null;
  });
}

/** "Hoàn tác" on a card after a product change: its product, lines and staging back, or the new version gone. */
export async function undoProductChange(
  sessionId: string,
  scriptId: string,
): Promise<{ inPlace: boolean }> {
  return mutateBoard(sessionId, (b) => {
    const s = b.scripts.find((x) => x.id === scriptId && !x.deletedAt);
    const undo = s?.productUndo;
    if (!s || !undo) throw new Error("Không còn gì để hoàn tác");
    if (s.status === "writing") throw new Error("Kịch bản đang được viết, thử lại sau");
    delete s.productUndo;
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
    return { inPlace: true };
  });
}

// ---------------------------------------------------------------- agent turns

/** Scripts in the numbering the operator sees (#1, #2…). */
export async function orderedScripts(sessionId: string): Promise<Script[]> {
  return boardOrder((await load(sessionId)).scripts);
}

/**
 * Replaces fields of one ready script, written by the agent itself. A script
 * sent to video is left alone and the edit goes to its new version;
 * `copied` says so.
 */
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
    Object.assign(target, patch, { mark: "edited", productUndo: undefined, updatedAt: now() });
    return { script: structuredClone(target), copied };
  });
}

/** Topic cards appear at once; dialogue is written into each in parallel. */
export async function agentAdd(
  sessionId: string,
  plan: {
    /** `productId`: the product named for that topic (null: none); missing: the batch's mix. */
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
        targetSec: plan.targetSec ?? DEFAULT_TARGET_SEC,
      },
    }),
  );
  for (const c of cards) runningScripts.add(c.id);
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

/**
 * Rewrites several scripts in parallel with the script writer, in place.
 * Scripts sent to video are rewritten on their new version (`copied` counts them).
 */
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
      runningScripts.add(target.id);
      list.push({ ...structuredClone(target), status: "ready" });
    }
    return list;
  });
  const outcomes = await Promise.all(
    chosen.map(async (before) => {
      let written: writer.WrittenScript | null = null;
      let failed = false;
      try {
        written = await writer.revise(
          ctx,
          before,
          instruction,
          targetSec ?? before.brief.targetSec ?? DEFAULT_TARGET_SEC,
        );
      } catch (error) {
        console.error("[board] agent rewrite failed", error);
        failed = true;
      }
      runningScripts.delete(before.id);
      return mutateBoard(sessionId, (b) => {
        const s = b.scripts.find((x) => x.id === before.id);
        if (!s) return { outcome: "failed" as const };
        s.status = "ready";
        if (!written) {
          if (fresh.has(s.id)) dropTouch(b, log, s.id);
          if (created.has(s.id)) dropCopy(b, log, s);
          return { outcome: failed ? ("failed" as const) : ("same" as const) };
        }
        Object.assign(s, written, { mark: "edited", productUndo: undefined, updatedAt: now() });
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

/**
 * Deletes scripts for the agent. Scripts sent to video stay: deleting one
 * removes a paid video from view, so only the operator does that. Returns
 * the ids it left alone.
 */
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

/** Approval needs at least one finished script and nothing still being written. */
export async function assertApprovable(sessionId: string): Promise<void> {
  const board = await load(sessionId);
  // The chat could still change or add scripts after approval.
  if (board.messages.some((m) => m.pending)) throw new Error("Đang làm yêu cầu trong khung chat");
  const scripts = boardOrder(board.scripts);
  if (scripts.length === 0) throw new Error("Chưa có kịch bản");
  if (scripts.some((s) => s.status === "writing")) throw new Error("Đang viết kịch bản");
  if (!scripts.some((s) => s.status === "ready")) throw new Error("Chưa có kịch bản viết xong");
}

/**
 * The scripts an approval commits: the given ones, or every finished one.
 * Refuses scripts already committed, unfinished or blocked (the ready check
 * shows why), so nothing is ever committed twice.
 */
export async function scriptsToCommit(sessionId: string, ids?: string[]): Promise<string[]> {
  const { ws, session } = await findSession(sessionId);
  if (!session.approvedAt) await assertApprovable(sessionId);
  const board = await load(sessionId);
  const done = committedIds(session, board.scripts);
  const open = finishedScripts(board.scripts).filter((s) => !done.includes(s.id));
  const chosen = ids ? open.filter((s) => ids.includes(s.id)) : open;
  if (ids && chosen.length !== new Set(ids).size)
    throw new Error("Kịch bản này không làm video được");
  if (chosen.some((s) => checkScript(s, ws.assets).blockers.length)) {
    throw new Error("Có kịch bản cần sửa trước khi tạo video");
  }
  if (chosen.length === 0) throw new Error("Không còn kịch bản nào để tạo video");
  return chosen.map((s) => s.id);
}

/**
 * Lines spoken by `speaker` that match no library character go to
 * `characterId`. Committed scripts never change.
 */
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
        delete script.productUndo;
      }
    }
  });
  return null;
}
