import type { MaterialItem } from "@shared/material";
import { useEffect, useSyncExternalStore } from "react";
import { api } from "./api";

const NONE: MaterialItem[] = [];
const itemsBySeries = new Map<string, MaterialItem[]>();
const loading = new Set<string>();
const changedWhileLoading = new Set<string>();
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

function load(seriesId: string) {
  if (loading.has(seriesId)) {
    changedWhileLoading.add(seriesId);
    return;
  }
  loading.add(seriesId);
  api
    .invoke("material:list", seriesId)
    .then((items) => {
      itemsBySeries.set(seriesId, items);
      emit();
    })
    .catch((error) => console.error(error))
    .finally(() => {
      loading.delete(seriesId);
      if (changedWhileLoading.delete(seriesId)) load(seriesId);
    });
}

api.on("material:changed", ({ seriesId }) => {
  if (itemsBySeries.has(seriesId) || loading.has(seriesId)) load(seriesId);
});

export function useMaterial(seriesId: string): MaterialItem[] {
  const items = useSyncExternalStore(subscribe, () => itemsBySeries.get(seriesId) ?? NONE);
  useEffect(() => {
    if (!itemsBySeries.has(seriesId)) load(seriesId);
  }, [seriesId]);
  return items;
}
