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

export function assertEditable(session: Session) {
  if (session.approvedAt) throw new Error("Kịch bản đã chốt để làm video");
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

/** Marks show what the latest request did; a new request starts clean. */
export function clearMarks(board: Board) {
  for (const s of board.scripts) s.mark = null;
}

// ---------------------------------------------------------------- chat requests

/** fal pipeline: add scripts, edit in place, or answer. Returns once the message is on the board. */
export async function send(sessionId: string, text: string, refs: string[]): Promise<null> {
  const clean = text.trim();
  if (!clean) return null;
  const { session } = await findSession(sessionId);
  assertEditable(session);
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
  const chosen = targets.filter((s) => s.status === "ready");
  if (chosen.length === 0) {
    await say({ text: "Chưa có kịch bản nào để sửa." });
    return;
  }
  const ids = new Set(chosen.map((s) => s.id));
  for (const id of ids) runningScripts.add(id);
  await mutateBoard(sessionId, (b) => {
    for (const s of b.scripts) if (ids.has(s.id)) s.status = "writing";
    const reply = b.messages.at(-1);
    if (reply?.pending) reply.text = `Đang sửa ${chosen.length} kịch bản…`;
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
        if (written) Object.assign(s, written, { mark: "edited", updatedAt: now() });
        // A stated length sticks, so later variants of this script keep it.
        if (written && plan.targetSec) s.brief = { ...s.brief, targetSec: plan.targetSec };
        s.status = "ready";
      }).catch(() => {});
      return outcome;
    }),
  );

  const changed = chosen.filter((_, i) => outcomes[i] === "changed");
  const failed = outcomes.filter((o) => o === "failed").length;
  const text =
    changed.length === 0
      ? failed
        ? `Chưa sửa được ${failed} kịch bản.`
        : "Không có kịch bản nào cần sửa."
      : `Đã sửa ${changed.length} kịch bản.${failed ? ` ${failed} kịch bản chưa sửa được.` : ""}`;
  await say({
    text,
    ...(changed.length
      ? {
          undo: {
            before: changed.map((s) => ({ ...s, status: "ready", mark: null })),
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
    let written: writer.WrittenScript;
    if (card.brief.kind === "variant") {
      const { sourceId } = card.brief;
      const source = board.scripts.find((s) => s.id === sourceId);
      if (!source?.lines.length) throw new Error("Không còn kịch bản gốc");
      written = await writer.writeVariant(ctx, source, card.brief.direction, card.brief.targetSec);
    } else {
      written = await writer.writeTopic(ctx, card, card.brief.direction, card.brief.targetSec);
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
  const { session } = await findSession(sessionId);
  assertEditable(session);
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
  const { session } = await findSession(sessionId);
  assertEditable(session);
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
  const { session } = await findSession(sessionId);
  assertEditable(session);
  await mutateBoard(sessionId, change);
  return null;
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

/** Restores every script a chat turn changed, and removes the scripts it added. */
export const undo = (sessionId: string, messageId: string) =>
  changeBoard(sessionId, (b) => applyUndo(b, messageId));

// ---------------------------------------------------------------- agent turns

/** Scripts in the numbering the operator sees (#1, #2…). */
export async function orderedScripts(sessionId: string): Promise<Script[]> {
  return boardOrder((await load(sessionId)).scripts);
}

async function editableSession(sessionId: string) {
  const { session } = await findSession(sessionId);
  assertEditable(session);
}

/** Replaces fields of one ready script, written by the agent itself. */
export async function agentUpdate(
  sessionId: string,
  scriptId: string,
  patch: Partial<Pick<Script, "title" | "hook" | "lines" | "productIds" | "staging">>,
  log: TurnLog,
): Promise<Script> {
  await editableSession(sessionId);
  return mutateBoard(sessionId, (b) => {
    const s = b.scripts.find((x) => x.id === scriptId && !x.deletedAt);
    if (!s) throw new Error("Không tìm thấy kịch bản");
    if (s.status !== "ready") throw new Error("Kịch bản đang được viết, thử lại sau");
    recordTouch(b, log, s);
    Object.assign(s, patch, { mark: "edited", updatedAt: now() });
    return structuredClone(s);
  });
}

/** Topic cards appear at once; dialogue is written into each in parallel. */
export async function agentAdd(
  sessionId: string,
  plan: { topics: writer.Topic[]; direction: string; targetSec: number | null },
  log: TurnLog,
): Promise<{ written: Script[]; failed: number }> {
  await editableSession(sessionId);
  const ctx = await writerContext(sessionId);
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

/** Rewrites several scripts in parallel with the script writer, in place. */
export async function agentRewrite(
  sessionId: string,
  targets: Script[],
  instruction: string,
  targetSec: number | null,
  log: TurnLog,
): Promise<{ changed: Script[]; same: number; failed: number }> {
  await editableSession(sessionId);
  const ctx = await writerContext(sessionId);
  const chosen = targets.filter((s) => s.status === "ready");
  const ids = new Set(chosen.map((s) => s.id));
  const fresh = new Set<string>();
  for (const id of ids) runningScripts.add(id);
  await mutateBoard(sessionId, (b) => {
    for (const s of b.scripts) {
      if (!ids.has(s.id)) continue;
      if (recordTouch(b, log, s)) fresh.add(s.id);
      s.status = "writing";
    }
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
          return { outcome: failed ? ("failed" as const) : ("same" as const) };
        }
        Object.assign(s, written, { mark: "edited", updatedAt: now() });
        if (targetSec) s.brief = { ...s.brief, targetSec };
        return { outcome: "changed" as const, script: structuredClone(s) };
      }).catch(() => ({ outcome: "failed" as const }));
    }),
  );
  return {
    changed: outcomes.flatMap((o) => ("script" in o && o.script ? o.script : [])),
    same: outcomes.filter((o) => o.outcome === "same").length,
    failed: outcomes.filter((o) => o.outcome === "failed").length,
  };
}

export async function agentDelete(sessionId: string, scriptIds: string[], log: TurnLog) {
  await editableSession(sessionId);
  await mutateBoard(sessionId, (b) => {
    for (const s of b.scripts) {
      if (!scriptIds.includes(s.id) || s.deletedAt || s.status === "writing") continue;
      recordTouch(b, log, s);
      s.deletedAt = now();
    }
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
