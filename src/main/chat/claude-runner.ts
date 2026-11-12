import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  createSdkMcpServer,
  type Query,
  query,
  type SDKMessage,
  type SDKUserMessage,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { app } from "electron";
import type { ChatError, ChatModelChoice } from "../../shared/ipc";
import { claudeEnv, findClaude, toLimits } from "../claude-code";
import { dataDir } from "../paths";
import { saveClaudeLimits } from "../usage";
import type { Runner, TurnInput, TurnResult } from "./runner";
import { runTool, TOOLS, type ToolHost } from "./tools";

// One Claude conversation per video session, through the Agent SDK driving the
// user's own installed `claude` (spike: experiments/side-chat-agent/README.md).
// Same restrictions as src/main/claude-code.ts: no built-in tools, no MCP
// servers or settings from disk, an empty working folder. The only tools are
// the board tools. The process stays up between turns and is resumed by
// session id after an idle close or an app restart.

const SERVER = "board";
const toolId = (name: string) => `mcp__${SERVER}__${name}`;

/** Where Claude Code keeps these transcripts (~/.claude/projects/<this folder>). */
export const claudeChatDir = () => join(dataDir(), "claude-chat");

/** Streaming input: one SDK process serves every turn of the session. */
function inbox() {
  const waiting: SDKUserMessage[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  return {
    push(message: SDKUserMessage) {
      waiting.push(message);
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

/** Claude Code's own start-up has no time limit; T3 Code stops waiting after five minutes. */
const BOOT_TIMEOUT_MS = 3 * 60 * 1000;

/** Account problems Claude reports on its messages; only signing in again fixes them. */
const ACCOUNT_ERRORS = new Set([
  "authentication_failed",
  "oauth_org_not_allowed",
  "account_on_hold",
  "verification_required",
  "billing_error",
]);

/**
 * Typed signals first (as T3 Code does): the assistant message's error code
 * and the plan-limit events. The message text only fills in the explanation.
 */
function classify(
  message: string,
  signals: { assistantError: string | null; limitResetsAt: string | null; limited: boolean },
): ChatError {
  if (signals.assistantError && ACCOUNT_ERRORS.has(signals.assistantError)) {
    return { kind: "signed-out", message };
  }
  if (signals.limited || signals.assistantError === "rate_limit") {
    return {
      kind: "usage-limit",
      message,
      ...(signals.limitResetsAt ? { resetsAt: signals.limitResetsAt } : {}),
    };
  }
  if (/not logged in|please run \/login|invalid api key/i.test(message)) {
    return { kind: "signed-out", message };
  }
  return { kind: "provider", message };
}

/** Overage (extra usage) keeps a "rejected" plan window usable. */
function blockedBy(info: {
  status: string;
  overageStatus?: string;
  isUsingOverage?: boolean;
  overageInUse?: boolean;
}) {
  const overage =
    info.overageStatus === "allowed" ||
    info.overageStatus === "allowed_warning" ||
    info.isUsingOverage === true ||
    info.overageInUse === true;
  return info.status === "rejected" && !overage;
}

export async function createClaudeRunner(options: {
  sessionId: string;
  resume: boolean;
  choice: ChatModelChoice;
  systemPrompt: string;
  /** Called once Claude Code has started the conversation, so later opens resume it. */
  onStarted: () => void;
}): Promise<Runner> {
  const bin = await findClaude();
  if (!bin) throw Object.assign(new Error("Chưa cài Claude Code"), { kind: "not-installed" });
  const cwd = claudeChatDir();
  await mkdir(cwd, { recursive: true });

  // Tool calls arrive while a turn runs; they act for that turn.
  let host: ToolHost | null = null;
  const server = createSdkMcpServer({
    name: SERVER,
    version: app.getVersion(),
    tools: TOOLS.map((def) =>
      tool(def.name, def.description, def.shape, async (args) => {
        if (!host)
          return {
            content: [{ type: "text", text: "Không có lượt nào đang chạy" }],
            isError: true,
          };
        const result = await runTool(def.name, args, host);
        return { content: [{ type: "text", text: result.text }], isError: result.isError };
      }),
    ),
  });

  const input = inbox();
  const q: Query = query({
    prompt: input,
    options: {
      pathToClaudeCodeExecutable: bin,
      cwd,
      ...(options.choice.model !== "default" ? { model: options.choice.model } : {}),
      ...(options.choice.effort ? { effort: options.choice.effort } : {}),
      systemPrompt: options.systemPrompt,
      tools: [],
      mcpServers: { [SERVER]: server },
      allowedTools: TOOLS.map((t) => toolId(t.name)),
      permissionMode: "dontAsk",
      settingSources: [],
      strictMcpConfig: true,
      includePartialMessages: true,
      ...(options.resume ? { resume: options.sessionId } : { sessionId: options.sessionId }),
      env: {
        ...claudeEnv(),
        CLAUDE_AGENT_SDK_CLIENT_APP: `hyan-video-factory/${app.getVersion()}`,
      },
      stderr: (data) => console.error("[chat] claude:", data.trim().slice(0, 500)),
    },
  });

  // The current turn, settled by its result message.
  let turn: {
    input: TurnInput;
    resolve: (result: TurnResult) => void;
    stopping: boolean;
    limitResetsAt: string | null;
    limited: boolean;
    assistantError: string | null;
    /** Content block index → tool call id or "text". */
    blocks: Map<number, string>;
  } | null = null;

  const finish = (result: TurnResult) => {
    const current = turn;
    turn = null;
    host = null;
    current?.resolve(result);
  };

  let booted = false;
  const handle = (m: SDKMessage) => {
    booted = true;
    if (m.type === "system" && m.subtype === "init") {
      options.onStarted();
      return;
    }
    if (m.type === "rate_limit_event") {
      const info = m.rate_limit_info;
      void saveClaudeLimits(toLimits(info as never)).catch(() => {});
      if (!turn) return;
      if (blockedBy(info)) {
        turn.limited = true;
        turn.limitResetsAt = info.resetsAt ? new Date(info.resetsAt * 1000).toISOString() : null;
        turn.input.events.limited(turn.limitResetsAt ?? "");
      } else if (turn.limited && (info.status === "allowed" || info.status === "allowed_warning")) {
        turn.limited = false;
        turn.input.events.limited(null);
      }
      return;
    }
    if (!turn) return;
    const events = turn.input.events;
    if (m.type === "stream_event") {
      if (m.parent_tool_use_id) return;
      const e = m.event;
      if (e.type === "content_block_start") {
        if (e.content_block.type === "text") turn.blocks.set(e.index, "text");
        else if (e.content_block.type === "tool_use") {
          turn.blocks.set(e.index, e.content_block.id);
          events.toolStart(e.content_block.id, e.content_block.name.replace(toolId(""), ""));
        }
      } else if (e.type === "content_block_delta") {
        if (e.delta.type === "text_delta") events.textDelta(e.delta.text);
        else if (e.delta.type === "input_json_delta") {
          const id = turn.blocks.get(e.index);
          if (id && id !== "text") events.toolInput(id, e.delta.partial_json);
        }
      } else if (e.type === "content_block_stop") {
        if (turn.blocks.get(e.index) === "text") events.textEnd();
      } else if (e.type === "message_start") {
        turn.blocks.clear();
      }
      return;
    }
    if (m.type === "user" && Array.isArray(m.message.content)) {
      for (const block of m.message.content) {
        if (typeof block === "object" && block && block.type === "tool_result") {
          events.toolEnd(block.tool_use_id, Boolean(block.is_error));
        }
      }
      return;
    }
    if (m.type === "assistant") {
      if (m.error) turn.assistantError = m.error;
      return;
    }
    if (m.type === "result") {
      if (turn.stopping) finish({ outcome: "stopped" });
      else if (m.subtype === "success" && !m.is_error) finish({ outcome: "done" });
      else {
        const text =
          m.subtype === "success"
            ? String(m.result ?? "")
            : (m.errors ?? []).filter((e) => !e.startsWith("[ede_diagnostic]")).join("\n");
        finish({ outcome: "failed", error: classify(text || "Claude báo lỗi", turn) });
      }
    }
  };

  let closed = false;
  const reader = (async () => {
    for await (const m of q) handle(m);
  })()
    .catch((error) => {
      console.error("[chat] claude stopped", error);
      const message = error instanceof Error ? error.message : String(error);
      finish({
        outcome: "failed",
        error: classify(
          message,
          turn ?? { assistantError: null, limitResetsAt: null, limited: false },
        ),
      });
    })
    .finally(() => {
      closed = true;
      // The process ended between turns or mid-turn: settle whatever is waiting.
      if (turn)
        finish({ outcome: "failed", error: { kind: "provider", message: "Claude đã dừng" } });
    });
  void reader;

  return {
    choice: options.choice,
    run(turnInput) {
      if (closed) {
        return Promise.resolve({
          outcome: "failed",
          error: { kind: "provider", message: "Claude đã dừng" },
        });
      }
      return new Promise<TurnResult>((resolve) => {
        turn = {
          input: turnInput,
          resolve,
          stopping: false,
          limitResetsAt: null,
          limited: false,
          assistantError: null,
          blocks: new Map(),
        };
        // The first turn starts the process; give up if it never answers.
        if (!booted) {
          const current = turn;
          setTimeout(() => {
            if (!booted && turn === current) {
              q.close();
              finish({
                outcome: "failed",
                error: { kind: "provider", message: "Claude không khởi động được. Thử lại sau." },
              });
            }
          }, BOOT_TIMEOUT_MS);
        }
        host = turnInput.host;
        input.push({
          type: "user",
          message: {
            role: "user",
            content: turnInput.content as SDKUserMessage["message"]["content"],
          },
          parent_tool_use_id: null,
        });
      });
    },
    async stop() {
      if (!turn) return;
      turn.stopping = true;
      await q.interrupt().catch(() => {});
    },
    close() {
      input.close();
      q.close();
    },
  };
}
