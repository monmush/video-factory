import { z } from "zod";
import { DEFAULT_TARGET_SEC, estimateSeconds } from "../../shared/board";
import type { Script } from "../../shared/ipc";
import * as board from "../board";
import * as writer from "../script-writer";

// The agent's only way to change anything: typed tools over the session's
// script board. Scripts are numbered #1, #2… in board order (pinned first),
// exactly as the operator sees them. Every change goes through board.ts, so it
// is saved, pushed to the screen and recorded for the turn's one-step undo.

/** What a tool can do besides changing the board. */
export interface ToolHost {
  sessionId: string;
  log: board.TurnLog;
  /** Replaces the label of the tool call being run, e.g. "Sửa #3". */
  label(text: string): void;
  /** Shows buttons in the chat; a click sends the option as the next message. */
  offerChoices(question: string, options: string[]): void;
  /** Settles when the operator stops the turn. */
  stopped: Promise<void>;
}

const STOPPED = Symbol("stopped");

/**
 * Long writing work keeps going after a stop (cards finish on their own, and
 * the turn's undo already covers them), but the turn stops waiting for it.
 */
const unlessStopped = <T>(host: ToolHost, work: Promise<T>) =>
  Promise.race([work, host.stopped.then((): typeof STOPPED => STOPPED)]);

interface ToolDef<S extends z.ZodRawShape> {
  name: string;
  description: string;
  shape: S;
  /** Shown while the call is still being written by the model. */
  pending: string;
  run(args: z.infer<z.ZodObject<S>>, host: ToolHost): Promise<string>;
}

const define = <S extends z.ZodRawShape>(def: ToolDef<S>) => def;

const seconds = (s: Pick<Script, "lines">) => Math.round(estimateSeconds(s.lines));
const target = (s: Script) => s.brief.targetSec ?? DEFAULT_TARGET_SEC;
const list = (numbers: number[]) => numbers.map((n) => `#${n}`).join(", ");

async function pick(sessionId: string, numbers: number[]) {
  const ordered = await board.orderedScripts(sessionId);
  const missing = numbers.filter((n) => !ordered[n - 1]);
  if (missing.length) {
    throw new Error(`Không có kịch bản ${list(missing)}. Bảng có ${ordered.length} kịch bản.`);
  }
  return { ordered, scripts: numbers.map((n) => ordered[n - 1] as Script) };
}

const numberOf = (ordered: Script[], id: string) => ordered.findIndex((s) => s.id === id) + 1;

const lineShape = z.object({
  speaker: z.string().describe("@handle của nhân vật"),
  text: z.string().min(1),
});

export const TOOLS = [
  define({
    name: "list_scripts",
    description: "Danh sách kịch bản trên bảng: số, tiêu đề, hook, độ dài ước tính, trạng thái.",
    shape: {},
    pending: "Xem bảng kịch bản",
    async run(_args, host) {
      const ordered = await board.orderedScripts(host.sessionId);
      host.label("Xem bảng kịch bản");
      if (ordered.length === 0) return "Bảng chưa có kịch bản nào.";
      return ordered
        .map((s, i) => {
          const state =
            s.status === "writing"
              ? " [đang viết]"
              : s.status === "failed"
                ? " [chưa viết được]"
                : ` (~${seconds(s)} giây)`;
          return `#${i + 1}${s.pinned ? " [ghim]" : ""} ${s.title || "(chưa có tiêu đề)"} — ${s.hook}${state}`;
        })
        .join("\n");
    },
  }),

  define({
    name: "read_scripts",
    description: "Đọc đầy đủ các kịch bản theo số: tiêu đề, hook, lời thoại, sản phẩm, dàn dựng.",
    shape: { numbers: z.array(z.number().int().min(1)).min(1).max(30) },
    pending: "Đọc kịch bản",
    async run({ numbers }, host) {
      const { scripts } = await pick(host.sessionId, numbers);
      host.label(`Đọc ${list(numbers)}`);
      const ctx = await board.writerContext(host.sessionId);
      return scripts
        .map(
          (s, i) =>
            `#${numbers[i]} (~${seconds(s)} giây, mục tiêu ${target(s)} giây):\n${writer.asJson(ctx, s)}`,
        )
        .join("\n\n");
    },
  }),

  define({
    name: "update_script",
    description:
      "Sửa trực tiếp một kịch bản do bạn tự viết. Chỉ gửi các trường cần đổi; lines thay toàn bộ lời thoại. Trả về độ dài ước tính và cảnh báo nếu có.",
    shape: {
      number: z.number().int().min(1),
      title: z.string().max(80).optional(),
      hook: z.string().max(160).optional(),
      lines: z.array(lineShape).min(2).max(30).optional(),
      products: z.array(z.string()).optional().describe("@handle sản phẩm"),
      staging: z.string().max(400).optional(),
    },
    pending: "Sửa kịch bản",
    async run({ number, ...patch }, host) {
      const { scripts } = await pick(host.sessionId, [number]);
      const current = scripts[0] as Script;
      host.label(`Sửa #${number}`);
      const ctx = await board.writerContext(host.sessionId);
      // Merge onto the script as the writer sees it, then normalise like any
      // written script so speakers and products resolve to library assets.
      const base = JSON.parse(writer.asJson(ctx, current)) as writer.RawScript;
      const written = writer.normalise(ctx, {
        ...base,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.hook !== undefined ? { hook: patch.hook } : {}),
        ...(patch.lines ? { lines: patch.lines } : {}),
        ...(patch.products ? { products: patch.products } : {}),
        ...(patch.staging !== undefined ? { staging: patch.staging } : {}),
      });
      const changes: Partial<writer.WrittenScript> = {};
      if (patch.title !== undefined) changes.title = written.title;
      if (patch.hook !== undefined) changes.hook = written.hook;
      if (patch.lines) changes.lines = written.lines;
      if (patch.products) changes.productIds = written.productIds;
      if (patch.staging !== undefined) changes.staging = written.staging;
      const saved = await board.agentUpdate(host.sessionId, current.id, changes, host.log);

      const warnings: string[] = [];
      const unknown = saved.lines.filter((l) => !l.characterId && ctx.characters.length);
      if (unknown.length) {
        warnings.push(
          `người nói không có trong series: ${[...new Set(unknown.map((l) => l.speaker))].join(", ")}`,
        );
      }
      if (patch.products && written.productIds.length < patch.products.length) {
        warnings.push("có sản phẩm không có trong series nên đã bỏ");
      }
      const secs = seconds(saved);
      const goal = target(saved);
      if (secs > goal * 1.12) warnings.push(`dài hơn mục tiêu (${secs} > ${goal} giây)`);
      if (secs < goal * 0.75) warnings.push(`ngắn hơn mục tiêu (${secs} < ${goal} giây)`);
      return `Đã cập nhật #${number}. Độ dài ~${secs} giây (mục tiêu ${goal}).${
        warnings.length ? ` Cần sửa: ${warnings.join("; ")}.` : ""
      }`;
    },
  }),

  define({
    name: "add_scripts",
    description:
      "Thêm kịch bản mới. Bạn lập tiêu đề và hook cho từng kịch bản; người viết sẽ viết lời thoại song song. Chờ đến khi viết xong.",
    shape: {
      topics: z
        .array(
          z.object({
            title: z.string().min(1).describe(writer.TITLE_RULE),
            hook: z.string().min(1).describe(writer.HOOK_RULE),
          }),
        )
        .min(1)
        .max(writer.MAX_COUNT),
      direction: z.string().optional().describe("Yêu cầu chung cho người viết"),
      target_seconds: z.number().int().min(10).max(180).optional(),
    },
    pending: "Lập đề tài",
    async run({ topics, direction, target_seconds }, host) {
      host.label(`Viết ${topics.length} kịch bản mới`);
      const outcome = await unlessStopped(
        host,
        board.agentAdd(
          host.sessionId,
          {
            topics,
            direction: direction?.trim() ?? "",
            targetSec: writer.clampTarget(target_seconds),
          },
          host.log,
        ),
      );
      if (outcome === STOPPED) return "Người dùng đã dừng. Các thẻ đang viết sẽ tự viết xong.";
      const { written, failed } = outcome;
      const ordered = await board.orderedScripts(host.sessionId);
      const lines = written.map(
        (s) => `#${numberOf(ordered, s.id)} ${s.title} (~${seconds(s)} giây)`,
      );
      return `Đã viết ${written.length} kịch bản:\n${lines.join("\n")}${
        failed
          ? `\n${failed} kịch bản chưa viết được (người dùng có thể bấm Thử lại trên thẻ).`
          : ""
      }`;
    },
  }),

  define({
    name: "rewrite_scripts",
    description:
      "Sửa nhiều kịch bản cùng lúc bằng người viết, song song, theo một yêu cầu sửa rõ ràng. Dùng cho sửa lớn hoặc từ 3 kịch bản trở lên.",
    shape: {
      numbers: z.array(z.number().int().min(1)).optional().describe("Bỏ trống khi all = true"),
      all: z.boolean().optional(),
      instruction: z.string().min(1),
      target_seconds: z.number().int().min(10).max(180).optional(),
    },
    pending: "Sửa kịch bản",
    async run({ numbers, all, instruction, target_seconds }, host) {
      const ordered = await board.orderedScripts(host.sessionId);
      const scripts = all ? ordered : (await pick(host.sessionId, numbers ?? [])).scripts;
      if (scripts.length === 0) return "Không có kịch bản nào để sửa.";
      host.label(`Sửa ${scripts.length} kịch bản`);
      const result = await unlessStopped(
        host,
        board.agentRewrite(
          host.sessionId,
          scripts,
          instruction,
          writer.clampTarget(target_seconds),
          host.log,
        ),
      );
      if (result === STOPPED) return "Người dùng đã dừng. Các kịch bản đang sửa sẽ tự sửa xong.";
      const after = await board.orderedScripts(host.sessionId);
      const changed = result.changed.map((s) => `#${numberOf(after, s.id)} (~${seconds(s)} giây)`);
      return [
        changed.length ? `Đã sửa: ${changed.join(", ")}.` : "Không kịch bản nào cần sửa.",
        result.same ? `${result.same} kịch bản không cần đổi.` : "",
        result.failed ? `${result.failed} kịch bản chưa sửa được.` : "",
      ]
        .filter(Boolean)
        .join(" ");
    },
  }),

  define({
    name: "delete_scripts",
    description: "Xóa kịch bản khỏi bảng (người dùng hoàn tác được).",
    shape: { numbers: z.array(z.number().int().min(1)).min(1) },
    pending: "Xóa kịch bản",
    async run({ numbers }, host) {
      const { scripts } = await pick(host.sessionId, numbers);
      host.label(`Xóa ${list(numbers)}`);
      await board.agentDelete(
        host.sessionId,
        scripts.map((s) => s.id),
        host.log,
      );
      return `Đã xóa ${list(numbers)}. Số thứ tự các kịch bản còn lại đã thay đổi.`;
    },
  }),

  define({
    name: "offer_choices",
    description:
      "Hiện vài lựa chọn dạng nút khi yêu cầu có nhiều hướng rõ ràng. Sau khi gọi, kết thúc lượt; lựa chọn của người dùng đến ở tin nhắn sau.",
    shape: {
      question: z.string().min(1).max(160),
      options: z.array(z.string().min(1).max(80)).min(2).max(6),
    },
    pending: "",
    async run({ question, options }, host) {
      host.offerChoices(question, options);
      return "Đã hiện các lựa chọn. Kết thúc lượt này, không viết thêm.";
    },
  }),
] as const;

export type ToolName = (typeof TOOLS)[number]["name"];

/** Tools that show as buttons rather than as an activity row. */
export const SILENT_TOOLS = new Set<string>(["offer_choices"]);

export const pendingLabel = (name: string) =>
  TOOLS.find((t) => t.name === name)?.pending || "Đang làm";

/** Runs a tool by name; errors come back as text for the model to read and correct. */
export async function runTool(
  name: string,
  args: unknown,
  host: ToolHost,
): Promise<{ text: string; isError: boolean }> {
  const def = TOOLS.find((t) => t.name === name);
  if (!def) return { text: `Không có công cụ ${name}`, isError: true };
  const parsed = z.object(def.shape).safeParse(args ?? {});
  if (!parsed.success) return { text: parsed.error.message, isError: true };
  try {
    // biome-ignore lint/suspicious/noExplicitAny: each def checks its own parsed args
    return { text: await def.run(parsed.data as any, host), isError: false };
  } catch (error) {
    return { text: error instanceof Error ? error.message : String(error), isError: true };
  }
}
