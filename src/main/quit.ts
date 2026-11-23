import { app, BrowserWindow, dialog } from "electron";
import { type Confirmation, quitConfirmation, windowCloseConfirmation } from "../shared/paid-work";
import { blockingPaidCalls } from "./paid-calls";
import { finishWorkAndShutDown, saveAndShutDown } from "./shutdown";
import { paidWorkNow } from "./video/runner";

const FINISH_WORK_MS = 10_000;
const SAVE_ON_SIGNAL_MS = 1_000;
const STAY = 0;
const SIGNALS_THAT_RESTART_DEVELOPMENT = ["SIGTERM", "SIGINT", "SIGHUP"] as const;

type Leaving = "no" | "asking" | "shutting-down" | "yes";
let leaving: Leaving = "no";
let question: AbortController | null = null;

const leavingNow = () => leaving === "shutting-down" || leaving === "yes";

async function confirmed(
  text: Confirmation,
  leave: string,
  win: BrowserWindow | null,
  signal?: AbortSignal,
): Promise<boolean> {
  const options: Electron.MessageBoxOptions = {
    type: "warning",
    message: text.message,
    detail: text.detail,
    buttons: ["Ở lại", leave],
    defaultId: STAY,
    cancelId: STAY,
    noLink: true,
    ...(signal ? { signal } : {}),
  };
  const { response } = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);
  return response !== STAY;
}

async function leave(shutDown: () => Promise<void>) {
  leaving = "shutting-down";
  question?.abort();
  await shutDown().catch((error) => console.error("[quit]", error));
  leaving = "yes";
  app.quit();
}

async function askThenQuit() {
  const text = quitConfirmation(paidWorkNow(), blockingPaidCalls());
  if (text) {
    leaving = "asking";
    question = new AbortController();
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    const quit = await confirmed(text, "Thoát", parent, question.signal);
    question = null;
    if (leaving !== "asking") return;
    if (!quit) {
      leaving = "no";
      return;
    }
  }
  await leave(() => finishWorkAndShutDown(FINISH_WORK_MS));
}

export function confirmBeforeQuitting() {
  app.on("before-quit", (event) => {
    if (leaving === "yes") return;
    event.preventDefault();
    if (leaving === "no") void askThenQuit();
  });
}

export function quitWithoutAskingOnSignals() {
  for (const signal of SIGNALS_THAT_RESTART_DEVELOPMENT) {
    process.on(signal, () => {
      if (!leavingNow()) void leave(() => saveAndShutDown(SAVE_ON_SIGNAL_MS));
    });
  }
}

export function confirmBeforeClosing(win: BrowserWindow) {
  let closeConfirmed = false;
  let asking = false;
  win.on("close", (event) => {
    if (closeConfirmed || leavingNow()) return;
    const text = windowCloseConfirmation(blockingPaidCalls());
    if (!text) return;
    event.preventDefault();
    if (asking) return;
    asking = true;
    void confirmed(text, "Đóng", win).then((close) => {
      asking = false;
      if (!close || win.isDestroyed()) return;
      closeConfirmed = true;
      win.close();
    });
  });
}
