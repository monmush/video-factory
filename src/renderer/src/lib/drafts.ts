import { useState } from "react";

// Unsent drafts, kept in memory for as long as the app runs. Leaving a screen
// (to the library, settings, another series) and coming back restores them,
// so no navigation ever throws typed work away. Sending clears the draft.
const drafts = new Map<string, unknown>();

export function useDraft<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => (drafts.has(key) ? (drafts.get(key) as T) : initial));
  // An updater reads the latest stored draft, so overlapping async updates don't drop each other.
  const set = (next: T | ((current: T) => T)) => {
    const value =
      typeof next === "function"
        ? (next as (current: T) => T)(drafts.has(key) ? (drafts.get(key) as T) : initial)
        : next;
    drafts.set(key, value);
    setValue(value);
  };
  const clear = () => {
    drafts.delete(key);
    setValue(initial);
  };
  return [value, set, clear] as const;
}
