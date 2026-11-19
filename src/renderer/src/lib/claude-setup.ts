import type { ClaudeCodeStatus } from "@shared/ipc";
import { useCallback, useState, useSyncExternalStore } from "react";
import { api } from "./api";
import { refreshChatInfo } from "./chat";
import { errorMessage } from "./errors";

let onboarded = true;
const listeners = new Set<() => void>();

export async function loadOnboarded() {
  onboarded = await api.invoke("ai:onboarded").catch(() => true);
}

export function useOnboarded() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => onboarded,
  );
}

export async function finishOnboarding(useClaude: boolean) {
  await api.invoke("ai:finish-onboarding", { useClaude });
  if (useClaude) void refreshChatInfo();
  onboarded = true;
  for (const listener of listeners) listener();
}

export function useClaudeInstall(onInstalled: (status: ClaudeCodeStatus) => void) {
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const install = useCallback(async () => {
    setInstalling(true);
    setError(null);
    try {
      onInstalled(await api.invoke("ai:install-claude"));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setInstalling(false);
    }
  }, [onInstalled]);
  const openTerminal = useCallback(() => {
    api.invoke("ai:open-terminal", "install").catch((e) => setError(errorMessage(e)));
  }, []);
  return { installing, error, install, openTerminal };
}

export const planLabel = (plan: string) => `Gói ${plan.charAt(0).toUpperCase()}${plan.slice(1)}`;

export const isPaidPlan = (plan: string | null) => plan !== null && plan !== "free";
