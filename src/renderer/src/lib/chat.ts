import type { ChatInfo, ChatLive } from "@shared/ipc";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { api } from "./api";

// Unsaved progress of running chat turns ("chat:live": streamed text and the
// scripts a tool is writing), and the chat's AI info (mode, models, problem).

const lives = new Map<string, ChatLive>();
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

let writingIds = new Set<string>();

api.on("chat:live", ({ sessionId, live }) => {
  if (live) lives.set(sessionId, live);
  else lives.delete(sessionId);
  writingIds = new Set([...lives.values()].flatMap((l) => l.writingIds));
  emit();
});

export function useChatLive(sessionId: string): ChatLive | null {
  return useSyncExternalStore(subscribe, () => lives.get(sessionId) ?? null);
}

/** A chat tool is writing this script right now. */
export function useLiveWriting(scriptId: string): boolean {
  return useSyncExternalStore(subscribe, () => writingIds.has(scriptId));
}

let info: ChatInfo | null = null;
let loading: Promise<void> | null = null;

function loadInfo(refresh: boolean) {
  loading ??= api
    .invoke("chat:info", { refresh })
    .then((fresh) => {
      info = fresh;
      emit();
    })
    .catch((error) => console.error(error))
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Re-reads the chat's AI after the text AI changes in Cài đặt. */
export const refreshChatInfo = () => loadInfo(true);

/** The chat's AI; `refresh` re-checks the installation and model list. */
export function useChatInfo() {
  const current = useSyncExternalStore(subscribe, () => info);
  useEffect(() => {
    if (!info) void loadInfo(false);
  }, []);
  const refresh = useCallback(() => loadInfo(true), []);
  const setLocal = useCallback((patch: Partial<ChatInfo>) => {
    if (!info) return;
    info = { ...info, ...patch };
    emit();
  }, []);
  return [current, refresh, setLocal] as const;
}
