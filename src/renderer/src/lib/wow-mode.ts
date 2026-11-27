import { useSyncExternalStore } from "react";

const STORAGE_KEY = "hyan:wow-mode";
const AGENT_WORK_ATTRIBUTE = "data-agent-work";
const AGENT_DOING_ATTRIBUTE = "data-agent-doing";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

let enabled = read();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setWowMode(next: boolean) {
  enabled = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
  } catch {}
  for (const listener of listeners) listener();
}

export const useWowMode = () => useSyncExternalStore(subscribe, () => enabled);

export type RunningWork = { doing: string; rects: DOMRect[] };

export const agentWork = (
  key: string,
  doing: string | false | null | undefined,
): { "data-agent-work"?: string; "data-agent-doing"?: string } =>
  doing ? { [AGENT_WORK_ATTRIBUTE]: key, [AGENT_DOING_ATTRIBUTE]: doing } : {};

export function runningWork(): Map<string, RunningWork> {
  const groups = new Map<string, RunningWork>();
  for (const element of document.querySelectorAll(`[${AGENT_WORK_ATTRIBUTE}]`)) {
    const key = element.getAttribute(AGENT_WORK_ATTRIBUTE);
    const rect = element.getBoundingClientRect();
    const onScreen =
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth;
    if (!key || !onScreen) continue;
    const group = groups.get(key);
    if (group) group.rects.push(rect);
    else
      groups.set(key, { doing: element.getAttribute(AGENT_DOING_ATTRIBUTE) ?? "", rects: [rect] });
  }
  return groups;
}
