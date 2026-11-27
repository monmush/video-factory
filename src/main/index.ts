import { existsSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, nativeTheme, shell } from "electron";
import { startActivity } from "./activity";
import { registerIpc } from "./ipc";
import { startLog } from "./log";
import { clearStaging, handleMediaProtocol, registerMediaSchemeBeforeAppReady } from "./media";
import { chooseDataFolder, superviseDevelopmentRestarts } from "./profiles";
import { confirmBeforeClosing, confirmBeforeQuitting, quitWithoutAskingOnSignals } from "./quit";
import { readSettings } from "./settings";
import { startRunner } from "./video/runner";

function allowOneRunningCopyPerDataFolder() {
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
}

function loadOptionalDevelopmentKeys() {
  if (app.isPackaged) return;
  const keysFile = join(app.getAppPath(), ".env.local");
  if (existsSync(keysFile)) process.loadEnvFile(keysFile);
}

const isMac = process.platform === "darwin";
const devServerUrl = process.env.ELECTRON_RENDERER_URL;
const SIDEBAR_COLOR_BEHIND_CONTENT = { dark: "#000000", light: "#f4f4f5" };

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: "Hy An Video Factory",
    backgroundColor: nativeTheme.shouldUseDarkColors
      ? SIDEBAR_COLOR_BEHIND_CONTENT.dark
      : SIDEBAR_COLOR_BEHIND_CONTENT.light,
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
  confirmBeforeClosing(win);

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

function startApp() {
  chooseDataFolder();
  startLog();
  allowOneRunningCopyPerDataFolder();
  loadOptionalDevelopmentKeys();
  startActivity();
  registerMediaSchemeBeforeAppReady();

  app.whenReady().then(() => {
    quitWithoutAskingOnSignals();
    nativeTheme.themeSource = readSettings().theme;
    handleMediaProtocol();
    registerIpc();
    void clearStaging();
    createWindow();
    void startRunner().catch((error) => console.error("[video] could not start", error));

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  confirmBeforeQuitting();

  app.on("window-all-closed", () => {
    if (!isMac) app.quit();
  });
}

if (!superviseDevelopmentRestarts()) startApp();
