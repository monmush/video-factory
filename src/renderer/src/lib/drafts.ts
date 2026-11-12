import { useState } from "react";

// Unsent drafts, kept in memory for as long as the app runs. Leaving a screen
// (to the library, settings, another series) and coming back restores them,
// so no navigation ever throws typed work away. Sending clears the draft.
const drafts = new Map<string, unknown>();

export function useDraft<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => (drafts.has(key) ? (drafts.get(key) as T) : initial));
  const set = (next: T) => {
    drafts.set(key, next);
    setValue(next);
  };
  const clear = () => {
    drafts.delete(key);
    setValue(initial);
  };
  return [value, set, clear] as const;
}
