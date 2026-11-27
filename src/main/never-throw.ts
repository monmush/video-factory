export function neverThrow(action: () => void) {
  try {
    action();
  } catch {
    return;
  }
}
