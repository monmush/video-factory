import type { Workspace } from "@shared/ipc";
import { useSyncExternalStore } from "react";
import { api } from "./api";

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

export function useWorkspace(): Workspace {
  const value = useSyncExternalStore(subscribe, () => snapshot);
  if (!value) throw new Error("Workspace not loaded");
  return value;
}
