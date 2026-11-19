import { app } from "electron";
import type { ClaudeCodeStatus } from "../shared/ipc";

type Stage = "missing" | "signed-out" | "ready";

const STAGES: Stage[] = ["missing", "signed-out", "ready"];

function initialStage(): Stage | null {
  if (app.isPackaged) return null;
  const value = process.env.HYAN_FAKE_CLAUDE;
  return value === "missing" || value === "signed-out" ? value : null;
}

let stage = initialStage();

export const fakeClaudeActive = () => stage !== null;

export function fakeClaudeStatus(): ClaudeCodeStatus | null {
  if (!stage) return null;
  return {
    installed: stage !== "missing",
    version: stage === "missing" ? null : "0.0.0",
    loggedIn: stage === "ready",
    plan: stage === "ready" ? "max" : null,
  };
}

export async function advanceFakeClaude(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  if (stage) stage = STAGES[Math.min(STAGES.indexOf(stage) + 1, STAGES.length - 1)] ?? stage;
}
