import { randomUUID } from "node:crypto";
import { deleteSession } from "@anthropic-ai/claude-agent-sdk";
import { BrowserWindow } from "electron";
import {
  type ChatAttachment,
  type ChatError,
  type ChatLive,
  type ChatMessage,
  type ChatModelChoice,
  type ChatPart,
  resolveChoice,
} from "../../shared/ipc";
import * as board from "../board";
import * as writer from "../script-writer";
import { textAiMode } from "../text-ai";
import { claudeChatDir, createClaudeRunner } from "./claude-runner";
import { attachmentBlocks } from "./files";
import { createFixtureRunner } from "./fixture-runner";
import { currentChoice } from "./models";
import type { Runner, TurnEvents } from "./runner";
import { pendingLabel, SILENT_TOOLS, type ToolHost } from "./tools";

// The session chat as an agent conversation. One turn runs at a time per
// session; messages sent meanwhile wait in order. Streamed text and "being
// written" hints travel as unsaved "chat:live" updates (coalesced to 50 ms,
// like T3 Code); finished text blocks, tool rows, choices and undo are saved
// on the board as they happen, so a stop or crash keeps everything done so far.
// With fal as the text AI, chat requests use the one-shot pipeline in board.ts.

/** Close an idle Claude process after this long; the next message resumes it. */
const IDLE_MS = 10 * 60 * 1000;
const LIVE_MS = 50;

interface ActiveTurn {
  messageId: string;
  text: string;
  writing: Set<string>;
  /** Tool call id → name and input streamed so far. */
  tools: Map<string, { name: string; json: string }>;
  stop: () => Promise<void>;
}

interface ChatState {
  runner: Runner | null;
  /** Which mode the runner was made for; switching the text AI replaces it. */
  runnerMode: ChatMode | null;
  /** Set synchronously while queued messages are being worked through. */
  draining: boolean;
  turn: ActiveTurn | null;
  idle: ReturnType<typeof setTimeout> | null;
  liveTimer: ReturnType<typeof setTimeout> | null;
  /** The session is being deleted: run nothing more for it. */
  closed: boolean;
}

const states = new Map<string, ChatState>();
const state = (sessionId: string) => {
  let s = states.get(sessionId);
  if (!s) {
    s = {
      runner: null,
      runnerMode: null,
      draining: false,
      turn: null,
      idle: null,
      liveTimer: null,
      closed: false,
    };
    states.set(sessionId, s);
  }
  return s;
};

export type ChatMode = "agent" | "fixture" | "pipeline";

export function chatMode(): ChatMode {
  const mode = textAiMode();
  return mode === "claude-code" ? "agent" : mode === "fixture" ? "fixture" : "pipeline";
}

// ---------------------------------------------------------------- live updates

function sendLive(sessionId: string, live: ChatLive | null) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("chat:live", { sessionId, live });
  }
}

function scheduleLive(sessionId: string) {
  const s = state(sessionId);
  if (s.liveTimer) return;
  s.liveTimer = setTimeout(() => {
    s.liveTimer = null;
    const t = s.turn;
    sendLive(
      sessionId,
      t ? { messageId: t.messageId, text: t.text, writingIds: [...t.writing] } : null,
    );
  }, LIVE_MS);
}

// ---------------------------------------------------------------- saving parts

const changeMessage = (sessionId: string, messageId: string, change: (m: ChatMessage) => void) =>
  board
    .mutateBoard(sessionId, (b) => {
      const m = b.messages.find((x) => x.id === messageId);
      if (m) change(m);
    })
    .catch((error) => console.error("[chat] save failed", error));

function addPart(m: ChatMessage, part: ChatPart) {
  m.parts = [...(m.parts ?? []), part];
}

function partOf(m: ChatMessage, id: string) {
  return m.parts?.find((p) => "id" in p && p.id === id);
}

// ---------------------------------------------------------------- system prompt

async function systemPrompt(sessionId: string) {
  const ctx = await board.writerContext(sessionId);
  const avoid = ctx.avoid.length
    ? `\n## Đã dùng trong series (không lặp lại ý, thành ngữ hay câu đùa)\n${ctx.avoid.map((t) => `- ${t}`).join("\n")}`
    : "";
  return `Bạn là trợ lý biên kịch trong ứng dụng làm video ngắn dọc. Người dùng là nhân viên nội dung: họ duyệt kịch bản, không tự viết.
Bảng kịch bản nằm cạnh khung chat. Mọi thay đổi phải qua các công cụ board; kịch bản đánh số #1, #2… theo thứ tự trên bảng. Tin nhắn có thể ghi "Kịch bản đính kèm" là các kịch bản người dùng đang chọn: mặc định yêu cầu áp dụng cho chúng.

## Cách làm
- Viết thêm kịch bản: add_scripts. Bạn tự lập tiêu đề (${writer.TITLE_RULE}) và hook (${writer.HOOK_RULE}) cho từng kịch bản; các đề tài khác nhau rõ rệt và không trùng kịch bản đang có hay danh sách đã dùng. Không nêu số lượng thì viết ${writer.DEFAULT_COUNT}.
- Sửa lớn hoặc sửa từ 3 kịch bản trở lên: rewrite_scripts với một yêu cầu sửa rõ ràng.
- Sửa nhỏ, chính xác 1–2 kịch bản: read_scripts rồi update_script, tự viết theo quy tắc viết bên dưới. Chỉ gửi trường cần đổi. Nếu kết quả báo "Cần sửa", sửa lại ngay.
- Xóa: delete_scripts.
- Yêu cầu có vài hướng rõ ràng mà chưa biết chọn hướng nào: offer_choices, không hỏi bằng chữ.
- Câu hỏi không cần sửa gì: trả lời ngắn, không gọi công cụ.
- Tệp đính kèm (ảnh, PDF, văn bản) là tài liệu tham khảo người dùng gửi.

## Trả lời
Trả lời bằng ngôn ngữ người dùng đang viết (mặc định tiếng Việt). Kịch bản trên bảng vẫn luôn bằng tiếng Việt, kể cả khi người dùng nhắn bằng ngôn ngữ khác.
Một hoặc hai câu, nói đã làm gì. Không chép lại kịch bản vào chat vì người dùng thấy trên bảng. Không dùng tiêu đề hay danh sách dài.

${writer.seriesBlock(ctx)}

${writer.writingRules(45)}
(Độ dài mặc định 45 giây; theo độ dài người dùng yêu cầu nếu có.)${avoid}`;
}

// ---------------------------------------------------------------- runners

async function runnerFor(sessionId: string, choice: ChatModelChoice, mode: ChatMode) {
  const s = state(sessionId);
  if (
    s.runner &&
    (s.runnerMode !== mode ||
      s.runner.choice.model !== choice.model ||
      s.runner.choice.effort !== choice.effort)
  ) {
    // A different model or effort: reopen the same conversation with it.
    s.runner.close();
    s.runner = null;
  }
  if (s.runner) return s.runner;
  s.runnerMode = mode;
  if (mode === "fixture") {
    s.runner = createFixtureRunner(choice);
    return s.runner;
  }
  const current = await board.getBoard(sessionId);
  let agent = current.agent;
  if (!agent) {
    agent = { sessionId: randomUUID(), started: false, ...choice };
    const fresh = agent;
    await board.mutateBoard(sessionId, (b) => {
      b.agent = fresh;
    });
  }
  const agentId = agent.sessionId;
  s.runner = await createClaudeRunner({
    sessionId: agentId,
    resume: agent.started,
    choice,
    systemPrompt: await systemPrompt(sessionId),
    onStarted: () => {
      void board
        .mutateBoard(sessionId, (b) => {
          if (b.agent?.sessionId === agentId) b.agent.started = true;
        })
        .catch(() => {});
    },
  });
  return s.runner;
}

function closeRunner(sessionId: string) {
  const s = states.get(sessionId);
  if (!s) return;
  if (s.idle) clearTimeout(s.idle);
  s.idle = null;
  s.runner?.close();
  s.runner = null;
}

function armIdle(sessionId: string) {
  const s = state(sessionId);
  if (s.idle) clearTimeout(s.idle);
  s.idle = setTimeout(() => {
    if (!s.turn) closeRunner(sessionId);
  }, IDLE_MS);
}

// ---------------------------------------------------------------- turns

async function messageContent(sessionId: string, user: ChatMessage) {
  const ordered = await board.orderedScripts(sessionId);
  const numbers = (user.refs ?? []).flatMap((id) => {
    const n = ordered.findIndex((s) => s.id === id) + 1;
    return n ? [`#${n}`] : [];
  });
  const text = `${numbers.length ? `Kịch bản đính kèm: ${numbers.join(", ")}\n\n` : ""}${user.text}`;
  if (!user.attachments?.length) return text;
  return [...(await attachmentBlocks(sessionId, user.attachments)), { type: "text", text }];
}

/** Runs queued messages one after another until none are left. */
async function drain(sessionId: string) {
  const s = state(sessionId);
  if (s.draining) return;
  s.draining = true;
  try {
    for (;;) {
      if (s.closed) break;
      const current = await board.getBoard(sessionId).catch(() => null);
      const next = current?.messages.find((m) => m.role === "user" && m.queued);
      if (!next) break;
      try {
        await runTurn(sessionId, next);
      } catch (error) {
        // The session was deleted or its folder became unwritable: stop here.
        console.error("[chat] turn could not run", error);
        break;
      }
    }
  } finally {
    s.draining = false;
  }
  if (!s.closed) armIdle(sessionId);
}

async function runTurn(sessionId: string, user: ChatMessage) {
  const s = state(sessionId);
  const mode = chatMode();
  const current = await board.getBoard(sessionId);
  const choice = current.agent ? resolveChoice(current.agent) : currentChoice();
  const reply: ChatMessage = {
    id: randomUUID(),
    role: "assistant",
    text: "",
    parts: [],
    pending: true,
    model: mode === "fixture" ? "Mẫu" : choice.model,
    at: board.now(),
  };
  board.runningRequests.add(reply.id);
  let markStopped = () => {};
  const stopped = new Promise<void>((resolve) => {
    markStopped = resolve;
  });
  let stopRunner = async () => {};
  const turn: ActiveTurn = {
    messageId: reply.id,
    text: "",
    writing: new Set(),
    tools: new Map(),
    stop: async () => {
      markStopped();
      await stopRunner();
    },
  };
  s.turn = turn;
  if (s.idle) clearTimeout(s.idle);

  await board.mutateBoard(sessionId, (b) => {
    const m = b.messages.find((x) => x.id === user.id);
    if (m) m.queued = false;
    board.clearMarks(b);
    // The reply goes right after its message, before anything still queued.
    const index = b.messages.findIndex((x) => x.id === user.id);
    b.messages.splice(index + 1, 0, reply);
  });
  board.runningRequests.delete(user.id);

  const commitText = () => {
    const text = turn.text;
    turn.text = "";
    if (!text.trim()) return;
    void changeMessage(sessionId, reply.id, (m) => {
      const last = m.parts?.at(-1);
      // Text split around nothing else joins into one part.
      if (last?.type === "text") last.text += text;
      else addPart(m, { type: "text", text });
    });
  };

  const events: TurnEvents = {
    textDelta(text) {
      turn.text += text;
      scheduleLive(sessionId);
    },
    textEnd() {
      commitText();
      scheduleLive(sessionId);
    },
    toolStart(id, name) {
      commitText();
      turn.tools.set(id, { name, json: "" });
      if (SILENT_TOOLS.has(name)) return;
      void changeMessage(sessionId, reply.id, (m) => {
        addPart(m, {
          type: "tool",
          id,
          name,
          label: pendingLabel(name),
          status: "running",
        });
      });
    },
    toolInput(id, partial) {
      const call = turn.tools.get(id);
      if (!call) return;
      call.json += partial;
      // Show the card being written as soon as its number is known.
      if (call.name === "update_script" && !turn.writing.size) {
        const n = Number(call.json.match(/"number"\s*:\s*(\d+)/)?.[1]);
        if (n) {
          void board.orderedScripts(sessionId).then((ordered) => {
            const script = ordered[n - 1];
            if (script && s.turn === turn && turn.tools.has(id)) {
              turn.writing.add(script.id);
              scheduleLive(sessionId);
              void changeMessage(sessionId, reply.id, (m) => {
                const part = partOf(m, id);
                if (part?.type === "tool" && part.status === "running") part.label = `Sửa #${n}`;
              });
            }
          });
        }
      }
    },
    limited(resetsAt) {
      void changeMessage(sessionId, reply.id, (m) => {
        if (resetsAt !== null) {
          m.error = { kind: "usage-limit", message: "", ...(resetsAt ? { resetsAt } : {}) };
        } else if (m.error?.kind === "usage-limit") delete m.error;
      });
    },
    toolEnd(id, isError) {
      const call = turn.tools.get(id);
      turn.tools.delete(id);
      if (call?.name === "update_script") {
        turn.writing.clear();
        scheduleLive(sessionId);
      }
      void changeMessage(sessionId, reply.id, (m) => {
        const part = partOf(m, id);
        if (part?.type === "tool") part.status = isError ? "error" : "done";
      });
    },
  };

  // Tools run in the order the model calls them, so the newest running row
  // without a specific label is the one being run.
  const host: ToolHost = {
    sessionId,
    log: { messageId: reply.id, touched: new Set() },
    label(text) {
      void changeMessage(sessionId, reply.id, (m) => {
        const part = [...(m.parts ?? [])]
          .reverse()
          .find((p) => p.type === "tool" && p.status === "running");
        if (part?.type === "tool") part.label = text;
      });
    },
    stopped,
    offerChoices(question, options) {
      void changeMessage(sessionId, reply.id, (m) => {
        addPart(m, { type: "choices", id: randomUUID(), question, options });
      });
    },
  };

  let result: Awaited<ReturnType<Runner["run"]>>;
  try {
    const runner = await runnerFor(sessionId, choice, mode);
    stopRunner = () => runner.stop();
    result = await runner.run({
      content: await messageContent(sessionId, user),
      text: user.text,
      refs: user.refs ?? [],
      host,
      events,
    });
    // A resumed conversation Claude Code no longer has: start a new one once.
    if (
      result.outcome === "failed" &&
      /no conversation found|session.*not found/i.test(result.error.message) &&
      current.agent?.started
    ) {
      closeRunner(sessionId);
      await board.mutateBoard(sessionId, (b) => {
        b.agent = { sessionId: randomUUID(), started: false, ...choice };
      });
      const fresh = await runnerFor(sessionId, choice, mode);
      stopRunner = () => fresh.stop();
      result = await fresh.run({
        content: await messageContent(sessionId, user),
        text: user.text,
        refs: user.refs ?? [],
        host,
        events,
      });
    }
  } catch (error) {
    const kind = (error as { kind?: string }).kind;
    result = {
      outcome: "failed",
      error: {
        kind: kind === "not-installed" ? "not-installed" : "provider",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
  if (result.outcome === "failed") {
    console.error("[chat] turn failed", result.error);
    // A failed process cannot be trusted with the next turn.
    closeRunner(sessionId);
  }

  commitText();
  const error: ChatError | undefined = result.outcome === "failed" ? result.error : undefined;
  await board
    .mutateBoard(sessionId, (b) => {
      const m = b.messages.find((x) => x.id === reply.id);
      if (!m) return;
      m.pending = false;
      m.outcome = result.outcome;
      if (error) m.error = error;
      // A limit that was waited out (or stopped) is no longer the turn's story.
      else if (m.error?.kind === "usage-limit") delete m.error;
      for (const part of m.parts ?? []) {
        // A stopped turn's last tool was cut short, not broken; "Đã dừng." says so.
        if (part.type === "tool" && part.status === "running") {
          part.status = result.outcome === "failed" ? "error" : "done";
        }
      }
      if (m.undo && !m.undo.before.length && !m.undo.added?.length) delete m.undo;
    })
    .catch(() => {});
  board.runningRequests.delete(reply.id);
  s.turn = null;
  sendLive(sessionId, null);
}

// ---------------------------------------------------------------- public API

export async function send(input: {
  sessionId: string;
  text: string;
  refs: string[];
  attachments: ChatAttachment[];
}): Promise<null> {
  const text = input.text.trim();
  if (!text && !input.attachments.length) return null;
  const mode = chatMode();
  if (mode === "pipeline") {
    if (input.attachments.length) {
      throw new Error("Đính kèm tệp cần Claude. Chọn Claude trong Cài đặt → AI viết văn bản.");
    }
    return board.send(input.sessionId, text, input.refs);
  }
  const { session } = await board.findSession(input.sessionId);
  board.assertEditable(session);
  const message: ChatMessage = {
    id: randomUUID(),
    role: "user",
    text,
    ...(input.refs.length ? { refs: input.refs } : {}),
    ...(input.attachments.length ? { attachments: input.attachments } : {}),
    queued: true,
    at: board.now(),
  };
  board.runningRequests.add(message.id);
  await board.mutateBoard(input.sessionId, (b) => {
    b.messages.push(message);
  });
  void drain(input.sessionId);
  return null;
}

/** The request typed on the series page is the board's first message. */
export async function startFromRequest(sessionId: string): Promise<void> {
  if (chatMode() === "pipeline") return board.startFromRequest(sessionId);
  const current = await board.getBoard(sessionId);
  const first = current.messages[0];
  if (current.messages.length !== 1 || first?.role !== "user") return;
  board.runningRequests.add(first.id);
  await board.mutateBoard(sessionId, (b) => {
    const m = b.messages[0];
    if (m) m.queued = true;
  });
  void drain(sessionId);
}

export async function stop(sessionId: string): Promise<null> {
  await states.get(sessionId)?.turn?.stop();
  return null;
}

export async function discard(sessionId: string, messageId: string): Promise<null> {
  board.runningRequests.delete(messageId);
  await board.mutateBoard(sessionId, (b) => {
    b.messages = b.messages.filter(
      (m) => !(m.id === messageId && m.role === "user" && (m.queued || m.unsent)),
    );
  });
  return null;
}

export async function resend(sessionId: string, messageId: string): Promise<null> {
  const current = await board.getBoard(sessionId);
  const original = current.messages.find((m) => m.id === messageId && m.role === "user");
  if (!original) throw new Error("Không tìm thấy tin nhắn");
  if (original.unsent) await discard(sessionId, messageId);
  return send({
    sessionId,
    text: original.text,
    refs: original.refs ?? [],
    attachments: original.attachments ?? [],
  });
}

export async function choose(
  sessionId: string,
  messageId: string,
  partId: string,
  option: string,
): Promise<null> {
  let fresh = false;
  await board.mutateBoard(sessionId, (b) => {
    const part = b.messages
      .find((m) => m.id === messageId)
      ?.parts?.find(
        (p): p is Extract<ChatPart, { type: "choices" }> => p.type === "choices" && p.id === partId,
      );
    if (!part || part.chosen) return;
    part.chosen = option;
    fresh = true;
  });
  if (!fresh) return null;
  return send({ sessionId, text: option, refs: [], attachments: [] });
}

/** Model for this session's next turns (the conversation itself continues). */
export async function setSessionModel(sessionId: string, choice: ChatModelChoice) {
  await board.mutateBoard(sessionId, (b) => {
    // Before the first turn there is no conversation yet: record the choice on
    // a not-yet-started one, which the first turn then opens with this model.
    if (b.agent) Object.assign(b.agent, choice);
    else b.agent = { sessionId: randomUUID(), started: false, ...choice };
  });
}

/** Stops processes and deletes Claude transcripts of deleted sessions. */
export async function forget(agentSessionIds: { sessionId: string; agentId?: string }[]) {
  for (const { sessionId, agentId } of agentSessionIds) {
    const s = states.get(sessionId);
    // Set before stopping, so the queue does not start the next message.
    if (s) s.closed = true;
    await s?.turn?.stop();
    closeRunner(sessionId);
    states.delete(sessionId);
    if (agentId) await deleteSession(agentId, { dir: claudeChatDir() }).catch(() => {});
  }
}

export function closeAll() {
  for (const id of states.keys()) closeRunner(id);
}
