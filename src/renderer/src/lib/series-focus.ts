// Asks a series page to focus its prompt box (the sidebar's "+"). Kept pending
// until the page, which may mount only after the navigation, takes it; the
// same pattern as requestChatFocus in lib/board.ts.
let focusRequest: string | null = null;
const listeners = new Set<() => void>();

export function requestSeriesFocus(seriesId: string) {
  focusRequest = seriesId;
  for (const listener of listeners) listener();
}

/** Calls `listener` on every request, and once now if one is pending. */
export function onSeriesFocusRequest(listener: () => void) {
  listeners.add(listener);
  if (focusRequest) listener();
  return () => {
    listeners.delete(listener);
  };
}

/** The page for `seriesId` takes a pending focus request, if there is one. */
export function takeSeriesFocus(seriesId: string): boolean {
  if (focusRequest !== seriesId) return false;
  focusRequest = null;
  return true;
}
