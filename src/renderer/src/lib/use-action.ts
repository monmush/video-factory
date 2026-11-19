import { useCallback, useState } from "react";
import { errorMessage } from "./errors";

export function useAction() {
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (action: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    try {
      await action();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  }, []);
  const clear = useCallback(() => setError(null), []);
  return { error, run, clear, fail: setError };
}
