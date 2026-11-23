import type { VoiceMode } from "@shared/speech-models";
import { useEffect, useSyncExternalStore } from "react";
import { api } from "./api";

let native: boolean | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function load() {
  loading ??= api
    .invoke("dev:native-voice")
    .then((on) => {
      native = on;
      emit();
    })
    .catch(() => undefined)
    .finally(() => {
      loading = null;
    });
  return loading;
}

export function useNativeVoice(): boolean | null {
  const current = useSyncExternalStore(subscribe, () => native);
  useEffect(() => {
    void load();
  }, []);
  return current;
}

export const useVoiceMode = (): VoiceMode => (useNativeVoice() ? "native" : "dubbed");

export async function setNativeVoice(on: boolean): Promise<void> {
  native = await api.invoke("dev:set-native-voice", on);
  emit();
}
