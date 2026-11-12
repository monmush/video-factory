import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  type ChatEffort,
  type ChatInfo,
  type ChatModelChoice,
  type ChatModelOption,
  HIDDEN_CHAT_MODELS,
  resolveChoice,
} from "../../shared/ipc";
import { claudeCodeStatus, claudeEnv, findClaude } from "../claude-code";
import { readSettings, writeSettings } from "../settings";
import { textAiMode } from "../text-ai";

// Which models the chat offers. Claude Code reports them (aliases such as
// "opus", "sonnet", with their effort levels); the list is read once per run
// without sending a prompt, and a short built-in list covers the time before.

const EFFORTS: ChatEffort[] = ["low", "medium", "high", "xhigh", "max"];

const FALLBACK: ChatModelOption[] = [
  { value: "opus", label: "Opus", efforts: EFFORTS },
  { value: "sonnet", label: "Sonnet", efforts: EFFORTS },
  { value: "haiku", label: "Haiku", efforts: EFFORTS },
];

let models: ChatModelOption[] | null = null;
let status: { at: number; value: Awaited<ReturnType<typeof claudeCodeStatus>> } | null = null;

export function currentChoice(): ChatModelChoice {
  const settings = readSettings();
  return resolveChoice({ model: settings.chatModel, effort: settings.chatEffort });
}

export async function rememberChoice(choice: ChatModelChoice) {
  await writeSettings({ chatModel: choice.model, chatEffort: choice.effort });
}

/** Asks Claude Code for its model list; no prompt is sent, nothing is used up. */
async function readModels(): Promise<ChatModelOption[] | null> {
  const bin = await findClaude();
  if (!bin) return null;
  const q = query({
    prompt: (async function* () {
      await new Promise(() => {});
    })(),
    options: {
      pathToClaudeCodeExecutable: bin,
      tools: [],
      settingSources: [],
      strictMcpConfig: true,
      persistSession: false,
      env: claudeEnv(),
    },
  });
  try {
    const list = await Promise.race([
      q.supportedModels(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 15_000)),
    ]);
    // Aliases follow the newest models; dated ids are for pinning and stay out,
    // and so do the hidden models.
    return list
      .filter((m) => !m.value.startsWith("claude-") && !HIDDEN_CHAT_MODELS.includes(m.value))
      .map((m) => ({
        value: m.value,
        label: m.displayName,
        efforts: (m.supportedEffortLevels ?? []) as ChatEffort[],
      }));
  } catch (error) {
    console.error("[chat] model list failed", error);
    return null;
  } finally {
    q.close();
  }
}

export async function chatInfo(refresh = false): Promise<ChatInfo> {
  const text = textAiMode();
  const mode = text === "claude-code" ? "agent" : text === "fixture" ? "fixture" : "pipeline";
  let problem: ChatInfo["problem"] = null;
  if (mode === "agent") {
    if (refresh || !status || Date.now() - status.at > 30_000) {
      status = { at: Date.now(), value: await claudeCodeStatus() };
    }
    problem = !status.value.installed
      ? "not-installed"
      : !status.value.loggedIn
        ? "signed-out"
        : null;
    if (!problem && (refresh || !models)) models = (await readModels()) ?? models;
  }
  return { mode, problem, models: models ?? FALLBACK, choice: currentChoice() };
}
