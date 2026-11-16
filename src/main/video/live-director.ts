import {
  type HookCallbackMatcher,
  type McpServerConfig,
  query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { emptyRecord, recordResult, type ToolRecord } from "../../shared/live-plan";
import {
  DENIED_TOOLS,
  type FalConnection,
  isPlanningTool,
  keyProxyServer,
  MCP_SERVER,
  PLANNING_TOOLS,
  toolId,
} from "./fal-tools";

// One live directing session (experiment branch, docs/LIVE_DIRECTOR_EXPERIMENT.md):
// the user's own Claude, through the Agent SDK, with no built-in tools and
// only the media provider's read-only planning tools. Every tool result is
// recorded, so prices and schemas used by the checks are the ones the
// session actually saw. One correction round when the answer breaks a rule.
// Electron-free: the caller passes the Claude binary, folder and environment.

export interface LiveSessionOptions {
  bin: string;
  /** An empty folder: no project instructions or files are picked up. */
  cwd: string;
  /** The user's environment without the app's provider keys. */
  env: NodeJS.ProcessEnv;
  connection: FalConnection;
  system: string;
  prompt: string;
  /** The problems with an answer, given what the session's tools returned; empty when accepted. */
  check: (answer: string, record: ToolRecord) => string[];
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  timeoutMs?: number;
  /** Every tool call and its result, for the job folder. */
  log?: (entry: Record<string, unknown>) => void;
  /** Version reported to Claude Code. */
  clientVersion?: string;
}

export interface LiveSessionResult {
  /** The last answer, accepted or not. */
  answer: string | null;
  /** What is still wrong with it; empty when accepted. */
  errors: string[];
  attempts: number;
  record: ToolRecord;
  durationMs: number;
  model: string | null;
  connection: FalConnection["kind"];
  /** Provider tools the session could see (checked against the allow-list). */
  visibleTools: string[];
}

/** The session could not use this connection (not signed in, server down); try the next. */
export class ConnectionError extends Error {}

/** Denies any tool call not on the allow-list, whatever the permission settings say. */
const guard: HookCallbackMatcher = {
  hooks: [
    async (input) => {
      const name = (input as { tool_name?: string }).tool_name ?? "";
      if (isPlanningTool(name)) return {};
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "Only the read-only planning tools are available.",
        },
      };
    },
  ],
};

/** Streaming input: the prompt, then a correction if the answer needs one. */
function inbox() {
  const waiting: SDKUserMessage[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  return {
    push(text: string) {
      waiting.push({
        type: "user",
        message: { role: "user", content: text },
        parent_tool_use_id: null,
      });
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
    async *[Symbol.asyncIterator]() {
      while (!closed) {
        const next = waiting.shift();
        if (next) {
          yield next;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
      }
    },
  };
}

const textsOf = (content: unknown): string[] =>
  typeof content === "string"
    ? [content]
    : Array.isArray(content)
      ? content
          .filter((b) => b && typeof b === "object" && (b as { type?: string }).type === "text")
          .map((b) => String((b as { text?: unknown }).text ?? ""))
      : [];

export async function runLiveSession(options: LiveSessionOptions): Promise<LiveSessionResult> {
  const startedAt = Date.now();
  const server: McpServerConfig =
    options.connection.kind === "signed-in"
      ? { type: "http", url: options.connection.url }
      : await keyProxyServer(options.connection.key);
  const serverName = options.connection.kind === "signed-in" ? options.connection.name : MCP_SERVER;
  if (serverName !== MCP_SERVER) {
    // Tool ids, the allow-list and the hook all assume this name.
    throw new ConnectionError(`Expected the server to be named "${MCP_SERVER}"`);
  }

  const record = emptyRecord();
  const input = inbox();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), options.timeoutMs ?? 10 * 60_000);
  const q = query({
    prompt: input,
    options: {
      pathToClaudeCodeExecutable: options.bin,
      cwd: options.cwd,
      ...(options.model ? { model: options.model } : {}),
      ...(options.effort ? { effort: options.effort } : {}),
      systemPrompt: options.system,
      tools: [],
      mcpServers: { [MCP_SERVER]: server },
      allowedTools: PLANNING_TOOLS.map(toolId),
      disallowedTools: DENIED_TOOLS.map(toolId),
      permissionMode: "dontAsk",
      hooks: { PreToolUse: [guard] },
      settingSources: [],
      strictMcpConfig: true,
      persistSession: false,
      maxTurns: 60,
      abortController: abort,
      env: {
        ...options.env,
        CLAUDE_AGENT_SDK_CLIENT_APP: `hyan-video-factory/${options.clientVersion ?? "dev"}`,
      },
      stderr: (data) => console.error("[live-director] claude:", data.trim().slice(0, 300)),
    },
  });

  const calls = new Map<string, { name: string; input: unknown; at: number }>();
  let answer: string | null = null;
  let errors: string[] = [];
  let attempts = 0;
  let model: string | null = null;
  let visibleTools: string[] = [];
  input.push(options.prompt);
  try {
    for await (const m of q) {
      if (m.type === "system" && m.subtype === "init") {
        model = m.model;
        visibleTools = m.tools.filter((t) => t.startsWith(`mcp__${MCP_SERVER}__`));
        const status = m.mcp_servers.find((s) => s.name === MCP_SERVER)?.status;
        if (status !== "connected") throw new ConnectionError(`Media tools ${status ?? "missing"}`);
        // Fail closed: a spending tool must never even be visible.
        const denied = visibleTools.filter((t) =>
          (DENIED_TOOLS as readonly string[]).some((d) => toolId(d) === t),
        );
        if (denied.length) throw new Error(`Refused tools visible: ${denied.join(", ")}`);
        options.log?.({ event: "init", model, connection: options.connection.kind, visibleTools });
      } else if (m.type === "assistant") {
        for (const block of m.message.content) {
          if (block.type === "tool_use") {
            calls.set(block.id, { name: block.name, input: block.input, at: Date.now() });
          }
        }
      } else if (m.type === "user" && Array.isArray(m.message.content)) {
        for (const block of m.message.content) {
          if (typeof block !== "object" || block?.type !== "tool_result") continue;
          const call = calls.get(block.tool_use_id);
          if (!call) continue;
          const texts = textsOf(block.content);
          recordResult(record, call.name, texts, Boolean(block.is_error));
          options.log?.({
            event: "tool",
            tool: call.name,
            input: call.input,
            ms: Date.now() - call.at,
            isError: Boolean(block.is_error),
            result: texts.join("\n").slice(0, 200_000),
          });
        }
      } else if (m.type === "result") {
        attempts++;
        if (m.subtype !== "success" || m.is_error) {
          const why = m.subtype === "success" ? String(m.result) : m.errors.join("\n");
          throw new Error(why || "Claude báo lỗi");
        }
        answer = m.result;
        errors = options.check(answer, record);
        options.log?.({ event: "answer", attempt: attempts, errors, ms: m.duration_ms });
        if (errors.length && attempts < 2) {
          input.push(
            `Your plan broke these rules:\n${errors.map((e) => `- ${e}`).join("\n")}\n\nUse the tools again where you need to (for example to read a schema you have not read), then answer again with the whole corrected plan as one JSON object.`,
          );
        } else {
          input.close();
          q.close();
        }
      }
    }
  } catch (error) {
    if (abort.signal.aborted) throw new Error("Đạo diễn không trả lời kịp");
    throw error;
  } finally {
    clearTimeout(timer);
    input.close();
  }
  return {
    answer,
    errors,
    attempts,
    record,
    durationMs: Date.now() - startedAt,
    model,
    connection: options.connection.kind,
    visibleTools,
  };
}
