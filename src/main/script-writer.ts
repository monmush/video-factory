import { clampTarget, statedLength } from "../shared/board";
import { cleanCues } from "../shared/cues";
import type { Asset, Script, ScriptLine } from "../shared/ipc";
import { type Note, type NoteArea, notesBlock, WRITER_AREAS } from "../shared/notes";
import { estimateSeconds, lengthFit, syllableBudget } from "../shared/pace";
import type { ProductMention } from "../shared/series-guide";
import { accentOfVoice, characterVoice } from "../shared/voices";
import { productRuleFor, writingRules } from "../shared/writing-rules";
import { FIXTURE_STORIES } from "./script-fixtures";
import { askText, parseJsonObject, textAiMode } from "./text-ai";

export interface WriterContext {
  sessionId: string;
  direction: string;
  targetSec: number;
  productMention: ProductMention;
  storyOrToneStated: boolean;
  closingStated: boolean;
  notes: { every: Note[]; series: Note[] };
  characters: Asset[];
  products: Asset[];
  environments: Asset[];
  avoid: string[];
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

export type Route =
  | { action: "add"; topics: Topic[]; direction: string; targetSec: number | null }
  | { action: "edit"; targets: number[] | "all"; instruction: string; targetSec: number | null }
  | { action: "reply"; text: string };

export const DEFAULT_COUNT = 5;
export const MAX_COUNT = 30;

function assetList(assets: Asset[], empty: string, tag: (asset: Asset) => string = () => "") {
  if (assets.length === 0) return empty;
  return assets
    .map((a) => `- ${a.name} (@${a.handle})${tag(a)}${a.description ? `: ${a.description}` : ""}`)
    .join("\n");
}

const voiceTag = (cast: readonly Asset[]) => (character: Asset) =>
  `, giọng: "${characterVoice(character, cast)}"`;

const castAccents = (cast: readonly Asset[]) =>
  cast.flatMap((c) => accentOfVoice(characterVoice(c, cast)) ?? []);

export function seriesBlock(ctx: WriterContext, areas: NoteArea[] = WRITER_AREAS) {
  const notes = notesBlock(ctx.notes.every, ctx.notes.series, areas);
  return `## Định hướng series
${ctx.direction || "(Chưa có định hướng.)"}
${
  notes
    ? `
## Ghi nhớ của người dùng (luôn làm theo; nếu trái định hướng thì theo ghi nhớ)
${notes}
`
    : ""
}
## Nhân vật
${assetList(
  ctx.characters,
  "(Chưa chọn nhân vật. Dùng tối đa hai nhân vật hợp với định hướng.)",
  voiceTag(ctx.characters),
)}

## Sản phẩm
${assetList(ctx.products, "(Không có sản phẩm. Không nhắc đến thương hiệu.)")}

## Bối cảnh
${assetList(ctx.environments, "(Chưa chọn bối cảnh. Chọn một bối cảnh hợp với định hướng.)")}`;
}

export function rulesFor(ctx: WriterContext, targetSec: number | null, hasProduct: boolean) {
  return writingRules({
    targetSec,
    product: productRuleFor(ctx.productMention, hasProduct),
    storyOrToneStated: ctx.storyOrToneStated,
    closingStated: ctx.closingStated,
    accents: castAccents(ctx.characters),
  });
}

export const TITLE_RULE = "ý chính của video, tối đa 8 chữ";
export const HOOK_RULE =
  "câu hỏi hoặc điều bất ngờ mở đầu video, tối đa 14 chữ; không tóm tắt câu chuyện";

const SCRIPT_SHAPE = `{"title":"${TITLE_RULE}","hook":"${HOOK_RULE}","lines":[{"speaker":"@handle nhân vật","text":"lời thoại"}],"products":["@handle sản phẩm"],"staging":"1–2 câu tiếng Việt: bối cảnh, vị trí nhân vật, sản phẩm đặt ở đâu"}`;

function writerSystem(ctx: WriterContext, targetSec: number | null, hasProduct: boolean) {
  return `Bạn là biên kịch cho một series video ngắn dọc trên TikTok của một thương hiệu.

${seriesBlock(ctx)}

${rulesFor(ctx, targetSec, hasProduct)}

Trước khi trả lời, tự kiểm tra từng quy tắc và sửa nếu sai.
Chỉ trả về một đối tượng JSON hợp lệ, không markdown, đúng dạng:
${SCRIPT_SHAPE}`;
}

function avoidBlock(ctx: WriterContext) {
  return ctx.avoid.length
    ? `\nĐã dùng trong series, không lặp lại ý, thành ngữ hay câu đùa:\n${ctx.avoid.map((t) => `- ${t}`).join("\n")}`
    : "";
}

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

export function speakerOf(
  ctx: WriterContext,
  ref: string,
): Pick<ScriptLine, "characterId" | "speaker"> {
  const speaker = ref.trim();
  const character = findAsset(ctx.characters, speaker);
  return {
    characterId: character?.id ?? null,
    speaker: character?.name ?? speaker.replace(/^@/, ""),
  };
}

export function normalise(ctx: WriterContext, raw: RawScript): WrittenScript {
  const lines = (raw.lines ?? [])
    .map((line) => ({
      ...speakerOf(ctx, String(line.speaker ?? "")),
      text: cleanCues(String(line.text ?? "")),
    }))
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

const KEEP_WHILE_RESIZING = "Giữ câu chuyện, điểm nhấn chính, câu kết và lần nhắc sản phẩm nếu có.";

async function withinLength(
  ctx: WriterContext,
  script: WrittenScript,
  targetSec: number,
): Promise<WrittenScript> {
  const fit = lengthFit(estimateSeconds(script.lines, targetSec), targetSec);
  const budget = syllableBudget(targetSec);
  let instruction: string | null = null;
  if (fit === "long") {
    instruction = `Rút gọn lời thoại còn khoảng ${budget} âm tiết. ${KEEP_WHILE_RESIZING}`;
  } else if (fit === "short") {
    instruction = `Viết thêm cho lời thoại đủ khoảng ${budget} âm tiết. ${KEEP_WHILE_RESIZING}`;
  }
  if (!instruction) return script;
  const fixed = await revise(ctx, script, instruction, targetSec, false);
  return fixed ?? script;
}

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

export async function writeTopic(
  ctx: WriterContext,
  topic: Topic,
  direction?: string,
  targetSec = ctx.targetSec,
): Promise<WrittenScript> {
  if (textAiMode() === "fixture") return fixtureWrite(ctx, topic);
  const answer = await askText({
    system: writerSystem(ctx, targetSec, ctx.products.length > 0),
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

const variantTask = (direction?: string) =>
  direction
    ? `Viết một bản mới của kịch bản dưới đây theo yêu cầu. Yêu cầu quyết định bản mới khác bản gốc ở đâu và nhiều hay ít: giữ nguyên từng chữ mọi phần mà yêu cầu không nhắc tới, kể cả tình huống, tiêu đề và lời thoại.\nYêu cầu: ${direction}`
    : "Viết một kịch bản mới, độc lập, là một cách kể khác cho cùng ý tưởng với kịch bản dưới đây: đổi tình huống, câu mở đầu và điểm nhấn; không chép lời thoại.";

export const variantLength = (direction: string | undefined, targetSec: number) =>
  direction?.trim() ? (statedLength(direction)?.seconds ?? null) : targetSec;

export async function writeVariant(
  ctx: WriterContext,
  source: Script,
  direction?: string,
  targetSec = ctx.targetSec,
): Promise<WrittenScript> {
  if (textAiMode() === "fixture") return fixtureVariant(ctx);
  const length = variantLength(direction, targetSec);
  const answer = await askText({
    system: writerSystem(ctx, length, ctx.products.length > 0),
    prompt: `${variantTask(direction)}

Kịch bản gốc:
${asJson(ctx, source)}${direction ? "" : avoidBlock(ctx)}`,
    purpose: "variant-script",
    sessionId: ctx.sessionId,
    model: ctx.model,
    effort: ctx.effort,
  });
  const written = normalise(ctx, parseJsonObject(answer));
  return length === null ? written : withinLength(ctx, written, length);
}

export async function revise(
  ctx: WriterContext,
  script: Pick<Script, "title" | "hook" | "lines" | "productIds" | "staging">,
  instruction: string,
  namedSec: number | null,
  checkLength = true,
): Promise<WrittenScript | null> {
  if (textAiMode() === "fixture") return fixtureRevise(script, instruction);
  const answer = await askText({
    system: `${writerSystem(ctx, namedSec, script.productIds.length > 0)}

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
  return checkLength && namedSec !== null ? withinLength(ctx, written, namedSec) : written;
}

export function withProduct(
  ctx: WriterContext,
  productId: string | null | undefined,
  library: readonly Asset[],
): WriterContext {
  if (productId === undefined) return ctx;
  const product =
    productId === null
      ? undefined
      : (ctx.products.find((p) => p.id === productId) ??
        library.find((a) => a.id === productId && a.kind === "product"));
  return { ...ctx, products: product ? [product] : [] };
}

export const oneProduct = (written: WrittenScript, productId: string | null | undefined) =>
  productId === undefined ? written : { ...written, productIds: productId ? [productId] : [] };

export async function reviseProduct(
  ctx: WriterContext,
  script: Pick<Script, "title" | "hook" | "lines" | "productIds" | "staging">,
  from: Asset | null,
  to: Asset | null,
): Promise<WrittenScript> {
  const target = { ...ctx, products: to ? [to] : [] };
  if (textAiMode() === "fixture") return fixtureProductSwap(script, from, to);
  const both = { ...ctx, products: [from, to].filter((a): a is Asset => Boolean(a)) };
  const answer = await askText({
    system: writerSystem(target, null, to !== null),
    prompt: `Đổi sản phẩm của kịch bản dưới đây ${from ? `từ ${from.name}` : "(chưa có sản phẩm)"} sang ${
      to ? `${to.name} (@${to.handle})` : "không có sản phẩm"
    }. Đây là sửa hẹp:
- Chỉ viết lại những câu thoại nhắc tên hoặc tả sản phẩm (tên, hương vị, màu, mùi, cách pha, đặc điểm). Điều nói về sản phẩm mới phải có trong mô tả của nó; bỏ điều mô tả không nói.
- Mọi câu thoại khác giữ nguyên từng chữ, cùng người nói, cùng thứ tự. Giữ nguyên tiêu đề và hook.
- "staging": chỉ sửa phần nói về sản phẩm (tên, chỗ đặt); giữ nguyên phần còn lại.
${
  to
    ? `- "products" là ["@${to.handle}"].${from ? "" : " Nhắc sản phẩm một lần, tự nhiên, ở câu hợp nhất; chỉ thêm hoặc sửa đúng câu đó."}`
    : '- Không có sản phẩm: bỏ tên và mô tả sản phẩm khỏi lời thoại, sửa câu cho tự nhiên; "products" là [].'
}${
  from?.description
    ? `

Sản phẩm cũ (${from.name}): ${from.description}`
    : ""
}

Kịch bản:
${asJson(both, script)}`,
    purpose: "revise-script-product",
    sessionId: ctx.sessionId,
    model: ctx.model,
    effort: ctx.effort,
    temperature: 0.3,
  });
  const written = normalise(target, parseJsonObject<RawScript>(answer));
  return { ...written, title: script.title, hook: script.hook, productIds: to ? [to.id] : [] };
}

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
  const length = statedLength(text);
  const targetSec = length?.seconds ?? null;
  const rest = length ? text.replace(length.phrase, "") : text;
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

async function fixtureProductSwap(
  script: Pick<Script, "title" | "hook" | "lines" | "productIds" | "staging">,
  from: Asset | null,
  to: Asset | null,
): Promise<WrittenScript> {
  await pause(900, 900);
  const named = (text: string) =>
    Boolean(from && text.toLocaleLowerCase("vi").includes(from.name.toLocaleLowerCase("vi")));
  const swap = (text: string) =>
    from && to ? text.replace(new RegExp(escapeRegExp(from.name), "gi"), to.name) : text;
  let lines = script.lines.map((l) => ({ ...l, text: swap(l.text) }));
  let staging = swap(script.staging);
  if (from && !to) {
    const kept = lines.filter((l) => !named(l.text));
    if (kept.length >= 2) lines = kept;
    staging = staging
      .split(/(?<=\.)\s+/)
      .filter((part) => !named(part))
      .join(" ");
  }
  if (!from && to) {
    const last = lines.at(-2) ?? lines.at(-1);
    lines = [
      ...lines,
      {
        characterId: last?.characterId ?? null,
        speaker: last?.speaker ?? "",
        text: `Vậy mình pha ấm ${to.name} nhé.`,
      },
    ];
    staging = `${staging} ${to.name} đặt cạnh ấm trà.`.trim();
  }
  return {
    title: script.title,
    hook: script.hook,
    lines,
    productIds: to ? [to.id] : [],
    staging,
  };
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
