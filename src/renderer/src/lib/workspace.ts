import type { Workspace } from "@shared/ipc";
import { useSyncExternalStore } from "react";
import { api } from "./api";

// A minimal client cache of the main-process workspace. Mutations go through IPC,
// then `refreshWorkspace()` re-reads the persisted state. Replace with a richer
// store only when screens need optimistic updates.

let snapshot: Workspace | null = null;
const listeners = new Set<() => void>();

export async function refreshWorkspace(): Promise<Workspace> {
  snapshot = await api.invoke("workspace:get");
  for (const listener of listeners) listener();
  return snapshot;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Resolves once before the first render (see main.tsx), so this is never null in screens. */
export function useWorkspace(): Workspace {
  const value = useSyncExternalStore(subscribe, () => snapshot);
  if (!value) throw new Error("Workspace not loaded");
  return value;
}
