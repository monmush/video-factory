import type { HyanBridge } from "@shared/ipc";

declare global {
  interface Window {
    hyan: HyanBridge;
  }
}

/** Typed access to the main process. See src/shared/ipc.ts for every channel. */
export const api = window.hyan;
