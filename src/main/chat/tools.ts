import { appendFile, readFile } from "node:fs/promises";
import { z } from "zod";
import { clampTarget } from "../../shared/board";
import { spentUsd } from "../../shared/cost/charges";
import { moneyText, paidSoFar } from "../../shared/cost/table";
import { formatCost } from "../../shared/credits";
import { directionAt } from "../../shared/direction";
import type { Asset, ChatPart, Script } from "../../shared/ipc";
import { applyLineChanges, type LineChange } from "../../shared/line-changes";
import { MAX_NOTES, NOTE_AREAS, type Note } from "../../shared/notes";
import {
  fasterThanBrisk,
  lengthFit,
  scriptPace,
  scriptSeconds,
  scriptTargetSec,
} from "../../shared/pace";
import { mixProblem } from "../../shared/product-mix";
import { MERGE_WISH } from "../../shared/scene-actions";
import {
  directionText,
  GUIDE_LINE_MAX,
  GUIDE_SLOTS,
  type GuideEdit,
  PRODUCT_MENTIONS,
  seriesTargetSec,
} from "../../shared/series-guide";
import { stagedWithoutPlace } from "../../shared/series-place";
import type { PlannedShot } from "../../shared/shot-plan";
import {
  OUTDATED_TEXT,
  type OutdatedReason,
  type StagingStatus,
  stageable,
} from "../../shared/staging-status";
import { canFix, type FixChange } from "../../shared/video-fix";
import { frameFor, isGenerated, jobPhase, type VideoJob } from "../../shared/video-job";
import * as board from "../board";
import { dataFile } from "../paths";
import { setProduct } from "../product-change";
import * as writer from "../script-writer";
import { getWorkspace, removeNote, saveNote, updateSeries, updateSession } from "../store";
import * as video from "../video/runner";

export interface ToolHost {
  sessionId: string;
  log: board.TurnLog;
  label(text: string): void;
  offerChoices(question: string, options: string[]): void;
  proposeFix(fix: Omit<Extract<ChatPart, { type: "fix" }>, "type" | "id">): void;
  request: string;
  stopped: Promise<void>;
}

const STOPPED = Symbol("stopped");

const unlessStopped = <T>(host: ToolHost, work: Promise<T>) =>
  Promise.race([work, host.stopped.then((): typeof STOPPED => STOPPED)]);

interface ToolDef<S extends z.ZodRawShape> {
  name: string;
  description: string;
  shape: S;
  pending: string;
  run(args: z.infer<z.ZodObject<S>>, host: ToolHost): Promise<string>;
}

interface Tool {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  pending: string;
  execute(args: unknown, host: ToolHost): Promise<string>;
}

const define = <S extends z.ZodRawShape>(def: ToolDef<S>): Tool => ({
  name: def.name,
  description: def.description,
  shape: def.shape,
  pending: def.pending,
  async execute(args, host) {
    const parsed = z.object(def.shape).safeParse(args ?? {});
    if (!parsed.success) throw new Error(parsed.error.message);
    return def.run(parsed.data, host);
  },
});

const seconds = (s: Pick<Script, "lines" | "brief">, fallbackSec: number) =>
  Math.round(scriptSeconds(s, fallbackSec));

const FASTER_TO_FIT = " Nhân vật nói nhanh hơn một chút để vừa độ dài.";
const LONG_EVEN_AT_FASTEST =
  " Dài hơn mục tiêu dù nhân vật đã nói nhanh nhất. Không tự cắt lời: báo người dùng độ dài này và hỏi có muốn rút lời không, trừ khi họ đã yêu cầu rút ngắn.";
const SHORTER_THAN_TARGET =
  " Ngắn hơn mục tiêu; không cần viết thêm nếu người dùng chỉ yêu cầu sửa câu.";

function lengthLine(s: Pick<Script, "lines" | "brief">, fallbackSec: number): string {
  const goal = scriptTargetSec(s, fallbackSec);
  const secs = seconds(s, fallbackSec);
  const fit = lengthFit(scriptSeconds(s, fallbackSec), goal);
  const note =
    fit === "long"
      ? LONG_EVEN_AT_FASTEST
      : fit === "short"
        ? SHORTER_THAN_TARGET
        : fasterThanBrisk(scriptPace(s, fallbackSec))
          ? FASTER_TO_FIT
          : "";
  return `Độ dài ~${secs} giây (mục tiêu ${goal}).${note}`;
}

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

const key = (s: string) => s.replace(/^@/, "").replace(/\s+/g, " ").trim().toLowerCase();
const named = (assets: Asset[], name: string) =>
  assets.find((a) => key(a.name) === key(name) || key(a.handle) === key(name));

function productArg(assets: Asset[], value: string): Asset | null {
  if (/^(không|khong|none|-)?$/i.test(key(value))) return null;
  const product = named(
    assets.filter((a) => a.kind === "product"),
    value,
  );
  if (!product) {
    const names = assets.filter((a) => a.kind === "product").map((a) => `@${a.handle}`);
    throw new Error(
      `Không có sản phẩm "${value}". Thư viện có: ${names.join(", ") || "(chưa có)"}.`,
    );
  }
  return product;
}

const STATUS: Record<VideoJob["status"], string> = {
  idle: "chưa bắt đầu",
  waiting: "đang chờ tới lượt (chưa sửa được)",
  running: "đang tạo (chưa sửa được)",
  stopped: "đã dừng giữa chừng (người dùng bấm tạo tiếp trước khi sửa)",
  failed: "bị lỗi giữa chừng (người dùng bấm tạo tiếp trước khi sửa)",
  review:
    "đang chờ người dùng nghe và xem các cảnh chính trước khi quay (sửa khung hình lúc này rất rẻ)",
  done: "xong",
};

interface Staging {
  status: StagingStatus;
  reasons: OutdatedReason[];
}

function stagingLine({ status, reasons }: Staging): string {
  switch (status) {
    case "none":
      return "Chưa có dàn dựng. Chỉ dàn dựng khi người dùng yêu cầu (stage_scripts).";
    case "staging":
      return "Đang dàn dựng.";
    case "failed":
      return "Lần dàn dựng trước bị lỗi; dàn dựng lại khi người dùng yêu cầu (stage_scripts).";
    case "outdated":
      return `Dàn dựng cũ: ${reasons
        .map((r) => OUTDATED_TEXT[r].toLocaleLowerCase("vi"))
        .join(", ")}. Chưa tạo video được cho đến khi người dùng cập nhật (stage_scripts).`;
    default:
      return "";
  }
}

function describeVideo(number: number, job: VideoJob, assets: Asset[], staging: Staging) {
  const name = (id: string | null | undefined) => assets.find((a) => a.id === id)?.name ?? "?";
  const stills = job.frames.map((f) => {
    const what =
      f.kind === "wide"
        ? "wide (toàn cảnh)"
        : f.kind === "character"
          ? `${name(f.characterId)}${(() => {
              const seat = job.plan?.seats.find((s) => s.characterId === f.characterId);
              return seat ? `, ngồi ${seat.side}, nhìn ${seat.looks}` : "";
            })()}`
          : f.kind === "product"
            ? isGenerated(job, f)
              ? `sản phẩm ${name(f.productId)} đặt vào cảnh (cảnh ${(f.shot ?? 0) + 1}; chỉ vẽ lại được chỗ đặt, ảnh sản phẩm luôn giữ nguyên)`
              : `ảnh gốc sản phẩm ${name(f.productId)} (cảnh ${(f.shot ?? 0) + 1}; không tạo lại được)`
            : `cận cảnh của cảnh ${(f.shot ?? 0) + 1}`;
    const from = f.source === "look" ? " [giữ từ video trước của series]" : "";
    return `- ${what}${from}${f.check ? ` [kiểm tra tự động thấy: ${f.check}]` : ""}`;
  });
  const shots = job.shots.map((s) => {
    const who = s.characterId ? ` ${name(s.characterId)}` : "";
    const framing = s.framing ? ` (${s.framing})` : "";
    const product = s.productId ? ` [ảnh sản phẩm ${name(s.productId)}]` : "";
    const seconds =
      s.start !== undefined && s.end !== undefined ? ` ${(s.end - s.start).toFixed(1)}s` : "";
    const hold = s.hold ? ` [lặng ${s.hold}s sau lời]` : "";
    return `${s.index + 1}. ${s.kind}${who}${framing}${product}${seconds}${hold} — câu ${s.lineIndex + 1}: "${s.text}"${
      s.brief ? ` | người xem thấy: ${s.brief}` : ""
    }${s.visual ? ` | hình: ${s.visual}` : ""}${
      directionAt(job.direction, s.text)
        ? ` | ý người dùng: ${directionAt(job.direction, s.text)?.want}`
        : ""
    }`;
  });
  const whole = (job.direction ?? []).filter((d) => !d.words);
  return [
    `Video #${number}: ${STATUS[job.status]}; ${job.shots.length} cảnh; đã dùng ${moneyText(paidSoFar(job))}.`,
    stagingLine(staging),
    whole.length ? `Ý người dùng cho cả video:\n${whole.map((d) => `- ${d.want}`).join("\n")}` : "",
    job.previous?.final
      ? 'Có bản trước lần sửa gần nhất (người dùng tự bấm "Bản trước" để quay lại).'
      : "",
    `Lời thoại:\n${job.lines.map((l, i) => `${i + 1}. ${l.speaker}: ${l.text}`).join("\n")}`,
    stills.length ? `Khung hình:\n${stills.join("\n")}` : "",
    shots.length ? `Cảnh (thứ tự trong video):\n${shots.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function describePlan(job: VideoJob | null, staging: Staging): string {
  const line = stagingLine(staging);
  if (!job?.plan || staging.status === "staging" || stagedWithoutPlace(job)) return line;
  const rows = job.shots.map((s) => {
    const want = directionAt(job.direction, s.text)?.want;
    return `${s.index + 1}. ${s.brief ?? s.kind} — "${s.text}"${want ? ` [ý người dùng: ${want}]` : ""}`;
  });
  const whole = (job.direction ?? []).filter((d) => !d.words).map((d) => `- ${d.want}`);
  return [
    ...(line ? [line] : []),
    `Dàn dựng (${job.shots.length} cảnh; ${job.status === "idle" && spentUsd(job) === 0 ? "chưa tốn gì, sửa được bằng direct_video" : "video đã bắt đầu tạo"}):`,
    ...rows,
    ...(whole.length ? ["Ý người dùng cho cả video:", ...whole] : []),
  ].join("\n");
}

const shotShape = z.object({
  type: z.enum(["speaker", "listener", "wide", "detail"]),
  character: z.string().optional().describe("Tên nhân vật trên hình (speaker, listener)"),
  framing: z.enum(["medium_close", "close"]).optional(),
  text: z.string().min(1).describe("Nguyên văn phần lời thoại nghe trong cảnh này"),
  visual: z.string().describe("Tiếng Anh: một khoảnh khắc cụ thể trong khung hình"),
  product: z.string().optional().describe("Tên sản phẩm: cảnh cận dùng ảnh gốc của nó"),
  hold: z
    .number()
    .min(1)
    .max(2)
    .optional()
    .describe("Giây lặng sau lời (1–2), chỉ ở cảnh cuối của câu, để câu thoại kịp ngấm"),
});

const changeShape = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("redo_shot"),
    shot: z.number().int().min(1),
    visual: z.string().optional().describe("Tiếng Anh: chỉ khi cần đổi điều cảnh thể hiện"),
  }),
  z.object({
    op: z.literal("redo_still"),
    still: z.string().describe('"wide" hoặc tên nhân vật'),
    note: z.string().min(1).describe("Tiếng Anh: cần sửa gì trong khung hình"),
  }),
  z.object({
    op: z.literal("replace_line"),
    line: z.number().int().min(1),
    shots: z.array(shotShape).min(1).max(6),
  }),
]);

function toChanges(
  input: z.infer<typeof changeShape>[],
  job: VideoJob,
  assets: Asset[],
  script: Script,
): FixChange[] {
  const cast = assets.filter((a) => job.lines.some((l) => l.characterId === a.id));
  const products = assets.filter((a) => script.productIds.includes(a.id));
  return input.map((change): FixChange => {
    if (change.op === "redo_shot") {
      return { op: "redo_shot", shot: change.shot - 1, visual: change.visual };
    }
    if (change.op === "redo_still") {
      if (key(change.still) === "wide")
        return { op: "redo_still", frame: "wide", note: change.note };
      const character = named(cast, change.still);
      if (!character) throw new Error(`Không có nhân vật "${change.still}" trong video này`);
      return { op: "redo_still", frame: `character:${character.id}`, note: change.note };
    }
    const line = change.line - 1;
    const shots = change.shots.map((s): PlannedShot => {
      const onScreen = s.type === "speaker" || s.type === "listener";
      const character = onScreen
        ? s.type === "speaker" && !s.character
          ? cast.find((a) => a.id === job.lines[line]?.characterId)
          : named(cast, s.character ?? "")
        : undefined;
      if (onScreen && !character)
        throw new Error(`Không có nhân vật "${s.character}" trong video này`);
      const product = s.type === "detail" && s.product ? named(products, s.product) : undefined;
      if (s.type === "detail" && s.product && !product) {
        throw new Error(`Kịch bản này không có sản phẩm "${s.product}"`);
      }
      return {
        kind: s.type,
        characterId: character?.id ?? null,
        framing: onScreen ? (s.framing ?? "medium_close") : null,
        line,
        text: s.text.replace(/\s+/g, " ").trim(),
        visual: s.visual.trim(),
        productId: product?.id ?? null,
        why: "operator feedback",
        ...(s.hold ? { hold: s.hold } : {}),
      };
    });
    return { op: "replace_line", line, shots };
  });
}

const lineShape = z.object({
  speaker: z.string().describe("@handle của nhân vật"),
  text: z.string().min(1),
});

async function seriesOf(sessionId: string) {
  const { ws, session } = await board.findSession(sessionId);
  const series = ws.series.find((s) => s.id === session.seriesId);
  if (!series) throw new Error("Không tìm thấy series");
  return { ws, series };
}

const fallbackSecOf = async (sessionId: string) =>
  seriesTargetSec((await seriesOf(sessionId)).series);

const copiedNote = (number: number, savedNumber: number) =>
  `#${number} đã có video nên giữ nguyên; đã sửa trên bản mới #${savedNumber}. Báo người dùng một câu như vậy. Lần sửa sau trong lượt này dùng #${savedNumber}.`;

const lineChangeShape = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("replace"),
    line: z.number().int().min(1).describe("Số câu trong kịch bản trước lần gọi này"),
    text: z.string().min(1),
    speaker: z.string().optional().describe("@handle của nhân vật; bỏ trống là giữ người nói"),
  }),
  z.object({
    op: z.literal("insert"),
    after: z
      .number()
      .int()
      .min(0)
      .describe("Chèn sau câu số này (trong kịch bản trước lần gọi này); 0 là lên đầu"),
    speaker: z.string().describe("@handle của nhân vật"),
    text: z.string().min(1),
  }),
  z.object({
    op: z.literal("delete"),
    line: z.number().int().min(1).describe("Số câu trong kịch bản trước lần gọi này"),
  }),
]);

function changeSummary(changed: { replaced: number[]; inserted: number; deleted: number[] }) {
  const text = [
    changed.replaced.length ? `đã sửa câu ${changed.replaced.join(", ")}` : "",
    changed.inserted ? `thêm ${changed.inserted} câu` : "",
    changed.deleted.length ? `xóa câu ${changed.deleted.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  return text && `${text[0]?.toLocaleUpperCase("vi")}${text.slice(1)}`;
}

const FEEDBACK_LINES = 8;

export async function recentFeedback(seriesId: string, skipLatest = false): Promise<string> {
  const text = await readFile(dataFile("feedback.jsonl"), "utf8").catch(() => "");
  if (!text) return "";
  const sessions = new Set(
    (await getWorkspace()).sessions.filter((s) => s.seriesId === seriesId).map((s) => s.id),
  );
  const rows = text
    .split("\n")
    .flatMap((line) => {
      try {
        const row = JSON.parse(line) as {
          at?: string;
          sessionId?: string;
          request?: string;
          summary?: string;
        };
        return row.sessionId && sessions.has(row.sessionId) ? [row] : [];
      } catch {
        return [];
      }
    })
    .slice(0, skipLatest ? -1 : undefined)
    .slice(-FEEDBACK_LINES);
  return rows
    .map((r) => `- ${(r.at ?? "").slice(0, 10)}: "${r.request ?? ""}" → ${r.summary ?? ""}`)
    .join("\n");
}

export const TOOLS = [
  define({
    name: "list_scripts",
    description:
      "Danh sách kịch bản trên bảng: số, tiêu đề, hook, độ dài ước tính, trạng thái. [đã có video] là kịch bản đã gửi làm video.",
    shape: {},
    pending: "Xem bảng kịch bản",
    async run(_args, host) {
      const ordered = await board.orderedScripts(host.sessionId);
      const sent = await board.sentScriptIds(host.sessionId);
      const { assets } = await getWorkspace();
      const fallbackSec = await fallbackSecOf(host.sessionId);
      host.label("Xem bảng kịch bản");
      if (ordered.length === 0) return "Bảng chưa có kịch bản nào.";
      return ordered
        .map((s, i) => {
          const state =
            s.status === "writing"
              ? " [đang viết]"
              : s.status === "failed"
                ? " [chưa viết được]"
                : ` (~${seconds(s, fallbackSec)} giây)`;
          const tags = `${s.pinned ? " [ghim]" : ""}${sent.has(s.id) ? " [đã có video]" : ""}${
            s.version ? ` [bản ${s.version}]` : ""
          }`;
          const product = assets.find((a) => a.id === s.productIds[0])?.name;
          return `#${i + 1}${tags} ${s.title || "(chưa có tiêu đề)"} — ${s.hook}${state}${
            product ? ` [${product}]` : ""
          }`;
        })
        .join("\n");
    },
  }),

  define({
    name: "read_scripts",
    description:
      "Đọc đầy đủ các kịch bản theo số: tiêu đề, hook, lời thoại, sản phẩm, ghi chú dàn dựng, và khi đã có: dàn dựng của video (cảnh đánh số, người xem thấy gì, lời nghe trong cảnh, ý người dùng đã lưu).",
    shape: { numbers: z.array(z.number().int().min(1)).min(1).max(30) },
    pending: "Đọc kịch bản",
    async run({ numbers }, host) {
      const { scripts } = await pick(host.sessionId, numbers);
      host.label(`Đọc ${list(numbers)}`);
      const ctx = await board.writerContext(host.sessionId);
      const plans = await Promise.all(
        scripts.map(async (s) =>
          describePlan(
            await video.jobFor(host.sessionId, s.id),
            await video.stagingOf(host.sessionId, s.id),
          ),
        ),
      );
      return scripts
        .map(
          (s, i) =>
            `#${numbers[i]} (~${seconds(s, ctx.targetSec)} giây, mục tiêu ${scriptTargetSec(s, ctx.targetSec)} giây):\n${writer.asJson(ctx, s)}${
              plans[i] ? `\n${plans[i]}` : ""
            }`,
        )
        .join("\n\n");
    },
  }),

  define({
    name: "update_script",
    description:
      "Viết lại trực tiếp cả một kịch bản do bạn tự viết. Chỉ gửi các trường cần đổi; lines thay toàn bộ lời thoại. Sửa, thêm hay xóa vài câu thì dùng edit_lines, không dùng update_script. Trả về độ dài ước tính và cảnh báo nếu có.",
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
      const { script: saved, copied } = await board.agentUpdate(
        host.sessionId,
        current.id,
        changes,
        host.log,
      );
      const savedNumber = numberOf(await board.orderedScripts(host.sessionId), saved.id);

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
      const where = copied ? copiedNote(number, savedNumber) : `Đã cập nhật #${number}.`;
      return `${where} ${lengthLine(saved, ctx.targetSec)}${
        warnings.length ? ` Cần sửa: ${warnings.join("; ")}.` : ""
      }`;
    },
  }),

  define({
    name: "edit_lines",
    description:
      "Sửa, thêm hoặc xóa vài câu thoại của một kịch bản; mọi câu khác giữ nguyên từng chữ. line và after là số câu như khi đọc kịch bản trước lần gọi này (read_scripts), kể cả khi cùng lần gọi có thêm hay xóa câu khác. Kịch bản [đã có video] được sửa trên bản mới. Trả về các câu đã đổi và độ dài ước tính.",
    shape: {
      number: z.number().int().min(1),
      changes: z.array(lineChangeShape).min(1).max(30),
    },
    pending: "Sửa câu thoại",
    async run({ number, changes }, host) {
      const { scripts } = await pick(host.sessionId, [number]);
      const current = scripts[0] as Script;
      host.label(`Sửa câu #${number}`);
      const ctx = await board.writerContext(host.sessionId);
      const resolved = changes.map((c): LineChange => {
        if (c.op === "delete") return c;
        if (c.op === "insert") return { ...c, speaker: writer.speakerOf(ctx, c.speaker) };
        const { speaker, ...rest } = c;
        return speaker === undefined ? rest : { ...rest, speaker: writer.speakerOf(ctx, speaker) };
      });
      const changed = applyLineChanges(current.lines, resolved);
      const summary = changeSummary(changed);
      if (!summary)
        return `Không câu nào của #${number} thay đổi. ${lengthLine(current, ctx.targetSec)}`;
      const { script: saved, copied } = await board.agentUpdate(
        host.sessionId,
        current.id,
        { lines: structuredClone(changed.lines) },
        host.log,
      );
      const savedNumber = numberOf(await board.orderedScripts(host.sessionId), saved.id);
      const unknown = changed.lines.filter(
        (l) => !l.characterId && ctx.characters.length && !current.lines.includes(l),
      );
      const where = copied ? `${copiedNote(number, savedNumber)} ` : `#${number}: `;
      return `${where}${summary}. ${lengthLine(saved, ctx.targetSec)}${
        unknown.length
          ? ` Cần sửa: người nói không có trong series: ${[...new Set(unknown.map((l) => l.speaker))].join(", ")}.`
          : ""
      }`;
    },
  }),

  define({
    name: "copy_script",
    description:
      "Tạo một bản sao y hệt của một kịch bản (lời thoại, tiêu đề, hook, sản phẩm, ghi chú dàn dựng, độ dài), đặt ngay sau kịch bản đó; dùng được cho mọi kịch bản, kể cả [đã có video]. Dùng khi người dùng muốn một kịch bản giống #N với vài thay đổi: copy_script rồi edit_lines trên bản sao. Trả về số của bản sao.",
    shape: { number: z.number().int().min(1) },
    pending: "Sao chép kịch bản",
    async run({ number }, host) {
      const { scripts } = await pick(host.sessionId, [number]);
      host.label(`Sao chép #${number}`);
      const copy = await board.agentCopy(host.sessionId, (scripts[0] as Script).id, host.log);
      const copyNumber = numberOf(await board.orderedScripts(host.sessionId), copy.id);
      return `Đã tạo bản sao #${copyNumber} của #${number}, giống hệt bản gốc. Sửa trên #${copyNumber}; #${number} giữ nguyên. Số thứ tự các kịch bản sau bản sao đã tăng thêm một.`;
    },
  }),

  define({
    name: "set_length",
    description:
      "Đặt độ dài video (giây) cho các kịch bản mà không đổi lời thoại: nhân vật tự nói nhanh hơn khi lời nhiều để vừa độ dài. Dùng khi người dùng muốn độ dài mới hay nhịp nhanh hơn cho kịch bản đang có. Kịch bản [đã có video] được đặt trên bản mới. Trả về độ dài ước tính của từng kịch bản.",
    shape: {
      numbers: z.array(z.number().int().min(1)).min(1).max(30),
      seconds: z.number().int().min(10).max(180),
    },
    pending: "Đặt độ dài",
    async run({ numbers, seconds: targetSec }, host) {
      const { scripts } = await pick(host.sessionId, numbers);
      host.label(`Độ dài ${list(numbers)}: ${targetSec} giây`);
      const fallbackSec = await fallbackSecOf(host.sessionId);
      const results = await board.agentSetLength(
        host.sessionId,
        scripts.map((s) => s.id),
        targetSec,
        host.log,
      );
      const ordered = await board.orderedScripts(host.sessionId);
      return results
        .map((r, i) => {
          const number = numbers[i] as number;
          if (r.outcome === "writing") return `#${number}: đang được viết, chưa đặt được.`;
          const where = r.copied
            ? `#${number} đã có video nên đặt trên bản mới #${numberOf(ordered, r.script.id)}`
            : `#${number}`;
          const done = r.outcome === "same" ? `đã là ${targetSec} giây` : `đặt ${targetSec} giây`;
          return `${where}: ${done}. ${lengthLine(r.script, fallbackSec)}`;
        })
        .join("\n");
    },
  }),

  define({
    name: "add_scripts",
    description:
      "Thêm kịch bản mới. Bạn lập tiêu đề và hook cho từng kịch bản; người viết sẽ viết lời thoại song song. Chờ đến khi viết xong. Kết quả liệt kê sản phẩm của từng kịch bản; khi tóm tắt cho người dùng, dùng đúng tên sản phẩm đó.",
    shape: {
      topics: z
        .array(
          z.object({
            title: z.string().min(1).describe(writer.TITLE_RULE),
            hook: z.string().min(1).describe(writer.HOOK_RULE),
            product: z
              .string()
              .optional()
              .describe(
                '@handle sản phẩm của video này, hoặc "không". Bỏ trống thì các sản phẩm của series được chia đều (hoặc theo tỉ lệ của đợt nếu đã đặt). Khi người dùng nêu sản phẩm (bằng @handle hoặc tên), đặt product cho mọi đề tài theo đó',
              ),
          }),
        )
        .min(1)
        .max(writer.MAX_COUNT),
      direction: z.string().optional().describe("Yêu cầu chung cho người viết"),
      target_seconds: z.number().int().min(10).max(180).optional(),
    },
    pending: "Lập đề tài",
    async run({ topics, direction, target_seconds }, host) {
      const { ws, series } = await seriesOf(host.sessionId);
      const given = topics.map((t) =>
        t.product === undefined ? undefined : (productArg(ws.assets, t.product)?.id ?? null),
      );
      await board.joinSeries(series, given);
      host.label(`Viết ${topics.length} kịch bản mới`);
      const outcome = await unlessStopped(
        host,
        board.agentAdd(
          host.sessionId,
          {
            topics: topics.map((t, i) => ({
              title: t.title,
              hook: t.hook,
              ...(given[i] !== undefined ? { productId: given[i] } : {}),
            })),
            direction: direction?.trim() ?? "",
            targetSec: clampTarget(target_seconds),
          },
          host.log,
        ),
      );
      if (outcome === STOPPED) return "Người dùng đã dừng. Các thẻ đang viết sẽ tự viết xong.";
      const { written, failed } = outcome;
      const ordered = await board.orderedScripts(host.sessionId);
      const fallbackSec = seriesTargetSec(series);
      const productName = (s: Script) =>
        ws.assets.find((a) => a.id === s.productIds[0])?.name ?? "không sản phẩm";
      const lines = written.map(
        (s) =>
          `#${numberOf(ordered, s.id)} ${s.title} (~${seconds(s, fallbackSec)} giây, ${productName(s)})`,
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
      "Sửa nhiều kịch bản cùng lúc bằng người viết, song song, theo một yêu cầu sửa rõ ràng. Dùng cho sửa lớn hoặc từ 3 kịch bản trở lên. Người viết giữ độ dài lời như cũ; chỉ đặt target_seconds khi người dùng muốn viết lại lời cho vừa một độ dài. Đổi độ dài hay nhịp mà không đổi lời: set_length.",
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
          clampTarget(target_seconds),
          host.log,
        ),
      );
      if (result === STOPPED) return "Người dùng đã dừng. Các kịch bản đang sửa sẽ tự sửa xong.";
      const after = await board.orderedScripts(host.sessionId);
      const fallbackSec = await fallbackSecOf(host.sessionId);
      const changed = result.changed.map(
        (s) => `#${numberOf(after, s.id)} (~${seconds(s, fallbackSec)} giây)`,
      );
      return [
        changed.length ? `Đã sửa: ${changed.join(", ")}.` : "Không kịch bản nào cần sửa.",
        result.same ? `${result.same} kịch bản không cần đổi.` : "",
        result.failed ? `${result.failed} kịch bản chưa sửa được.` : "",
        result.copied
          ? `${result.copied} kịch bản đã có video nên được sửa trên bản mới (bản gốc giữ nguyên); báo người dùng một câu.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
    },
  }),

  define({
    name: "set_product_mix",
    description:
      "Đặt tỉ lệ sản phẩm cho các kịch bản SẮP viết của đợt này (add_scripts tự chia sản phẩm theo tỉ lệ và theo những gì đã có trên bảng). Kịch bản đã có không đổi; muốn đổi thì dùng assign_products. Tổng phải là 100. Gửi products rỗng để bỏ tỉ lệ (các sản phẩm của series được chia đều).",
    shape: {
      products: z
        .array(
          z.object({
            product: z.string().describe("@handle sản phẩm"),
            percent: z.number().int().min(1).max(100),
          }),
        )
        .max(12),
    },
    pending: "Đặt tỉ lệ sản phẩm",
    async run({ products }, host) {
      host.label("Đặt tỉ lệ sản phẩm");
      const { assets } = await getWorkspace();
      const mix = products.map((p) => {
        const product = productArg(assets, p.product);
        if (!product) throw new Error('Tỉ lệ chỉ gồm sản phẩm, không có "không"');
        return { productId: product.id, share: p.percent };
      });
      const problem = mixProblem(mix, () => true);
      if (problem) throw new Error(problem);
      await updateSession({
        id: host.sessionId,
        settings: { productMix: mix.length ? mix : null },
      });
      if (!mix.length) return "Đã bỏ tỉ lệ sản phẩm; các sản phẩm của series sẽ được chia đều.";
      const name = (id: string) => assets.find((a) => a.id === id)?.name ?? id;
      return `Đã lưu tỉ lệ: ${mix.map((e) => `${name(e.productId)} ${e.share}%`).join(", ")}. Áp dụng cho kịch bản viết sau; kịch bản đã có không đổi.`;
    },
  }),

  define({
    name: "assign_products",
    description:
      'Đổi sản phẩm của kịch bản đang có, mỗi video một sản phẩm. Người viết chỉ sửa những câu nhắc hoặc tả sản phẩm và phần dàn dựng về sản phẩm; mọi câu khác giữ nguyên. Kịch bản [đã có video] được đổi trên bản mới. product là @handle hoặc "không". Chờ đến khi sửa xong.',
    shape: {
      assignments: z
        .array(
          z.object({
            number: z.number().int().min(1),
            product: z.string().describe('@handle sản phẩm, hoặc "không"'),
          }),
        )
        .min(1)
        .max(30),
    },
    pending: "Đổi sản phẩm",
    async run({ assignments }, host) {
      const { scripts } = await pick(
        host.sessionId,
        assignments.map((a) => a.number),
      );
      const { assets } = await getWorkspace();
      const targets = assignments.map((a, i) => ({
        number: a.number,
        script: scripts[i] as Script,
        product: productArg(assets, a.product),
      }));
      host.label(`Đổi sản phẩm ${list(assignments.map((a) => a.number))}`);
      const results = await unlessStopped(
        host,
        Promise.all(
          targets.map(async (t) => {
            try {
              return {
                ...t,
                change: await setProduct(
                  host.sessionId,
                  t.script.id,
                  t.product?.id ?? null,
                  host.log,
                ),
              };
            } catch (error) {
              return { ...t, error: error instanceof Error ? error.message : String(error) };
            }
          }),
        ),
      );
      if (results === STOPPED) return "Người dùng đã dừng. Các kịch bản đang sửa sẽ tự sửa xong.";
      const after = await board.orderedScripts(host.sessionId);
      return results
        .map((r) => {
          const to = r.product?.name ?? "không sản phẩm";
          if ("error" in r) return `#${r.number}: chưa đổi được (${r.error}).`;
          if (!r.change) return `#${r.number} đã là ${to}.`;
          const where = r.change.copied
            ? `đã có video nên đổi trên bản mới #${numberOf(after, r.change.script.id)}`
            : `#${r.number}`;
          const what = [
            r.change.changedLines ? `${r.change.changedLines} câu` : "",
            r.change.stagingChanged ? "dàn dựng" : "",
          ].filter(Boolean);
          return `${where} → ${to}: sửa ${what.join(" và ") || "không câu nào"}.`;
        })
        .join("\n");
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
      const kept = await board.agentDelete(
        host.sessionId,
        scripts.map((s) => s.id),
        host.log,
      );
      const deleted = numbers.filter((_, i) => !kept.includes(scripts[i]?.id ?? ""));
      const keptNumbers = numbers.filter((_, i) => kept.includes(scripts[i]?.id ?? ""));
      return [
        deleted.length
          ? `Đã xóa ${list(deleted)}. Số thứ tự các kịch bản còn lại đã thay đổi.`
          : "",
        keptNumbers.length
          ? `${list(keptNumbers)} đã có video nên không xóa; người dùng tự xóa trên bảng nếu muốn.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
    },
  }),

  define({
    name: "read_video",
    description:
      "Đọc video (hoặc dàn dựng) của một kịch bản: trạng thái, lời thoại đánh số câu, khung hình, và từng cảnh (loại cảnh, ai trên hình, phần lời thoại, người xem thấy gì, mô tả hình, ý người dùng đã lưu). Luôn gọi trước khi đề xuất sửa video.",
    shape: { number: z.number().int().min(1) },
    pending: "Xem video",
    async run({ number }, host) {
      const { scripts } = await pick(host.sessionId, [number]);
      host.label(`Xem video #${number}`);
      const job = await video.jobFor(host.sessionId, (scripts[0] as Script).id);
      if (!job || stagedWithoutPlace(job)) return `#${number} chưa có video.`;
      return describeVideo(
        number,
        job,
        (await getWorkspace()).assets,
        await video.stagingOf(host.sessionId, (scripts[0] as Script).id),
      );
    },
  }),

  define({
    name: "direct_video",
    description: `Lưu ý người dùng về cách quay một cảnh hay cả video TRƯỚC khi video tốn tiền, rồi dàn dựng lại kịch bản đó một lần miễn phí (khoảng một phút) sau khi bạn trả lời xong, giữ mọi ý đã lưu. Dùng khi người dùng nói video nên trông thế nào mà chưa có các cảnh chính. shot: số cảnh trong dàn dựng hiện tại (read_scripts hoặc read_video); bỏ trống là cho cả video. want: ý người dùng, bằng lời của họ, ngắn. Gộp một cảnh vào cảnh bên cạnh: lưu want đúng nguyên câu "${MERGE_WISH.previous}" (cảnh đầu video: "${MERGE_WISH.next}"); xóa cảnh cùng lời thoại của nó là sửa kịch bản, không phải direct_video. Sau khi có các cảnh chính thì dùng propose_video_fix.`,
    shape: {
      number: z.number().int().min(1),
      shot: z.number().int().min(1).optional().describe("Số cảnh; bỏ trống là cho cả video"),
      want: z.string().min(1).max(300).describe("Ý người dùng cho lúc đó, bằng lời của họ"),
    },
    pending: "Lưu ý dàn dựng",
    async run({ number, shot, want }, host) {
      const { scripts } = await pick(host.sessionId, [number]);
      const script = scripts[0] as Script;
      host.label(shot ? `Dàn dựng #${number}, cảnh ${shot}` : `Dàn dựng #${number}`);
      const job = await video.jobFor(host.sessionId, script.id);
      const { status } = await video.stagingOf(host.sessionId, script.id);
      if (status !== "started") await video.assertHasPlace(host.sessionId);
      let words: string | undefined;
      if (shot) {
        if (!job?.plan || stagedWithoutPlace(job))
          return `#${number} chưa có dàn dựng; bỏ shot để lưu ý cho cả video.`;
        words = job.shots[shot - 1]?.text;
        if (!words) return `Dàn dựng của #${number} có ${job.shots.length} cảnh.`;
      }
      try {
        await video.direct(host.sessionId, script.id, { ...(words ? { words } : {}), want });
        await video.askToStage(host.sessionId, [script.id]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === "Video đã bắt đầu tạo") {
          return `Video #${number} đã bắt đầu tạo nên không dàn dựng lại được. Sau khi có các cảnh chính, dùng propose_video_fix.`;
        }
        throw error;
      }
      return `Đã lưu. #${number} sẽ được dàn dựng lại theo ý này ngay khi bạn trả lời xong (miễn phí, khoảng một phút). Trả lời một câu ngắn và chỉ chỗ xem, ví dụ: "Đang dàn dựng lại #${number}, xem ở bước Dàn dựng."`;
    },
  }),

  define({
    name: "stage_scripts",
    description:
      'Dàn dựng các kịch bản theo số: chia cảnh và lên cách quay cho lời thoại hiện tại. Miễn phí, mỗi kịch bản khoảng một phút. CHỈ gọi khi người dùng yêu cầu (ví dụ "dàn dựng #2", "cập nhật dàn dựng #2", "dàn dựng lại #2"); không bao giờ tự gọi sau khi sửa kịch bản. Kịch bản đã có dàn dựng đúng với lời hiện tại thì bỏ qua, trừ khi again là true ("dàn dựng lại" từ đầu). Chạy sau khi bạn trả lời xong. Video đã bắt đầu tạo thì không dàn dựng lại được.',
    shape: {
      numbers: z.array(z.number().int().min(1)).min(1).max(30),
      again: z.boolean().optional().describe("true: dàn dựng lại từ đầu cả khi đã đúng"),
    },
    pending: "Dàn dựng",
    async run({ numbers, again }, host) {
      const { scripts } = await pick(host.sessionId, numbers);
      host.label(`Dàn dựng ${list(numbers)}`);
      const picked = await Promise.all(
        scripts.map(async (script, i) => ({
          script,
          number: numbers[i] as number,
          status: (await video.stagingOf(host.sessionId, script.id)).status,
        })),
      );
      const numbersOf = (rows: typeof picked) => list(rows.map((r) => r.number));
      const unwritten = picked.filter((r) => !stageable(r.script));
      const started = picked.filter((r) => r.status === "started");
      const current = picked.filter((r) => !again && r.status === "ready");
      const asked = picked.filter(
        (r) => !unwritten.includes(r) && !started.includes(r) && !current.includes(r),
      );
      await video.askToStage(
        host.sessionId,
        asked.map((r) => r.script.id),
        again === true,
      );
      return [
        asked.length
          ? `${numbersOf(asked)} sẽ được dàn dựng ngay khi bạn trả lời xong (miễn phí, khoảng một phút mỗi kịch bản).`
          : "",
        current.length ? `${numbersOf(current)} đã có dàn dựng đúng với lời hiện tại.` : "",
        started.length ? `${numbersOf(started)} đã bắt đầu tạo video nên không dàn dựng lại.` : "",
        unwritten.length ? `${numbersOf(unwritten)} chưa có lời thoại xong để dàn dựng.` : "",
      ]
        .filter(Boolean)
        .join(" ");
    },
  }),

  define({
    name: "propose_video_fix",
    description:
      "Đề xuất sửa hình của một video mà không đổi lời thoại. Công cụ tính giá và hiện đề xuất kèm nút cho người dùng; KHÔNG tự chạy. Chỉ phần bị đổi được tạo lại. Các thay đổi: redo_shot (quay lại một cảnh; cảnh wide/detail thì vẽ lại khung hình của nó), redo_still (vẽ lại khung hình toàn cảnh hoặc của một nhân vật, kéo theo mọi cảnh dùng nó), replace_line (đổi thứ người xem thấy trong một câu thoại).",
    shape: {
      number: z.number().int().min(1),
      summary: z
        .string()
        .min(1)
        .max(120)
        .describe("Một câu ngắn bằng ngôn ngữ của người dùng: sẽ sửa gì"),
      changes: z.array(changeShape).min(1).max(8),
    },
    pending: "Tính cách sửa",
    async run({ number, summary, changes }, host) {
      const { scripts } = await pick(host.sessionId, [number]);
      const script = scripts[0] as Script;
      host.label(`Tính cách sửa video #${number}`);
      const job = await video.jobFor(host.sessionId, script.id);
      if (!job) return `#${number} chưa có video nên chưa có gì để sửa.`;
      if (!canFix(job)) return `Video #${number} ${STATUS[job.status]}.`;
      const fixes = toChanges(changes, job, (await getWorkspace()).assets, script);
      const price = await video.priceFix(host.sessionId, script.id, fixes);
      host.proposeFix({
        scriptId: script.id,
        summary: summary.trim(),
        changes: fixes,
        priceUsd: price.priceUsd,
        shots: price.shots,
        stills: price.stills,
        rev: price.rev,
      });
      await appendFile(
        dataFile("feedback.jsonl"),
        `${JSON.stringify({
          at: board.now(),
          sessionId: host.sessionId,
          scriptId: script.id,
          request: host.request,
          summary,
          changes,
          priceUsd: price.priceUsd,
          phase: jobPhase(job),
          checks: job.frames.filter((f) => f.check).map((f) => ({ still: f.id, found: f.check })),
          shotStills: job.shots.map((s) => frameFor(job, s)?.source ?? null),
        })}\n`,
        "utf8",
      ).catch(() => {});
      const parts = [
        price.stills ? `${price.stills} khung hình` : "",
        price.shots ? `${price.shots} cảnh` : "",
      ].filter(Boolean);
      const earlier = await recentFeedback(job.seriesId, true);
      return `Đã hiện đề xuất kèm nút cho người dùng: tạo lại ${parts.join(", ") || "phần ghép"}, giá ${
        price.priceUsd > 0 ? `khoảng ${formatCost(price.priceUsd)}` : "miễn phí"
      }. Chưa có gì được tạo lại; người dùng tự giữ nút để đồng ý. Trả lời một câu ngắn, không nhắc lại giá, rồi hỏi ghi nhớ bằng offer_choices.${
        earlier
          ? `\n\nGóp ý trước đây trong series (nếu giống góp ý này, nói một câu là đã gặp trước đây):\n${earlier}`
          : ""
      }`;
    },
  }),

  define({
    name: "list_notes",
    description:
      "Danh sách ghi nhớ (sở thích người dùng đã lưu cho video sau) của series này và của mọi series, kèm id và lĩnh vực, cùng các góp ý sửa video gần đây trong series. Luôn gọi trước save_note để thay ghi nhớ trùng hoặc trái ý thay vì thêm mới.",
    shape: {},
    pending: "Xem ghi nhớ",
    async run(_args, host) {
      host.label("Xem ghi nhớ");
      const { ws, series } = await seriesOf(host.sessionId);
      const lines = (list: Note[] | undefined) =>
        list?.length
          ? list.map((n) => `- [${n.id}] (${n.area}) ${n.text}`).join("\n")
          : "(chưa có)";
      const feedback = await recentFeedback(series.id);
      return [
        `Mọi series (${ws.notes?.length ?? 0}/${MAX_NOTES}):\n${lines(ws.notes)}`,
        `Series này (${series.notes?.length ?? 0}/${MAX_NOTES}):\n${lines(series.notes)}`,
        feedback ? `Góp ý sửa video gần đây trong series:\n${feedback}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
    },
  }),

  define({
    name: "save_note",
    description:
      "Lưu một ghi nhớ để mọi kịch bản và video SAU này tự làm theo (video đã có không đổi). Chỉ gọi khi người dùng đã chọn phạm vi. area: script (lời thoại, câu chuyện, cách xưng hô), picture (hình, cách ngồi, bố cục, góc máy, ánh sáng), voice (cách đọc; người viết thể hiện qua câu chữ và dấu câu), editing (nhịp, khoảng lặng, phụ đề). Có ghi nhớ trùng hoặc trái ý thì truyền replace_id của nó.",
    shape: {
      text: z
        .string()
        .min(1)
        .max(200)
        .describe(
          "Một câu ngắn, ngôn ngữ của người dùng, nói điều cần làm (không nói điều đã sai)",
        ),
      area: z.enum(NOTE_AREAS as [Note["area"], ...Note["area"][]]),
      scope: z.enum(["series", "all"]).describe("series: series này; all: mọi series"),
      replace_id: z.string().optional(),
      script: z.number().int().min(1).optional().describe("Số kịch bản liên quan, nếu có"),
      words: z.string().max(400).optional().describe("Nguyên văn góp ý của người dùng, nếu có"),
    },
    pending: "Ghi nhớ",
    async run({ text, area, scope, replace_id, script, words }, host) {
      const { series } = await seriesOf(host.sessionId);
      const scriptId = script
        ? (await board.orderedScripts(host.sessionId))[script - 1]?.id
        : undefined;
      const { replaced } = await saveNote({
        seriesId: scope === "all" ? null : series.id,
        text,
        area,
        ...(replace_id ? { replaceId: replace_id } : {}),
        from: {
          sessionId: host.sessionId,
          ...(scriptId ? { scriptId } : {}),
          ...(words?.trim() ? { words: words.trim() } : {}),
        },
      });
      host.label(replaced ? "Cập nhật ghi nhớ" : "Đã ghi nhớ");
      return `${replaced ? "Đã thay ghi nhớ cũ" : "Đã lưu"} (${
        scope === "all" ? "mọi series" : "series này"
      }). Kịch bản và video tạo sau sẽ theo; cái đã có không đổi. Xác nhận bằng vài chữ.`;
    },
  }),

  define({
    name: "update_series_direction",
    description: `Sửa định hướng của series này: mọi kịch bản và video SAU này của series theo định hướng mới (cái đã có không đổi). Chỉ gọi khi người dùng đã chọn "Cả series". slot là mục cần sửa, text là toàn bộ nội dung mới của mục đó: viết lại cả mục, giữ ý cũ còn đúng, chép nguyên văn câu thoại mẫu người dùng đưa; text rỗng là bỏ mục đó. Các mục: people (từng nhân vật là ai, tính cách, cách nói, xưng hô với nhau thế nào; không tả ngoại hình), story (mỗi video kể chuyện gì, theo trình tự nào), tone (giọng điệu và mức độ, câu thoại mẫu), closing (câu kết lặp lại ở mọi video), look (hình ảnh và nhịp dựng), never (điều không được làm), other (yêu cầu khác không thuộc mục nào). product là cách nhắc sản phẩm: none (không nhắc), natural (nhắc tự nhiên trong câu chuyện), closing (giới thiệu ở cuối video). target_seconds là độ dài mặc định của video.`,
    shape: {
      slot: z.enum(GUIDE_SLOTS).optional(),
      text: z.string().max(GUIDE_LINE_MAX).optional().describe("Toàn bộ nội dung mới của mục"),
      product: z.enum(PRODUCT_MENTIONS).optional(),
      target_seconds: z.number().int().min(10).max(180).optional(),
    },
    pending: "Lưu vào series",
    async run({ slot, text, product, target_seconds }, host) {
      if ((slot === undefined) !== (text === undefined)) {
        throw new Error("slot và text phải đi cùng nhau");
      }
      if (slot === undefined && product === undefined && target_seconds === undefined) {
        throw new Error("Chưa có gì để sửa");
      }
      const { series } = await seriesOf(host.sessionId);
      const edit: GuideEdit = {
        ...(slot !== undefined && text !== undefined ? { lines: { [slot]: text } } : {}),
        ...(product ? { productMention: product } : {}),
        ...(target_seconds ? { targetSec: target_seconds } : {}),
      };
      const saved = await updateSeries({ id: series.id, guide: edit });
      host.label("Đã lưu vào series");
      return `Đã lưu vào định hướng series. Kịch bản và video tạo sau sẽ theo; cái đã có không đổi. Xác nhận bằng vài chữ.

Định hướng series hiện tại (thay cho phần Định hướng series trong lời nhắc):
${directionText(saved) || "(Chưa có định hướng.)"}`;
    },
  }),

  define({
    name: "remove_note",
    description: "Bỏ một ghi nhớ theo id (lấy từ list_notes) khi người dùng muốn quên nó.",
    shape: { id: z.string().min(1) },
    pending: "Bỏ ghi nhớ",
    async run({ id }, host) {
      host.label("Bỏ ghi nhớ");
      await removeNote(id);
      return "Đã bỏ ghi nhớ.";
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

export const SILENT_TOOLS = new Set<string>(["offer_choices"]);

export const pendingLabel = (name: string) =>
  TOOLS.find((t) => t.name === name)?.pending || "Đang làm";

export async function runTool(
  name: string,
  args: unknown,
  host: ToolHost,
): Promise<{ text: string; isError: boolean }> {
  const def = TOOLS.find((t) => t.name === name);
  if (!def) return { text: `Không có công cụ ${name}`, isError: true };
  try {
    return { text: await def.execute(args, host), isError: false };
  } catch (error) {
    return { text: error instanceof Error ? error.message : String(error), isError: true };
  }
}
