import { closeAll as closeChats } from "./chat/runtime";
import { stopClaudeProcesses } from "./claude-code";
import { stopRunner } from "./video/runner";

export function shutDownServices() {
  closeChats();
  stopClaudeProcesses();
  stopRunner();
}
