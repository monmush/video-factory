import type { Board } from "@shared/ipc";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { api } from "./api";

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

const sessionsOnScreen = new Map<string, number>();
const RETRY_AFTER_FAILED_READ_MS = 2000;

function load(sessionId: string, retryOnceOnFailure: boolean) {
  if (boards.has(sessionId) || loading.has(sessionId)) return;
  loading.add(sessionId);
  api
    .invoke("board:get", sessionId)
    .then((fresh) => {
      const pushedMeanwhile = boards.has(sessionId);
      if (!pushedMeanwhile) boards.set(sessionId, fresh);
      emit();
    })
    .catch((error) => {
      console.error(error);
      if (retryOnceOnFailure) {
        setTimeout(
          () => sessionsOnScreen.has(sessionId) && load(sessionId, false),
          RETRY_AFTER_FAILED_READ_MS,
        );
      }
    })
    .finally(() => loading.delete(sessionId));
}

window.addEventListener("focus", () => {
  for (const sessionId of sessionsOnScreen.keys()) load(sessionId, false);
});

export function useBoard(sessionId: string): Board | null {
  const board = useSyncExternalStore(subscribe, () => boards.get(sessionId) ?? null);
  useEffect(() => {
    sessionsOnScreen.set(sessionId, (sessionsOnScreen.get(sessionId) ?? 0) + 1);
    load(sessionId, true);
    return () => {
      const count = (sessionsOnScreen.get(sessionId) ?? 1) - 1;
      if (count > 0) sessionsOnScreen.set(sessionId, count);
      else sessionsOnScreen.delete(sessionId);
    };
  }, [sessionId]);
  return board;
}

export type BoardLayout = "gallery" | "list";

export interface BoardView {
  refs: string[];
  layout: BoardLayout | null;
  activeId: string | null;
  testId: string | null;
  previewAll: boolean;
  focusId: string | null;
}

export const FULL_CARDS_MAX = 6;

export const boardLayout = (view: BoardView, count: number): BoardLayout =>
  view.layout ?? (count > FULL_CARDS_MAX ? "list" : "gallery");

const DEFAULT_VIEW: BoardView = {
  refs: [],
  layout: null,
  activeId: null,
  testId: null,
  previewAll: false,
  focusId: null,
};

export const testCardId = (view: BoardView, finishedIds: string[]): string | null =>
  view.testId && finishedIds.includes(view.testId) ? view.testId : (finishedIds[0] ?? null);
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

export function requestCardFocus(sessionId: string, scriptId: string) {
  const current = views.get(sessionId) ?? DEFAULT_VIEW;
  views.set(sessionId, { ...current, focusId: scriptId });
  emit();
}

let pendingChatFocus: string | null = null;
let insertRequest: { sessionId: string; text: string } | null = null;
const focusListeners = new Set<() => void>();

export function requestChatFocus(sessionId: string, insert?: string) {
  pendingChatFocus = sessionId;
  if (insert) insertRequest = { sessionId, text: insert };
  for (const listener of focusListeners) listener();
}

export function onChatFocusRequest(listener: () => void) {
  focusListeners.add(listener);
  if (pendingChatFocus) listener();
  return () => {
    focusListeners.delete(listener);
  };
}

export function takeChatFocus(sessionId: string): boolean {
  if (pendingChatFocus !== sessionId) return false;
  pendingChatFocus = null;
  return true;
}

export function takeChatInsert(sessionId: string): string | null {
  if (insertRequest?.sessionId !== sessionId) return null;
  const { text } = insertRequest;
  insertRequest = null;
  return text;
}

export function addRefs(sessionId: string, scriptIds: string[]) {
  const current = views.get(sessionId) ?? DEFAULT_VIEW;
  const refs = [...current.refs, ...scriptIds.filter((id) => !current.refs.includes(id))];
  views.set(sessionId, { ...current, refs });
  emit();
}

export const SCRIPT_DRAG_TYPE = "application/x-hyan-scripts";

export interface ScriptDrag {
  sessionId: string;
  ids: string[];
}

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

export async function editAsNewVersion(sessionId: string, scriptId: string): Promise<string> {
  const id = await api.invoke("board:copy", { sessionId, scriptId });
  const current = views.get(sessionId) ?? DEFAULT_VIEW;
  views.set(sessionId, {
    ...current,
    activeId: id,
    refs: [...current.refs.filter((x) => x !== scriptId), id],
  });
  emit();
  requestChatFocus(sessionId);
  return id;
}
