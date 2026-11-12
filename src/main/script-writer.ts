import { DEFAULT_TARGET_SEC, estimateSeconds, syllableBudget } from "../shared/board";
import type { Asset, Script, ScriptLine } from "../shared/ipc";
import { FIXTURE_STORIES } from "./script-fixtures";
import { askText, parseJsonObject, textAiMode } from "./text-ai";

// Writes the scripts on a session's board. Three kinds of call:
//   - route: reads a chat request and decides to add scripts (planning their
//     topics in the same pass, so cards appear before dialogue is written),
//     edit existing scripts in place, or simply answer;
//   - write: dialogue for one planned topic, or a variant of an existing script;
//   - revise: an in-place edit of one script, which may report "unchanged".
// The writer corrects its own output before a card appears; the operator is
// never shown warnings (docs/SCRIPT_BOARD_DECISIONS.md). Length aims at the
// request's target (about 45 s by default) and is corrected once in either
// direction; product facts and variety are prompt rules.

/** Everything the writer knows about the series. */
export interface WriterContext {
  sessionId: string;
  guidance: string;
  characters: Asset[];
  products: Asset[];
  environments: Asset[];
  /** Titles already used in this series and session, for variety. */
  avoid: string[];
  /** Claude: the session's chosen model and effort, so writing matches the chat. */
  model?: string;
  effort?: string;
}

export interface WrittenScript {
  title: string;
  hook: string;
  lines: ScriptLine[];
  productIds: string[];
  staging: string;
}

export interface Topic {
  title: string;
  hook: string;
}

/** `targetSec` is null when the request names no length. */
export type Route =
  | { action: "add"; topics: Topic[]; direction: string; targetSec: number | null }
  | { action: "edit"; targets: number[] | "all"; instruction: string; targetSec: number | null }
  | { action: "reply"; text: string };

/** Requests that name no count get this many scripts (open question; pilot batches are 3–5). */
export const DEFAULT_COUNT = 5;
export const MAX_COUNT = 30;

/** Lengths a request may ask for, in seconds. */
const MIN_TARGET_SEC = 10;
const MAX_TARGET_SEC = 180;

export function clampTarget(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(MAX_TARGET_SEC, Math.max(MIN_TARGET_SEC, Math.round(n)));
}

function assetList(assets: Asset[], empty: string) {
  if (assets.length === 0) return empty;
  return assets
    .map((a) => `- ${a.name} (@${a.handle})${a.description ? `: ${a.description}` : ""}`)
    .join("\n");
}

export function seriesBlock(ctx: WriterContext) {
  return `## Định hướng series
${ctx.guidance || "(Chưa có định hướng.)"}

## Nhân vật
${assetList(ctx.characters, "(Chưa chọn nhân vật. Dùng tối đa hai nhân vật hợp với định hướng.)")}

## Sản phẩm
${assetList(ctx.products, "(Không có sản phẩm. Không nhắc đến thương hiệu.)")}

## Bối cảnh
${assetList(ctx.environments, "(Chưa chọn bối cảnh. Chọn một bối cảnh hợp với định hướng.)")}`;
}

export const writingRules = (targetSec: number) => `## Quy tắc viết
- Video dọc dài khoảng ${targetSec} giây. Mỗi kịch bản là một câu chuyện độc lập, không nhắc đến kịch bản khác.
- Chỉ dùng nhân vật trong danh sách. Không thêm người, giọng nói hay con vật khác.
- Lời thoại là tiếng Việt nói tự nhiên: câu ngắn, dễ nói nhanh, không văn viết.
- Câu thoại đầu tiên nêu ngay câu hỏi, vấn đề hoặc điều bất ngờ, tối đa 14 âm tiết.
- Tổng lời thoại khoảng ${syllableBudget(targetSec)} âm tiết, lệch không quá 10% (mỗi chữ cách nhau bởi dấu cách là một âm tiết). Mỗi lượt thoại tối đa 25 âm tiết.
- Một ý sâu sắc và một tiếng cười rõ ràng. Dùng dấu "…" để ngắt nhịp câu đùa.
- Thành ngữ, tục ngữ phải có thật, trích đúng và hợp nghĩa.
- Nhắc sản phẩm tự nhiên trong lời thoại một lần (nhiều nhất hai), dùng đúng tên sản phẩm, và để sản phẩm xuất hiện trong khung hình.
- Chỉ nói về sản phẩm những điều có trong mô tả sản phẩm. Không bịa nguồn gốc, công dụng, sức khỏe, hương vị, giải thưởng hay giá. Cần thì nói cảm nhận ("con thích vị này").
- Không lời thoại trong ngoặc, không chỉ dẫn diễn xuất trong lời thoại.`;

// Title and hook are what the operator scans on the board: keep them short,
// never a story summary.
export const TITLE_RULE = "ý chính của video, tối đa 8 chữ";
export const HOOK_RULE =
  "câu hỏi hoặc điều bất ngờ mở đầu video, tối đa 14 chữ; không tóm tắt câu chuyện";

const SCRIPT_SHAPE = `{"title":"${TITLE_RULE}","hook":"${HOOK_RULE}","lines":[{"speaker":"@handle nhân vật","text":"lời thoại"}],"products":["@handle sản phẩm"],"staging":"1–2 câu tiếng Việt: bối cảnh, vị trí nhân vật, sản phẩm đặt ở đâu"}`;

function writerSystem(ctx: WriterContext, targetSec: number) {
  return `Bạn là biên kịch cho một series video ngắn dọc trên TikTok của một thương hiệu.

${seriesBlock(ctx)}

${writingRules(targetSec)}

Trước khi trả lời, tự kiểm tra từng quy tắc và sửa nếu sai.
Chỉ trả về một đối tượng JSON hợp lệ, không markdown, đúng dạng:
${SCRIPT_SHAPE}`;
}

function avoidBlock(ctx: WriterContext) {
  return ctx.avoid.length
    ? `\nĐã dùng trong series, không lặp lại ý, thành ngữ hay câu đùa:\n${ctx.avoid.map((t) => `- ${t}`).join("\n")}`
    : "";
}

/** Matches the writer's "@handle" (or name) to a series asset. */
function findAsset(assets: Asset[], ref: string) {
  const key = ref.trim().replace(/^@/, "").toLowerCase();
  return assets.find((a) => a.handle === key || a.name.toLowerCase() === key);
}

export interface RawScript {
  unchanged?: boolean;
  title?: string;
  hook?: string;
  lines?: { speaker?: string; text?: string }[];
  products?: string[];
  staging?: string;
}

export function normalise(ctx: WriterContext, raw: RawScript): WrittenScript {
  const lines = (raw.lines ?? [])
    .map((line) => {
      const speaker = String(line.speaker ?? "").trim();
      const character = findAsset(ctx.characters, speaker);
      return {
        characterId: character?.id ?? null,
        speaker: character?.name ?? speaker.replace(/^@/, ""),
        text: String(line.text ?? "").trim(),
      };
    })
    .filter((line) => line.text);
  if (lines.length === 0) throw new Error("AI không trả về lời thoại");
  const productIds = [
    ...new Set((raw.products ?? []).flatMap((p) => findAsset(ctx.products, String(p))?.id ?? [])),
  ];
  return {
    title: String(raw.title ?? "").trim(),
    hook: String(raw.hook ?? "").trim(),
    lines,
    productIds,
    staging: String(raw.staging ?? "").trim(),
  };
}

/** The script as the writer sees it when revising or varying it. */
export function asJson(
  ctx: WriterContext,
  script: Pick<Script, "title" | "hook" | "lines" | "productIds" | "staging">,
) {
  const handle = (id: string | null, fallback: string) => {
    const asset = [...ctx.characters, ...ctx.products].find((a) => a.id === id);
    return asset ? `@${asset.handle}` : fallback;
  };
  return JSON.stringify({
    title: script.title,
    hook: script.hook,
    lines: script.lines.map((l) => ({ speaker: handle(l.characterId, l.speaker), text: l.text })),
    products: script.productIds.map((id) => handle(id, id)),
    staging: script.staging,
  });
}

/**
 * Silent self-correction: one pass when the estimated length is well off the
 * target. If it still misses, the card shows the honest estimate.
 */
async function withinLength(
  ctx: WriterContext,
  script: WrittenScript,
  targetSec: number,
): Promise<WrittenScript> {
  const seconds = estimateSeconds(script.lines);
  const budget = syllableBudget(targetSec);
  let instruction: string | null = null;
  if (seconds > targetSec * 1.12) {
    instruction = `Rút gọn lời thoại còn khoảng ${budget} âm tiết. Giữ câu chuyện, câu đùa chính và lần nhắc sản phẩm.`;
  } else if (seconds < targetSec * 0.75) {
    instruction = `Viết thêm cho lời thoại đủ khoảng ${budget} âm tiết. Giữ câu chuyện, câu đùa chính và lần nhắc sản phẩm.`;
  }
  if (!instruction) return script;
  const fixed = await revise(ctx, script, instruction, targetSec, false);
  return fixed ?? script;
}

// ---------------------------------------------------------------- AI calls

const ROUTER_SYSTEM = (
  ctx: WriterContext,
) => `Bạn điều phối một bảng kịch bản video ngắn. Người dùng gửi một yêu cầu; chọn đúng một hành động.

- "add": viết thêm kịch bản mới (ví dụ "tạo 5 kịch bản", "thêm 3 cái về tình bạn"). Lập kế hoạch luôn: mỗi kịch bản một tiêu đề (${TITLE_RULE}) và một hook (${HOOK_RULE}). Các đề tài phải khác nhau rõ rệt về ý, tình huống và kiểu mở đầu, không trùng các kịch bản đang có hay danh sách đã dùng. Không nêu số lượng thì viết ${DEFAULT_COUNT}; tối đa ${MAX_COUNT}. "direction" là phần yêu cầu chung cho người viết (rỗng nếu không có).
- "edit": sửa kịch bản đang có (ví dụ "đổi tất cả sang buổi tối", "#3 ngắn hơn"). "targets" là các số thứ tự, hoặc "all". Nếu người dùng đính kèm kịch bản thì mặc định sửa các kịch bản đó. "instruction" là yêu cầu sửa, viết rõ để áp dụng cho từng kịch bản.
- "reply": câu hỏi hoặc trò chuyện không cần viết hay sửa; trả lời ngắn bằng tiếng Việt.

Với "add" và "edit": "targetSec" là độ dài video người dùng yêu cầu, tính bằng giây (ví dụ "30 giây" là 30, "1 phút" là 60); không nêu độ dài thì để null.

${seriesBlock(ctx)}

Chỉ trả về một đối tượng JSON hợp lệ, không markdown, theo một trong ba dạng:
{"action":"add","topics":[{"title":"","hook":""}],"direction":"","targetSec":null}
{"action":"edit","targets":[1,3],"instruction":"","targetSec":null}
{"action":"reply","text":""}`;

export async function route(
  ctx: WriterContext,
  board: Script[],
  text: string,
  refs: string[],
): Promise<Route> {
  if (textAiMode() === "fixture") return fixtureRoute(ctx, board, text, refs);

  const listed = board.length
    ? board.map((s, i) => `#${i + 1}. ${s.title || "(đang viết)"} — ${s.hook}`).join("\n")
    : "(Chưa có kịch bản.)";
  const attached = board.flatMap((s, i) => (refs.includes(s.id) ? `#${i + 1}` : []));
  const answer = await askText({
    system: ROUTER_SYSTEM(ctx),
    prompt: `Các kịch bản đang có:\n${listed}\n${avoidBlock(ctx)}\n\n${
      attached.length ? `Kịch bản được đính kèm: ${attached.join(", ")}\n` : ""
    }Yêu cầu: ${text}`,
    purpose: "route-script-request",
    sessionId: ctx.sessionId,
    model: ctx.model,
    effort: ctx.effort,
    temperature: 0.7,
  });
  const raw = parseJsonObject<{
    action?: string;
    topics?: { title?: string; hook?: string }[];
    direction?: string;
    targets?: unknown;
    instruction?: string;
    targetSec?: unknown;
    text?: string;
  }>(answer);
  const targetSec = clampTarget(raw.targetSec);

  if (raw.action === "add") {
    const topics = (raw.topics ?? [])
      .map((t) => ({ title: String(t.title ?? "").trim(), hook: String(t.hook ?? "").trim() }))
      .filter((t) => t.title)
      .slice(0, MAX_COUNT);
    if (topics.length === 0) throw new Error("AI không lập được đề tài");
    return { action: "add", topics, direction: String(raw.direction ?? "").trim(), targetSec };
  }
  if (raw.action === "edit") {
    const targets =
      raw.targets === "all"
        ? "all"
        : (Array.isArray(raw.targets) ? raw.targets : [])
            .map(Number)
            .filter((n) => Number.isInteger(n) && n >= 1 && n <= board.length);
    return {
      action: "edit",
      targets,
      instruction: String(raw.instruction ?? text).trim(),
      targetSec,
    };
  }
  return { action: "reply", text: String(raw.text ?? "").trim() || "Mình chưa hiểu yêu cầu." };
}

/** Dialogue for a planned topic. */
export async function writeTopic(
  ctx: WriterContext,
  topic: Topic,
  direction?: string,
  targetSec = DEFAULT_TARGET_SEC,
): Promise<WrittenScript> {
  if (textAiMode() === "fixture") return fixtureWrite(ctx, topic);
  const answer = await askText({
    system: writerSystem(ctx, targetSec),
    prompt: `Viết kịch bản cho đề tài sau.
Tiêu đề: ${topic.title}
Hook: ${topic.hook}${direction ? `\nYêu cầu chung: ${direction}` : ""}${avoidBlock(ctx)}`,
    purpose: "write-script",
    sessionId: ctx.sessionId,
    model: ctx.model,
    effort: ctx.effort,
  });
  const written = normalise(ctx, parseJsonObject(answer));
  return withinLength(ctx, { ...written, title: written.title || topic.title }, targetSec);
}

/** A new, independent take on an existing script. */
export async function writeVariant(
  ctx: WriterContext,
  source: Script,
  direction?: string,
  targetSec = DEFAULT_TARGET_SEC,
): Promise<WrittenScript> {
  if (textAiMode() === "fixture") return fixtureVariant(ctx);
  const answer = await askText({
    system: writerSystem(ctx, targetSec),
    prompt: `Viết một kịch bản mới, độc lập, là một cách kể khác cho cùng ý tưởng với kịch bản dưới đây: đổi tình huống, câu mở đầu và câu đùa; không chép lời thoại.${
      direction ? `\nHướng của biến thể: ${direction}` : ""
    }

Kịch bản gốc:
${asJson(ctx, source)}${avoidBlock(ctx)}`,
    purpose: "variant-script",
    sessionId: ctx.sessionId,
    model: ctx.model,
    effort: ctx.effort,
  });
  return withinLength(ctx, normalise(ctx, parseJsonObject(answer)), targetSec);
}

/**
 * Edits a script in place. Returns null when the instruction does not apply
 * to this script, so it stays unmarked.
 */
export async function revise(
  ctx: WriterContext,
  script: Pick<Script, "title" | "hook" | "lines" | "productIds" | "staging">,
  instruction: string,
  targetSec = DEFAULT_TARGET_SEC,
  checkLength = true,
): Promise<WrittenScript | null> {
  if (textAiMode() === "fixture") return fixtureRevise(script, instruction);
  const answer = await askText({
    system: `${writerSystem(ctx, targetSec)}

Nếu yêu cầu sửa không áp dụng cho kịch bản này, chỉ trả về {"unchanged":true}.`,
    prompt: `Sửa kịch bản dưới đây theo yêu cầu. Giữ nguyên những gì yêu cầu không nhắc tới.
Yêu cầu: ${instruction}

Kịch bản:
${asJson(ctx, script)}`,
    purpose: "revise-script",
    sessionId: ctx.sessionId,
    model: ctx.model,
    effort: ctx.effort,
    temperature: 0.6,
  });
  const raw = parseJsonObject<RawScript>(answer);
  if (raw.unchanged) return null;
  const written = normalise(ctx, raw);
  return checkLength ? withinLength(ctx, written, targetSec) : written;
}

// ---------------------------------------------------------------- fixture mode

const pause = (min: number, max: number) =>
  new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));

function unusedStories(ctx: WriterContext, board: Pick<Script, "title">[] = []) {
  const used = new Set([...ctx.avoid, ...board.map((s) => s.title)]);
  const fresh = FIXTURE_STORIES.filter((s) => !used.has(s.title));
  return fresh.length ? fresh : FIXTURE_STORIES;
}

export function fixtureRoute(
  ctx: WriterContext,
  board: Script[],
  text: string,
  refs: string[],
): Route {
  const length = text.match(/(\d+)\s*(giây|s\b|phút)/i);
  const targetSec = length
    ? clampTarget(Number(length[1]) * (length[2]?.toLowerCase() === "phút" ? 60 : 1))
    : null;
  const rest = length ? text.replace(length[0], "") : text;
  const numbers = [...text.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
  const wantsMore = /\b(tạo|thêm|viết)\b/i.test(text) && !refs.length && !numbers.length;
  if (board.length && !wantsMore) {
    const targets = refs.length
      ? board.flatMap((s, i) => (refs.includes(s.id) ? i + 1 : []))
      : numbers.length
        ? numbers.filter((n) => n >= 1 && n <= board.length)
        : "all";
    return { action: "edit", targets, instruction: text, targetSec };
  }
  const count = Math.min(MAX_COUNT, Number(rest.match(/\d+/)?.[0]) || DEFAULT_COUNT);
  const stories = unusedStories(ctx, board);
  const topics = Array.from({ length: count }, (_, i) => {
    const story = stories[i % stories.length] as (typeof stories)[number];
    return { title: story.title, hook: story.hook };
  });
  return { action: "add", topics, direction: "", targetSec };
}

function fixtureScript(ctx: WriterContext, story: (typeof FIXTURE_STORIES)[number]): WrittenScript {
  const [first, second] = ctx.characters;
  const product = ctx.products[0];
  const place = ctx.environments[0]?.name ?? "Sân vườn";
  const speakerFor = (i: number) => {
    const character = i % 2 === 0 ? first : (second ?? first);
    return {
      characterId: character?.id ?? null,
      speaker: character?.name ?? `Nhân vật ${(i % 2) + 1}`,
    };
  };
  const lines = story.lines.map((text, i) => ({ ...speakerFor(i), text }));
  if (product) {
    lines.push({ ...speakerFor(lines.length), text: `Vậy mình pha ấm ${product.name} nhé.` });
  }
  return {
    title: story.title,
    hook: story.hook,
    lines,
    productIds: product ? [product.id] : [],
    staging: `${place}, hai người ngồi đối diện bên bàn trà.${
      product ? ` ${product.name} đặt cạnh ấm trà.` : ""
    }`,
  };
}

async function fixtureWrite(ctx: WriterContext, topic: Topic) {
  await pause(900, 2600);
  const story = FIXTURE_STORIES.find((s) => s.title === topic.title) ?? unusedStories(ctx)[0];
  return fixtureScript(ctx, story as (typeof FIXTURE_STORIES)[number]);
}

async function fixtureVariant(ctx: WriterContext) {
  await pause(900, 2200);
  const stories = unusedStories(ctx);
  const story = stories[Math.floor(Math.random() * stories.length)];
  return fixtureScript(ctx, story as (typeof FIXTURE_STORIES)[number]);
}

async function fixtureRevise(
  script: Pick<Script, "title" | "hook" | "lines" | "productIds" | "staging">,
  instruction: string,
): Promise<WrittenScript> {
  await pause(700, 2000);
  return { ...script, staging: `${script.staging} (Đã áp dụng: ${instruction})`.trim() };
}
