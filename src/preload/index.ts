import { contextBridge, ipcRenderer, webUtils } from "electron";
import { type HyanBridge, IPC_CHANNELS, IPC_EVENTS, type IpcChannel } from "../shared/ipc";

const allowed = new Set<string>(IPC_CHANNELS);
const allowedEvents = new Set<string>(IPC_EVENTS);

const bridge: HyanBridge = {
  invoke(channel: IpcChannel, ...args: unknown[]) {
    if (!allowed.has(channel)) {
      return Promise.reject(new Error(`Unknown IPC channel: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  on(event: string, listener: (payload: unknown) => void) {
    if (!allowedEvents.has(event)) throw new Error(`Unknown IPC event: ${event}`);
    const wrapped = (_e: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on(event, wrapped);
    return () => {
      ipcRenderer.removeListener(event, wrapped);
    };
  },
  platform: process.platform,
  pathsForFiles: (files: File[]) => files.map((f) => webUtils.getPathForFile(f)).filter(Boolean),
} as HyanBridge;

contextBridge.exposeInMainWorld("hyan", bridge);
