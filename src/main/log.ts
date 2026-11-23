import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { release } from "node:os";
import { join } from "node:path";
import { app } from "electron";
import { formatLogEntry, type LogLevel } from "./log-format";
import { dataDir } from "./paths";
import { knownKeyValues, providerMode } from "./providers";

const ROTATE_AT_BYTES = 2 * 1024 * 1024;
const MIRRORED_CONSOLE: { method: "log" | "warn" | "error"; level: LogLevel }[] = [
  { method: "log", level: "INFO" },
  { method: "warn", level: "WARN" },
  { method: "error", level: "ERROR" },
];
const RENDERER_LEVELS: Partial<Record<string, LogLevel>> = { warning: "WARN", error: "ERROR" };

function neverThrow(action: () => void) {
  try {
    action();
  } catch {
    return;
  }
}

function startLogFile(): string {
  const folder = join(dataDir(), "logs");
  const file = join(folder, "app.log");
  neverThrow(() => {
    mkdirSync(folder, { recursive: true });
    const size = statSync(file, { throwIfNoEntry: false })?.size ?? 0;
    if (size > ROTATE_AT_BYTES) renameSync(file, join(folder, "app.previous.log"));
  });
  return file;
}

function mirrorConsole(write: (level: LogLevel, args: unknown[]) => void) {
  for (const { method, level } of MIRRORED_CONSOLE) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args);
      write(level, args);
    };
  }
}

function logRendererConsole(write: (level: LogLevel, args: unknown[]) => void) {
  app.on("web-contents-created", (_event, contents) => {
    contents.on("console-message", ({ level, message, sourceId, lineNumber }) => {
      const logLevel = RENDERER_LEVELS[level];
      if (logLevel) write(logLevel, [`[renderer] ${message} (${sourceId}:${lineNumber})`]);
    });
  });
}

function logCrashes() {
  process.on("uncaughtExceptionMonitor", (error, origin) =>
    console.error(`[app] ${origin}`, error),
  );
  process.on("unhandledRejection", (reason) => console.error("[app] unhandled rejection", reason));
  app.on("render-process-gone", (_event, _contents, { reason, exitCode }) =>
    console.error(`[app] renderer gone: ${reason}, exit code ${exitCode}`),
  );
  app.on("child-process-gone", (_event, { type, name, reason, exitCode }) =>
    console.error(`[app] ${type} process ${name ?? ""} gone: ${reason}, exit code ${exitCode}`),
  );
}

export function startLog() {
  const file = startLogFile();
  const write = (level: LogLevel, args: unknown[]) =>
    neverThrow(() =>
      appendFileSync(file, formatLogEntry(new Date(), level, args, knownKeyValues())),
    );
  mirrorConsole(write);
  logRendererConsole(write);
  logCrashes();
  console.log("[app] start", {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    os: release(),
    packaged: app.isPackaged,
    electron: process.versions.electron,
    mode: providerMode(),
  });
}
