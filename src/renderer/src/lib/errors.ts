/** Electron prefixes IPC errors with "Error invoking remote method '…': Error: ". Show only the message. */
export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, "");
}
