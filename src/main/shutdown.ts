import { closeAll as closeChats } from "./chat/runtime";
import { stopClaudeProcesses } from "./claude-code";
import { finishRunner, flushRunner } from "./video/runner";

function stopServices() {
  closeChats();
  stopClaudeProcesses();
}

export async function finishWorkAndShutDown(withinMs: number) {
  stopServices();
  await finishRunner(withinMs);
}

export async function saveAndShutDown(withinMs: number) {
  stopServices();
  await flushRunner(withinMs);
}
