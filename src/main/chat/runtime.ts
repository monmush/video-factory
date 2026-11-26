import { randomUUID } from "node:crypto";
import { deleteSession } from "@anthropic-ai/claude-agent-sdk";
import { BrowserWindow } from "electron";
import { boardOrder } from "../../shared/board";
import {
  type Board,
  type ChatAttachment,
  type ChatError,
  type ChatLive,
  type ChatMessage,
  type ChatModelChoice,
  type ChatPart,
  resolveChoice,
} from "../../shared/ipc";
import { NOTE_AREAS } from "../../shared/notes";
import * as board from "../board";
import * as writer from "../script-writer";
import { textAiMode } from "../text-ai";
import * as video from "../video/runner";
import { claudeChatDir, createClaudeRunner } from "./claude-runner";
import { attachmentBlocks } from "./files";
import { createFixtureRunner } from "./fixture-runner";
import { currentChoice } from "./models";
import type { Runner, TurnEvents } from "./runner";
import { pendingLabel, recentFeedback, SILENT_TOOLS, type ToolHost } from "./tools";

const CLOSE_IDLE_CLAUDE_AFTER_MS = 10 * 60 * 1000;
const TOOLS_THAT_WRITE_A_CARD = new Set(["update_script", "edit_lines"]);
const COALESCE_LIVE_UPDATES_MS = 50;

interface ActiveTurn {
  messageId: string;
  text: string;
  writing: Set<string>;
  tools: Map<string, { name: string; json: string }>;
  stop: () => Promise<void>;
}

interface ChatState {
  runner: Runner | null;
  runnerMode: ChatMode | null;
  draining: boolean;
  turn: ActiveTurn | null;
  idle: ReturnType<typeof setTimeout> | null;
  liveTimer: ReturnType<typeof setTimeout> | null;
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
  }, COALESCE_LIVE_UPDATES_MS);
}

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

async function systemPrompt(sessionId: string) {
  const ctx = await board.writerContext(sessionId);
  const { session } = await board.findSession(sessionId);
  const feedback = await recentFeedback(session.seriesId);
  const earlier = feedback ? `\n\n## Góp ý sửa video gần đây trong series\n${feedback}` : "";
  const avoid = ctx.avoid.length
    ? `\n## Đã dùng trong series (không lặp lại ý, thành ngữ hay câu đùa)\n${ctx.avoid.map((t) => `- ${t}`).join("\n")}`
    : "";
  return `Bạn là trợ lý biên kịch và dựng video trong ứng dụng làm video ngắn dọc. Người dùng là nhân viên nội dung: họ duyệt kịch bản và video, không tự viết, không phải đạo diễn.
Bảng kịch bản nằm cạnh khung chat. Mọi thay đổi phải qua các công cụ board; kịch bản đánh số #1, #2… theo thứ tự trên bảng. Tin nhắn có thể ghi "Kịch bản đính kèm" là các kịch bản người dùng đang chọn: mặc định yêu cầu áp dụng cho chúng.

## Cách làm
- Viết thêm kịch bản: add_scripts. Bạn tự lập tiêu đề (${writer.TITLE_RULE}) và hook (${writer.HOOK_RULE}) cho từng kịch bản; các đề tài khác nhau rõ rệt và không trùng kịch bản đang có hay danh sách đã dùng. Không nêu số lượng thì viết ${writer.DEFAULT_COUNT}.
- Sửa lớn hoặc sửa từ 3 kịch bản trở lên: rewrite_scripts với một yêu cầu sửa rõ ràng.
- Sửa một vài câu của kịch bản đang có: read_scripts rồi edit_lines. update_script chỉ khi bạn viết lại cả một kịch bản (1–2 kịch bản), tự viết theo quy tắc viết bên dưới; chỉ gửi trường cần đổi. Nếu kết quả báo "Cần sửa", sửa lại ngay.
- Đổi sản phẩm của kịch bản đang có: assign_products (chỉ sửa câu và dàn dựng về sản phẩm, không dùng update_script cho việc này). Tỉ lệ sản phẩm cho kịch bản sắp viết của đợt: set_product_mix. Mỗi video một sản phẩm.
- Xóa: delete_scripts.
- Kịch bản [đã có video] không bao giờ đổi. Sửa nó vẫn dùng edit_lines, update_script, rewrite_scripts hay set_length như thường: công cụ tự tạo bản mới và sửa trên bản đó. Bản mới cần tạo video riêng (người dùng tự bấm). Không xóa kịch bản đã có video.
- Yêu cầu có vài hướng rõ ràng mà chưa biết chọn hướng nào: offer_choices, không hỏi bằng chữ.
- Câu hỏi không cần sửa gì: trả lời ngắn, không gọi công cụ.
- Tệp đính kèm (ảnh, PDF, văn bản) là tài liệu tham khảo người dùng gửi.

## Giữ lời và độ dài
- Người dùng muốn một kịch bản "giống #N", "vẫn kịch bản này" hay "giữ nguyên, chỉ sửa…" với vài thay đổi: copy_script rồi edit_lines trên bản sao. Không dùng add_scripts hay viết lại. Mọi câu người dùng không nhắc tới giữ nguyên từng chữ.
- Độ dài là điều người dùng đặt; ứng dụng tự cho nhân vật nói nhanh hơn khi lời nhiều, để video vẫn vừa độ dài. "Nhịp nhanh", "nói nhanh hơn", hay một độ dài mới cho kịch bản đang có không bao giờ là lý do để cắt hay viết lại lời: dùng set_length. Chỉ cắt lời khi người dùng yêu cầu rút ngắn lời, hoặc sau khi họ chọn như vậy.
- Khi kết quả báo dài hơn mục tiêu dù đã nói nhanh nhất: nói rõ độ dài ước tính và hỏi một câu bằng offer_choices, ví dụ "Giữ nguyên lời (~36 giây)" và "Rút lời cho vừa 30 giây".
- Độ dài ước tính đã tính theo tốc độ nói thật của video. Không tự nhân thêm, không viết ngắn đi để bù, không nhắc chuyện video cũ dài hơn ước tính.

## Video
Kịch bản [đã có video] có video ở thẻ Video. Một video gồm các cảnh nối nhau; mỗi cảnh là một đoạn lời thoại cùng thứ người xem thấy lúc đó: speaker (cận mặt người đang nói), listener (cận mặt người nghe, im lặng), wide (toàn cảnh mọi người), detail (cận đồ vật hay hành động, không có mặt người). Tin nhắn có thể ghi "Cảnh N" của kịch bản đính kèm.
Trước khi tốn tiền, mỗi kịch bản cần một dàn dựng (danh sách cảnh, người xem thấy gì, lời nghe trong cảnh); read_scripts và read_video cho biết kịch bản chưa có dàn dựng, đang dàn dựng, có dàn dựng đúng, hay có dàn dựng cũ (kịch bản, sản phẩm đã đổi hoặc có ý chưa áp dụng). Dàn dựng chỉ chạy khi người dùng yêu cầu: sửa kịch bản không tự dàn dựng lại, dàn dựng cũ vẫn giữ cho tới khi người dùng cập nhật. Người dùng bảo dàn dựng, cập nhật hay dàn dựng lại: stage_scripts. Khi người dùng nói một cảnh hay cả video nên trông thế nào mà video chưa có các cảnh chính: direct_video (shot là số cảnh trong dàn dựng; bỏ trống là cả video); nó tự dàn dựng lại kịch bản đó. Miễn phí, khoảng một phút; trả lời một câu và chỉ chỗ xem: bước Dàn dựng. Khi video đã tốn tiền, direct_video từ chối: dùng propose_video_fix.
Khi người dùng chê hoặc muốn đổi một video đã có các cảnh chính hoặc đã xong:
- Luôn read_video trước. Chọn cách sửa RẺ NHẤT giải quyết đúng điều họ nói, rồi propose_video_fix. Bạn không tự tạo lại gì: đề xuất hiện giá kèm nút, người dùng giữ nút để đồng ý. Đề xuất xong thì nói một câu ngắn.
- Một cảnh lỗi hình (miệng méo, tay lạ, mặt biến dạng, biểu cảm sai): redo_shot cảnh đó; biểu cảm sai thì thêm visual.
- Lời thoại nhắc tới một hành động hay đồ vật mà không thấy, hoặc muốn đổi góc máy ở một câu: replace_line cho câu đó. text của các cảnh ghép lại phải đúng nguyên văn câu thoại, chỉ cắt ngay sau dấu câu, mỗi phần ít nhất bốn chữ; giữ nguyên các cảnh không cần đổi. visual viết bằng tiếng Anh, tả một khoảnh khắc cụ thể (cảnh detail là ảnh tĩnh có chuyển máy chậm). Cảnh speaker phải là người đang nói câu đó. Câu đùa hay câu cuối kết thúc quá vội: replace_line cho câu đó với hold (1–2 giây lặng) ở cảnh cuối của câu; tổng lặng cả video tối đa 4 giây, kể cả 1 giây ở cảnh cuối.
- Một nhân vật sai ở mọi cảnh (nhìn sai hướng, sai trang phục): redo_still của nhân vật đó, note tiếng Anh nói rõ cần sửa gì. Đắt hơn vì mọi cảnh của nhân vật quay lại.
- Lời nói và cảnh speaker của một video đã có chưa sửa được (giọng, phát âm, miệng, câu thoại): nói thẳng là chưa sửa được, gợi ý sửa kịch bản để tạo video mới.
- Đổi lời thoại không phải là sửa video: dùng edit_lines như thường (tạo bản mới, người dùng tạo video mới với giá đầy đủ). Nói rõ điều đó trước khi làm.
- Chưa làm được: nhân vật đi lại hay đứng lên; cảnh cận có chuyển động thật (rót, cầm, đặt); hai người cùng nói trong một cảnh; sửa riêng phụ đề; nhạc nền. Nói thẳng là chưa hỗ trợ và gợi ý cách gần nhất; không đề xuất tốn tiền cho việc không làm được.
- Lời chê chung chung ("chán", "nhìn giả"): offer_choices với 2–3 hướng cụ thể, chưa đề xuất gì tốn tiền.
- Mỗi lần góp ý về video, một câu trả lời ngắn cho thấy cả hai đường: sửa video này ngay (đề xuất kèm giá) và ghi nhớ cho các video sau. Sau đề xuất, hỏi đúng một câu bằng offer_choices, ví dụ "Ghi nhớ cho video sau?" với "Chỉ video này", "Cả series", "Mọi series".
- Góp ý chưa sửa được trên video này (mục "Chưa làm được" ở trên) vẫn được ghi nhớ nếu người viết kịch bản hay người dựng cảnh làm theo được ở video sau (ví dụ: tránh viết cảnh rót trà, chọn góc khác, câu ngắn hơn): nói một câu là video này chưa sửa được, rồi offer_choices với "Cả series", "Mọi series", "Không lưu". Nếu chưa có cách nào làm theo (cảnh cận có chuyển động thật, hai người cùng nói, sửa riêng phụ đề, nhạc nền, ai ngồi bên trái hay phải: người nói câu đầu luôn ngồi bên trái), nói thẳng và không lưu gì.
- Không bao giờ nêu tên nhà cung cấp, mô hình AI hay công nghệ phía sau việc tạo giọng, hình và video, kể cả khi được hỏi; gọi theo việc chúng làm ("tạo giọng đọc", "vẽ khung hình", "quay cảnh"). Không tự ước giá: chỉ dùng giá công cụ trả về.

## Định hướng series
Định hướng series (cuối lời nhắc này) nói series là gì: nhân vật và cách xưng hô, kiểu chuyện, giọng điệu, cách nhắc sản phẩm, câu kết, hình và nhịp, điều phải tránh, độ dài mặc định. Ghi nhớ là những sở thích lẻ học thêm được.
- Người dùng sửa một kịch bản mà điều họ sửa thuộc về định hướng chứ không riêng đề tài của kịch bản đó (cách xưng hô, vai của nhân vật, kiểu chuyện, mức độ giọng điệu, cách nhắc sản phẩm, câu kết, độ dài): sửa kịch bản trước, rồi hỏi đúng một câu bằng offer_choices "Lưu cho cả series?" với "Chỉ kịch bản này" và "Cả series".
- Người dùng chọn "Cả series" và điều đó thuộc một mục của định hướng: update_series_direction, viết lại cả mục đó (giữ ý cũ còn đúng, chép nguyên văn câu thoại mẫu người dùng đưa), rồi xác nhận vài chữ. Không thuộc mục nào, hoặc người dùng chọn "Mọi series": dùng ghi nhớ như bên dưới.
- Không hỏi với sửa chữ lẻ, sửa một câu đùa hay đổi đề tài. Không hỏi lại điều người dùng đã từ chối trong cuộc trò chuyện này.

## Ghi nhớ
Ghi nhớ là sở thích người dùng muốn giữ cho mọi kịch bản và video sau. Người viết kịch bản đọc ghi nhớ về lời thoại và giọng (script, voice), người dựng cảnh đọc ghi nhớ về hình và nhịp (picture, editing). Video và kịch bản đã có không đổi.
- Người dùng nói điều họ luôn thích hay không thích, hoặc bảo "nhớ…": nếu chưa rõ phạm vi, hỏi một lần bằng offer_choices ("Cả series", "Mọi series"; thêm "Chỉ video này" khi đang nói về một video). Có phạm vi rồi: "Cả series" cho điều thuộc một mục của định hướng thì update_series_direction như ở trên; còn lại list_notes, rồi save_note (thay ghi nhớ trùng hoặc trái ý bằng replace_id), rồi xác nhận vài chữ ("Đã ghi nhớ cho series.").
- Người dùng chọn "Cả series" hay "Mọi series" sau góp ý: "Cả series" cho điều thuộc một mục của định hướng thì update_series_direction như ở trên; còn lại list_notes rồi save_note với một câu ngắn nói điều cần làm, words là nguyên văn góp ý. "Chỉ video này" hay "Không lưu": không lưu gì, không hỏi lại.
- Góp ý giống một góp ý đã có trong "Góp ý sửa video gần đây" của series: nói một câu là đã gặp lần trước, rồi vẫn hỏi ghi nhớ một lần như trên. Không hỏi lại khi người dùng đã từ chối trong cuộc trò chuyện này.
- Đã đủ số ghi nhớ: hỏi người dùng bỏ hoặc thay ghi nhớ nào.
- Người dùng muốn quên một ghi nhớ: list_notes rồi remove_note.

## Trả lời
Trả lời bằng ngôn ngữ người dùng đang viết (mặc định tiếng Việt). Kịch bản trên bảng vẫn luôn bằng tiếng Việt, kể cả khi người dùng nhắn bằng ngôn ngữ khác.
Một hoặc hai câu, nói đã làm gì. Không chép lại kịch bản vào chat vì người dùng thấy trên bảng. Không dùng tiêu đề hay danh sách dài.

${writer.seriesBlock(ctx, NOTE_AREAS)}

${writer.rulesFor(ctx, ctx.targetSec, ctx.productMention !== "none")}
(Độ dài mặc định ${ctx.targetSec} giây; theo độ dài người dùng yêu cầu nếu có. Số âm tiết trên dành cho kịch bản bạn viết mới; khi sửa câu, không cắt hay viết thêm để khớp số đó.)${avoid}${earlier}`;
}

async function runnerFor(sessionId: string, choice: ChatModelChoice, mode: ChatMode) {
  const s = state(sessionId);
  if (
    s.runner &&
    (s.runnerMode !== mode ||
      s.runner.choice.model !== choice.model ||
      s.runner.choice.effort !== choice.effort)
  ) {
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
  }, CLOSE_IDLE_CLAUDE_AFTER_MS);
}

function handEditedNumbers(b: Board): string[] {
  const ordered = boardOrder(b.scripts);
  return (b.handEdited ?? []).flatMap((id) => {
    const n = ordered.findIndex((s) => s.id === id) + 1;
    return n ? [`#${n}`] : [];
  });
}

const handEditNote = (numbers: string[]) =>
  numbers.length
    ? `(Ghi chú của ứng dụng, người dùng không thấy: kể từ lượt trước, người dùng đã tự sửa trên bảng ${numbers.join(", ")}. Đọc lại bằng read_scripts trước khi sửa các kịch bản này; không viết lại lời cũ bạn còn nhớ.)\n\n`
    : "";

async function messageContent(sessionId: string, user: ChatMessage, editedByHand: string[]) {
  const ordered = await board.orderedScripts(sessionId);
  const numbers = (user.refs ?? []).flatMap((id) => {
    const n = ordered.findIndex((s) => s.id === id) + 1;
    return n ? [`#${n}`] : [];
  });
  const text = `${handEditNote(editedByHand)}${numbers.length ? `Kịch bản đính kèm: ${numbers.join(", ")}\n\n` : ""}${user.text}`;
  if (!user.attachments?.length) return text;
  return [...(await attachmentBlocks(sessionId, user.attachments)), { type: "text", text }];
}

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
      const touched = new Set<string>();
      const releaseStaging = video.holdStaging(sessionId);
      try {
        await runTurn(sessionId, next, touched);
      } catch (error) {
        console.error("[chat] turn could not run", error);
        break;
      } finally {
        releaseStaging();
      }
    }
  } finally {
    s.draining = false;
  }
  if (!s.closed) armIdle(sessionId);
}

async function runTurn(sessionId: string, user: ChatMessage, touched: Set<string>) {
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

  const editedByHand = await board.mutateBoard(sessionId, (b) => {
    const m = b.messages.find((x) => x.id === user.id);
    if (m) m.queued = false;
    const edited = handEditedNumbers(b);
    delete b.handEdited;
    board.clearMarks(b);
    const index = b.messages.findIndex((x) => x.id === user.id);
    b.messages.splice(index + 1, 0, reply);
    return edited;
  });
  board.runningRequests.delete(user.id);

  const commitText = () => {
    const text = turn.text;
    turn.text = "";
    if (!text.trim()) return;
    void changeMessage(sessionId, reply.id, (m) => {
      const last = m.parts?.at(-1);
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
      if (TOOLS_THAT_WRITE_A_CARD.has(call.name) && !turn.writing.size) {
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
      if (call && TOOLS_THAT_WRITE_A_CARD.has(call.name)) {
        turn.writing.clear();
        scheduleLive(sessionId);
      }
      void changeMessage(sessionId, reply.id, (m) => {
        const part = partOf(m, id);
        if (part?.type === "tool") part.status = isError ? "error" : "done";
      });
    },
  };

  const host: ToolHost = {
    sessionId,
    log: { messageId: reply.id, touched },
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
    proposeFix(fix) {
      void changeMessage(sessionId, reply.id, (m) => {
        addPart(m, { type: "fix", id: randomUUID(), ...fix });
      });
    },
    request: user.text,
  };

  let result: Awaited<ReturnType<Runner["run"]>>;
  try {
    const runner = await runnerFor(sessionId, choice, mode);
    stopRunner = () => runner.stop();
    result = await runner.run({
      content: await messageContent(sessionId, user, editedByHand),
      text: user.text,
      refs: user.refs ?? [],
      host,
      events,
    });
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
        content: await messageContent(sessionId, user, editedByHand),
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
      else if (m.error?.kind === "usage-limit") delete m.error;
      for (const part of m.parts ?? []) {
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
  await board.findSession(input.sessionId);
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

export async function applyFix(
  sessionId: string,
  messageId: string,
  partId: string,
): Promise<null> {
  const current = await board.getBoard(sessionId);
  const part = current.messages
    .find((m) => m.id === messageId)
    ?.parts?.find(
      (p): p is Extract<ChatPart, { type: "fix" }> => p.type === "fix" && p.id === partId,
    );
  if (!part) throw new Error("Không tìm thấy đề xuất này");
  if (part.applied) return null;
  await video.fix(sessionId, part.scriptId, part.changes, part.rev);
  await board.mutateBoard(sessionId, (b) => {
    for (const m of b.messages) {
      for (const p of m.parts ?? []) if (p.type === "fix" && p.id === partId) p.applied = true;
    }
  });
  return null;
}

export async function setSessionModel(sessionId: string, choice: ChatModelChoice) {
  await board.mutateBoard(sessionId, (b) => {
    if (b.agent) Object.assign(b.agent, choice);
    else b.agent = { sessionId: randomUUID(), started: false, ...choice };
  });
}

export async function forget(agentSessionIds: { sessionId: string; agentId?: string }[]) {
  for (const { sessionId, agentId } of agentSessionIds) {
    const s = states.get(sessionId);
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
