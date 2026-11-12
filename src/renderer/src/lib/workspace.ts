import type { Workspace } from "@shared/ipc";
import { useSyncExternalStore } from "react";
import { api } from "./api";

// A client copy of the main-process workspace. Main pushes "workspace:changed"
// after every saved change (including work that finishes in the background),
// so screens stay current without refreshing. `refreshWorkspace()` remains for
// the first load and for callers that want the new state before continuing.

let snapshot: Workspace | null = null;
const listeners = new Set<() => void>();

function set(next: Workspace) {
  snapshot = next;
  for (const listener of listeners) listener();
}

api.on("workspace:changed", set);

export async function refreshWorkspace(): Promise<Workspace> {
  set(await api.invoke("workspace:get"));
  return snapshot as Workspace;
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
