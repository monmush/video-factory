import { isStale, type ShownBalance, shownBalance } from "@shared/media-balance";
import { useSyncExternalStore } from "react";
import { api } from "./api";

const POLL_MS = 5 * 60_000;

let shown: ShownBalance = null;
let readAt: number | null = null;
const listeners = new Set<() => void>();

api.on("usage:media-balance", (result) => {
  if (result.status !== "error") readAt = Date.now();
  shown = shownBalance(shown, result);
  for (const listener of listeners) listener();
});

function read() {
  api.invoke("usage:media-balance").catch((error) => console.warn("[usage] balance:", error));
}

read();

window.addEventListener("focus", () => {
  if (isStale(readAt, Date.now())) read();
});

setInterval(() => {
  if (document.visibilityState === "visible") read();
}, POLL_MS);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useMediaBalance = (): ShownBalance => useSyncExternalStore(subscribe, () => shown);
