import type { Series } from "@shared/ipc";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { api } from "./api";
import { errorMessage } from "./errors";
import { refreshWorkspace } from "./workspace";

export type GuideDraft =
  | { state: "drafting" }
  | { state: "failed"; error: string }
  | { state: "settled" };

const draftsBySeries = new Map<string, GuideDraft>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

function record(seriesId: string, draft: GuideDraft) {
  draftsBySeries.set(seriesId, draft);
  for (const listener of listeners) listener();
}

function startDraft(seriesId: string) {
  if (draftsBySeries.get(seriesId)?.state === "drafting") return;
  record(seriesId, { state: "drafting" });
  api
    .invoke("series:draft-guide", seriesId)
    .then(() => refreshWorkspace())
    .then(() => record(seriesId, { state: "settled" }))
    .catch((error) => record(seriesId, { state: "failed", error: errorMessage(error) }));
}

export const needsGuideDraft = (series: Pick<Series, "guide" | "guidance">) =>
  !series.guide && series.guidance.trim() !== "";

export function useGuideDraft(series: Series): { draft: GuideDraft | null; retry: () => void } {
  const needed = needsGuideDraft(series);
  const seriesId = series.id;
  const draft = useSyncExternalStore(subscribe, () => draftsBySeries.get(seriesId) ?? null);
  useEffect(() => {
    if (needed && !draftsBySeries.has(seriesId)) startDraft(seriesId);
  }, [needed, seriesId]);
  const retry = useCallback(() => startDraft(seriesId), [seriesId]);
  return { draft: needed ? draft : null, retry };
}
