import type { LineRemoval } from "@shared/line-edit";
import { useCallback, useSyncExternalStore } from "react";
import { api } from "./api";

export interface BoardNotice {
  text: string;
  restore?: string[];
  undoOf?: string;
}

export interface LineSaved {
  scriptId: string;
  copied: boolean;
}

const notices = new Map<string, BoardNotice>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function showBoardNotice(sessionId: string, notice: BoardNotice | null) {
  if (notice) notices.set(sessionId, notice);
  else notices.delete(sessionId);
  for (const listener of listeners) listener();
}

export function useBoardNotice(sessionId: string) {
  const notice = useSyncExternalStore(subscribe, () => notices.get(sessionId) ?? null);
  const set = useCallback(
    (next: BoardNotice | null) => showBoardNotice(sessionId, next),
    [sessionId],
  );
  return [notice, set] as const;
}

export const lineSavedNotice = (saved: LineSaved, inPlaceText: string): BoardNotice => ({
  text: saved.copied ? "Đã lưu thành bản mới" : inPlaceText,
  undoOf: saved.scriptId,
});

export async function removeScriptLine(
  sessionId: string,
  scriptId: string,
  removal: LineRemoval,
): Promise<LineSaved> {
  const removed = await api.invoke("board:remove-line", { sessionId, scriptId, ...removal });
  showBoardNotice(sessionId, lineSavedNotice(removed, "Đã xóa lời thoại"));
  return removed;
}
