import type { Board, Script } from "../shared/ipc";

const now = () => new Date().toISOString();

export interface TurnLog {
  messageId: string;
  touched: Set<string>;
  copies?: Map<string, string>;
}

const undoTargets = (undo: NonNullable<Board["messages"][number]["undo"]>) =>
  new Set([...undo.before.map((s) => s.id), ...(undo.added ?? [])]);

export function applyUndo(b: Board, messageId: string, locked: ReadonlySet<string> = new Set()) {
  const index = b.messages.findIndex((x) => x.id === messageId);
  const m = b.messages[index];
  if (!m?.undo || m.undo.undone) return;
  const targets = undoTargets(m.undo);
  const later = b.messages
    .slice(index + 1)
    .some(
      (x) => x.undo && !x.undo.undone && [...undoTargets(x.undo)].some((id) => targets.has(id)),
    );
  if (later) throw new Error("Hãy hoàn tác thay đổi mới hơn trên các kịch bản này trước");
  if ([...targets].some((id) => locked.has(id))) {
    throw new Error("Kịch bản đã gửi làm video nên không hoàn tác được");
  }
  for (const before of m.undo.before) {
    const s = b.scripts.find((x) => x.id === before.id);
    if (!s || s.status === "writing") continue;
    Object.assign(s, {
      title: before.title,
      hook: before.hook,
      lines: before.lines,
      productIds: before.productIds,
      staging: before.staging,
      deletedAt: before.deletedAt,
      mark: null,
      updatedAt: now(),
    });
  }
  for (const id of m.undo.added ?? []) {
    const s = b.scripts.find((x) => x.id === id);
    if (s && s.status !== "writing") s.deletedAt = now();
  }
  m.undo.undone = true;
}

export function turnUndo(b: Board, log: TurnLog) {
  const m = b.messages.find((x) => x.id === log.messageId);
  if (!m) return null;
  m.undo ??= { before: [], undone: false };
  return m.undo;
}

export function recordTouch(b: Board, log: TurnLog, script: Script) {
  const undoState = turnUndo(b, log);
  if (!undoState || log.touched.has(script.id)) return false;
  log.touched.add(script.id);
  undoState.before.push({ ...structuredClone(script), status: "ready", mark: null });
  return true;
}

export function dropTouch(b: Board, log: TurnLog, id: string) {
  const undoState = turnUndo(b, log);
  if (!undoState) return;
  undoState.before = undoState.before.filter((s) => s.id !== id);
  log.touched.delete(id);
}
