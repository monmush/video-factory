import { join } from "node:path";
import { app, BrowserWindow, nativeTheme, shell } from "electron";
import { closeAll as closeChats } from "./chat/runtime";
import { registerIpc } from "./ipc";
import { clearStaging, handleMediaProtocol, registerMediaScheme } from "./media";
import { readSettings } from "./settings";

// Development never touches the packaged app's data: it gets its own folder,
// and HYAN_DATA_DIR points either at a disposable one. Electron's own storage
// and the single-instance lock follow, so each data folder is fully separate.
// Must run before anything reads paths.
if (process.env.HYAN_DATA_DIR) {
  app.setPath("userData", process.env.HYAN_DATA_DIR);
} else if (!app.isPackaged) {
  app.setPath("userData", `${app.getPath("userData")} (dev)`);
}

// One running copy per data folder: two would each cache workspace.json and
// overwrite each other's changes. A second launch focuses the first window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.on("second-instance", () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

// Development keys live in the ignored `.env.local` at the project root.
if (!app.isPackaged) {
  try {
    process.loadEnvFile(join(app.getAppPath(), ".env.local"));
  } catch {
    // No local keys: the app still runs, providers report as not configured.
  }
}

registerMediaScheme();

const isMac = process.platform === "darwin";
const devServerUrl = process.env.ELECTRON_RENDERER_URL;

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: "Hy An Video Factory",
    // Window chrome colour (--sidebar in styles.css); the content card sits on top.
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#000000" : "#f4f4f5",
    // macOS: content runs under the title bar; the app's top bar is the drag region.
    ...(isMac
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 14, y: 13 } }
      : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  // The renderer is a single page: never navigate away from it, and open
  // external links in the user's browser instead of a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (devServerUrl && url.startsWith(devServerUrl)) return;
    event.preventDefault();
  });

  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  nativeTheme.themeSource = readSettings().theme;
  handleMediaProtocol();
  registerIpc();
  void clearStaging();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Stop the users' Claude processes with the app.
app.on("before-quit", closeChats);

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});
