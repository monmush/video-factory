const ELECTRON_IPC_ERROR_PREFIX = /^Error invoking remote method '[^']+': (?:\w*Error: )?/;

export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(ELECTRON_IPC_ERROR_PREFIX, "");
}
