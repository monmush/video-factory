import type { HyanBridge } from "@shared/ipc";

declare global {
  interface Window {
    hyan: HyanBridge;
  }
}

export const api = window.hyan;
