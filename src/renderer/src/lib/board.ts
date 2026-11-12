import type { Board } from "@shared/ipc";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { api } from "./api";

// Session boards as last pushed by the main process ("board:changed"), plus
// view state the board and the chat panel share (chat references, layout). The
// view state lives for as long as the app runs, like drafts.

const boards = new Map<string, Board>();
const loading = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

api.on("board:changed", ({ sessionId, board }) => {
  boards.set(sessionId, board);
  emit();
});

/** The session's board; null until the first read arrives. */
export function useBoard(sessionId: string): Board | null {
  const board = useSyncExternalStore(subscribe, () => boards.get(sessionId) ?? null);
  useEffect(() => {
    if (boards.has(sessionId) || loading.has(sessionId)) return;
    loading.add(sessionId);
    api
      .invoke("board:get", sessionId)
      .then((fresh) => {
        // A pushed change that arrived meanwhile is newer; keep it.
        if (!boards.has(sessionId)) boards.set(sessionId, fresh);
        emit();
      })
      .catch((error) => console.error(error))
      .finally(() => loading.delete(sessionId));
  }, [sessionId]);
  return board;
}

export type BoardLayout = "gallery" | "list";

export interface BoardView {
  /** Scripts referenced in the chat composer; sent with the next message. */
  refs: string[];
  /** Chosen with the view toggle; null follows the number of scripts. */
  layout: BoardLayout | null;
  /** The script open in the list view. */
  activeId: string | null;
}

/** Up to this many scripts open as full cards side by side; more open as a list. */
export const FULL_CARDS_MAX = 6;

export const boardLayout = (view: BoardView, count: number): BoardLayout =>
  view.layout ?? (count > FULL_CARDS_MAX ? "list" : "gallery");

const DEFAULT_VIEW: BoardView = { refs: [], layout: null, activeId: null };
const views = new Map<string, BoardView>();

export function useBoardView(sessionId: string) {
  const view = useSyncExternalStore(subscribe, () => views.get(sessionId) ?? DEFAULT_VIEW);
  const update = useCallback(
    (patch: Partial<BoardView> | ((current: BoardView) => Partial<BoardView>)) => {
      const current = views.get(sessionId) ?? DEFAULT_VIEW;
      views.set(sessionId, {
        ...current,
        ...(typeof patch === "function" ? patch(current) : patch),
      });
      emit();
    },
    [sessionId],
  );
  return [view, update] as const;
}

/** Adds or removes a script from the chat references. Returns true if added. */
export function toggleRef(sessionId: string, scriptId: string): boolean {
  const current = views.get(sessionId) ?? DEFAULT_VIEW;
  const added = !current.refs.includes(scriptId);
  views.set(sessionId, {
    ...current,
    refs: added ? [...current.refs, scriptId] : current.refs.filter((id) => id !== scriptId),
  });
  emit();
  return added;
}

// Asks the shell to open the chat panel and the chat to focus its composer.
// Kept pending until the chat (which may mount only after the panel opens)
// takes it.
let focusRequest: string | null = null;
const focusListeners = new Set<() => void>();

export function requestChatFocus(sessionId: string) {
  focusRequest = sessionId;
  for (const listener of focusListeners) listener();
}

/** Calls `listener` on every request, and once now if one is pending. */
export function onChatFocusRequest(listener: () => void) {
  focusListeners.add(listener);
  if (focusRequest) listener();
  return () => {
    focusListeners.delete(listener);
  };
}

/** The chat for `sessionId` takes a pending focus request, if there is one. */
export function takeChatFocus(sessionId: string): boolean {
  if (focusRequest !== sessionId) return false;
  focusRequest = null;
  return true;
}

/** Adds scripts to the chat references (keeps order, skips ones already there). */
export function addRefs(sessionId: string, scriptIds: string[]) {
  const current = views.get(sessionId) ?? DEFAULT_VIEW;
  const refs = [...current.refs, ...scriptIds.filter((id) => !current.refs.includes(id))];
  views.set(sessionId, { ...current, refs });
  emit();
}

// Dragging scripts from the board onto the chat references them.
export const SCRIPT_DRAG_TYPE = "application/x-hyan-scripts";

export interface ScriptDrag {
  sessionId: string;
  ids: string[];
}

/** Starts a drag carrying scripts, with a small chip as the drag image. */
export function startScriptDrag(
  e: { dataTransfer: DataTransfer | null },
  drag: ScriptDrag,
  label: string,
) {
  if (!e.dataTransfer) return;
  e.dataTransfer.setData(SCRIPT_DRAG_TYPE, JSON.stringify(drag));
  e.dataTransfer.effectAllowed = "copy";
  const chip = document.createElement("div");
  chip.textContent = label;
  Object.assign(chip.style, {
    position: "fixed",
    top: "-1000px",
    left: "0",
    padding: "4px 10px",
    borderRadius: "8px",
    font: "500 13px system-ui, sans-serif",
    background: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    boxShadow: "0 4px 12px rgb(0 0 0 / 0.12)",
    whiteSpace: "nowrap",
  });
  document.body.append(chip);
  e.dataTransfer.setDragImage(chip, 12, 12);
  setTimeout(() => chip.remove(), 0);
}

/** The scripts a drag carries, if it is a script drag. */
export function readScriptDrag(e: { dataTransfer: DataTransfer | null }): ScriptDrag | null {
  try {
    const raw = e.dataTransfer?.getData(SCRIPT_DRAG_TYPE);
    return raw ? (JSON.parse(raw) as ScriptDrag) : null;
  } catch {
    return null;
  }
}

export const isScriptDrag = (e: { dataTransfer: DataTransfer | null }) =>
  Boolean(e.dataTransfer?.types.includes(SCRIPT_DRAG_TYPE));
