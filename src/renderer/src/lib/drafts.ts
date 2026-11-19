import { useState } from "react";

const draftsSurvivingNavigation = new Map<string, unknown>();

export function useDraft<T>(key: string, initial: T) {
  const latestStoredDraft = () =>
    draftsSurvivingNavigation.has(key) ? (draftsSurvivingNavigation.get(key) as T) : initial;
  const [value, setValue] = useState<T>(latestStoredDraft);
  const set = (next: T | ((latest: T) => T)) => {
    const value =
      typeof next === "function" ? (next as (latest: T) => T)(latestStoredDraft()) : next;
    draftsSurvivingNavigation.set(key, value);
    setValue(value);
  };
  const clear = () => {
    draftsSurvivingNavigation.delete(key);
    setValue(initial);
  };
  return [value, set, clear] as const;
}
