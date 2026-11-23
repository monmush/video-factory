import type { VideosBeingMade } from "@shared/ipc";
import { deleteWarning } from "@shared/paid-work";
import { useEffect, useState, useSyncExternalStore } from "react";
import { api } from "./api";

let counts: VideosBeingMade = {};
const listeners = new Set<() => void>();

function set(next: VideosBeingMade) {
  counts = next;
  for (const listener of listeners) listener();
}

let pushed = false;

api.on("video:making", (next) => {
  pushed = true;
  set(next);
});
void api.invoke("video:making").then(
  (first) => {
    if (!pushed) set(first);
  },
  (error) => console.warn("[video] making:", error),
);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useVideosBeingMade = (): VideosBeingMade =>
  useSyncExternalStore(subscribe, () => counts);

export function useDeleteWarning(open: boolean, sessionIds: readonly string[]): string | null {
  const [warning, setWarning] = useState<string | null>(null);
  const ids = sessionIds.join("\n");
  useEffect(() => {
    setWarning(null);
    if (!open || !ids) return;
    let current = true;
    api.invoke("video:paid-work", ids.split("\n")).then(
      (work) => {
        if (current) setWarning(deleteWarning(work));
      },
      (error) => console.warn("[video] paid work:", error),
    );
    return () => {
      current = false;
    };
  }, [open, ids]);
  return warning;
}
