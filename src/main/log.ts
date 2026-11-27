import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { format } from "node:util";
import { app } from "electron";
import { appAbout, record } from "./activity";
import { formatLogEntry, type LogLevel } from "./log-format";
import { neverThrow } from "./never-throw";
import { dataDir } from "./paths";
import { knownKeyValues } from "./providers";

const ROTATE_AT_BYTES = 2 * 1024 * 1024;
const MIRRORED_CONSOLE: { method: "log" | "warn" | "error"; level: LogLevel }[] = [
  { method: "log", level: "INFO" },
  { method: "warn", level: "WARN" },
  { method: "error", level: "ERROR" },
];
const RENDERER_LEVELS: Partial<Record<string, LogLevel>> = { warning: "WARN", error: "ERROR" };

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
      if (logLevel === "ERROR") record({ name: "renderer-error", message });
    });
  });
}

function logCrashes() {
  process.on("uncaughtExceptionMonitor", (error, origin) => {
    console.error(`[app] ${origin}`, error);
    record({ name: "crash", kind: "uncaught-exception", message: format(error), reason: origin });
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[app] unhandled rejection", reason);
    record({ name: "crash", kind: "unhandled-rejection", message: format(reason) });
  });
  app.on("render-process-gone", (_event, _contents, { reason, exitCode }) => {
    console.error(`[app] renderer gone: ${reason}, exit code ${exitCode}`);
    record({ name: "crash", kind: "renderer-gone", message: reason, reason, exitCode });
  });
  app.on("child-process-gone", (_event, { type, name, reason, exitCode }) => {
    console.error(`[app] ${type} process ${name ?? ""} gone: ${reason}, exit code ${exitCode}`);
    record({
      name: "crash",
      kind: "child-gone",
      message: `${type} ${name ?? ""}`.trim(),
      reason,
      exitCode,
      process: type,
    });
  });
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
  console.log("[app] start", appAbout());
}
