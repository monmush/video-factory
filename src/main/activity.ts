import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { release } from "node:os";
import { join } from "node:path";
import { app } from "electron";
import type { ActivityEvent } from "../shared/activity";
import { activityLine } from "./activity-line";
import { neverThrow } from "./never-throw";
import { dataDir } from "./paths";
import { knownKeyValues, providerMode } from "./providers";

export const ACTIVITY_EVENTS_FILE = "activity/events.jsonl";
const INSTALL_FILE = "activity/install.json";

const run = randomUUID();
let folderMadeIn: string | null = null;
let install: string | null = null;

function eventsFile(): string {
  const folder = join(dataDir(), "activity");
  if (folderMadeIn !== folder) {
    mkdirSync(folder, { recursive: true });
    folderMadeIn = folder;
  }
  return join(dataDir(), ACTIVITY_EVENTS_FILE);
}

export function record(...events: ActivityEvent[]) {
  for (const event of events) {
    neverThrow(() =>
      appendFileSync(eventsFile(), activityLine(new Date(), run, event, knownKeyValues())),
    );
  }
}

export function recordDerived(derive: () => ActivityEvent[]) {
  neverThrow(() => record(...derive()));
}

function savedInstallId(file: string): string | null {
  try {
    const saved = JSON.parse(readFileSync(file, "utf8")) as { install?: unknown };
    return typeof saved.install === "string" && saved.install ? saved.install : null;
  } catch {
    return null;
  }
}

function newInstallId(file: string): string {
  const id = randomUUID();
  neverThrow(() => {
    eventsFile();
    writeFileSync(file, `${JSON.stringify({ install: id }, null, 2)}\n`, { flag: "wx" });
  });
  return savedInstallId(file) ?? id;
}

export function installId(): string {
  const file = join(dataDir(), INSTALL_FILE);
  install ??= savedInstallId(file) ?? newInstallId(file);
  return install;
}

export const appAbout = () => ({
  version: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  os: release(),
  packaged: app.isPackaged,
  electron: process.versions.electron ?? "",
  mode: providerMode(),
});

export function startActivity() {
  record({ name: "app-start", install: installId(), ...appAbout() });
  app.on("browser-window-focus", () => record({ name: "window", state: "focus" }));
  app.on("browser-window-blur", () => record({ name: "window", state: "blur" }));
  app.on("will-quit", () => record({ name: "app-quit" }));
}
