import type { SeriesBookends } from "@shared/bookends";
import type { Workspace } from "@shared/ipc";
import { seriesTargetSec } from "@shared/series-guide";
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

export function useSeriesTargetSec(sessionId: string): number {
  const { sessions, series } = useWorkspace();
  const session = sessions.find((s) => s.id === sessionId);
  return seriesTargetSec(series.find((s) => s.id === session?.seriesId) ?? {});
}

export function useSessionBookends(sessionId: string): SeriesBookends | undefined {
  const { sessions, series } = useWorkspace();
  const session = sessions.find((s) => s.id === sessionId);
  return series.find((s) => s.id === session?.seriesId)?.bookends;
}
