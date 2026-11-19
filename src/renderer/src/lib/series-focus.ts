let pendingSeriesFocus: string | null = null;
const listeners = new Set<() => void>();

export function requestSeriesFocus(seriesId: string) {
  pendingSeriesFocus = seriesId;
  for (const listener of listeners) listener();
}

export function onSeriesFocusRequest(listener: () => void) {
  listeners.add(listener);
  if (pendingSeriesFocus) listener();
  return () => {
    listeners.delete(listener);
  };
}

export function takeSeriesFocus(seriesId: string): boolean {
  if (pendingSeriesFocus !== seriesId) return false;
  pendingSeriesFocus = null;
  return true;
}
