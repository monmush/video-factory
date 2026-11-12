import { useCallback, useState } from "react";

/** A boolean UI preference that survives restarts (panel open/closed and similar). */
export function usePersistentToggle(key: string, initial: boolean) {
  const storageKey = `hyan:${key}`;
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored === null ? initial : stored === "1";
    } catch {
      return initial;
    }
  });
  const toggle = useCallback(() => {
    setValue((current) => {
      try {
        localStorage.setItem(storageKey, current ? "0" : "1");
      } catch {}
      return !current;
    });
  }, [storageKey]);
  const set = useCallback(
    (next: boolean) => {
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {}
      setValue(next);
    },
    [storageKey],
  );
  return [value, toggle, set] as const;
}

/** A numeric UI preference that survives restarts (sidebar width and similar). */
export function usePersistentNumber(key: string, initial: number) {
  const storageKey = `hyan:${key}`;
  const [value, setValue] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(storageKey));
      return Number.isFinite(stored) && stored > 0 ? stored : initial;
    } catch {
      return initial;
    }
  });
  const save = useCallback(
    (next: number) => {
      try {
        localStorage.setItem(storageKey, String(next));
      } catch {}
    },
    [storageKey],
  );
  return [value, setValue, save] as const;
}
