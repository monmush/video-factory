import { DEFAULT_TARGET_SEC, statedLength } from "../shared/board";
import { type Asset, resolveChoice, type Series } from "../shared/ipc";
import { guideFromAnswer, guideFromText, type SeriesGuide } from "../shared/series-guide";
import { characterVoice } from "../shared/voices";
import { readSettings } from "./settings";
import { getWorkspace, saveDraftedGuide } from "./store";
import { askText, parseJsonObject, textAiIsOwn, textAiMode } from "./text-ai";

const DRAFT_TIMEOUT_MS = 90_000;
const FIXTURE_PAUSE_MS = 1500;

const DRAFT_SYSTEM = `Bạn đọc mô tả thô của người dùng về một series video ngắn dọc và viết lại thành bản định hướng mà người viết kịch bản và người dựng cảnh sẽ làm theo cho mọi video của series.

Người dùng không phải biên kịch hay đạo diễn. Họ đọc bản định hướng để kiểm tra bạn hiểu đúng chưa, nên viết ngắn, cụ thể, bằng lời thường, tiếng Việt. Mỗi mục một đến hai câu ngắn.

Các mục:
- people: từng nhân vật là ai trong series (vai, tính cách, cách nói) và họ xưng hô với nhau thế nào. Dùng đúng tên trong danh sách nhân vật. Không tả ngoại hình.
- story: mỗi video kể chuyện gì và đi theo trình tự nào (mở đầu, diễn biến, kết).
- tone: giọng điệu và mức độ của nó. Người dùng có đưa câu thoại mẫu thì chép nguyên văn vào đây.
- closing: câu kết lặp lại ở mọi video. Người dùng có đưa thì chép nguyên văn.
- look: hình ảnh và nhịp dựng (ánh sáng, góc máy, nhanh hay chậm).
- never: những điều không được làm.
- other: mọi yêu cầu khác của người dùng không thuộc mục nào ở trên.

Quy tắc:
- Giữ đủ mọi yêu cầu trong mô tả: không bỏ sót, không làm nhẹ đi, không thêm ý người dùng không nói.
- Ghi nhớ đã lưu cũng là yêu cầu của người dùng: định hướng không được trái với ghi nhớ.
- Không tự thêm nhân vật có lời thoại mà mô tả không nhắc.
- Từ xưng hô và câu thoại bạn tự viết theo giọng ghi cạnh tên nhân vật, không dùng từ địa phương của miền khác.
- Mục mà mô tả đã nói: "guessed" là false.
- people (khi có từ hai nhân vật), story và tone là ba mục kịch bản nào cũng cần. Mô tả không nói thì tự điền theo cách hợp nhất với phần còn lại và đặt "guessed" là true.
- closing, look, never, other: mô tả không nói thì để "text" rỗng, không đoán.
- productMention: "none" khi người dùng không muốn nhắc sản phẩm; "closing" khi muốn giới thiệu sản phẩm ở cuối video; "natural" khi muốn nhắc tự nhiên trong câu chuyện. Mô tả không nói: "natural" và "productMentionGuessed" là true.
- targetSec: độ dài video người dùng nêu, tính bằng giây ("1 phút" là 60). Không nêu: null.
- castMentioned: số nhân vật có lời thoại mà mô tả nhắc tới; không rõ thì 0.
- title: tên series, tối đa 5 chữ, không dấu chấm.
- questions: nhiều nhất 2 câu hỏi, chỉ khi câu trả lời làm kịch bản khác hẳn mà bạn không đoán chắc được (thường là cách xưng hô, quan hệ giữa các nhân vật, vai của sản phẩm). Mỗi câu hỏi thuộc một mục và có 2 đến 3 lựa chọn; mỗi lựa chọn có "label" (tối đa 4 chữ) và "text" (toàn bộ nội dung mới của mục đó nếu người dùng chọn). Không hỏi điều mô tả đã nói. Không cần hỏi thì để [].

Chỉ trả về một đối tượng JSON hợp lệ, không markdown, đúng dạng:
{"title":"","people":{"text":"","guessed":false},"story":{"text":"","guessed":false},"tone":{"text":"","guessed":false},"closing":{"text":"","guessed":false},"look":{"text":"","guessed":false},"never":{"text":"","guessed":false},"other":{"text":"","guessed":false},"productMention":"natural","productMentionGuessed":false,"targetSec":null,"castMentioned":0,"questions":[{"slot":"people","ask":"","options":[{"label":"","text":""}]}]}`;

interface SeriesAssets {
  characters: Asset[];
  products: Asset[];
  environments: Asset[];
  notes: string[];
}

interface Draft {
  guide: SeriesGuide;
  title: string;
}

const draftsInFlight = new Map<string, Promise<Series>>();

export function draftGuide(seriesId: string): Promise<Series> {
  const running = draftsInFlight.get(seriesId);
  if (running) return running;
  const run = draft(seriesId).finally(() => draftsInFlight.delete(seriesId));
  draftsInFlight.set(seriesId, run);
  return run;
}

export async function draftSettled(seriesId: string): Promise<void> {
  await draftsInFlight.get(seriesId)?.catch(() => undefined);
}

async function draft(seriesId: string): Promise<Series> {
  const ws = await getWorkspace();
  const series = ws.series.find((s) => s.id === seriesId);
  if (!series) throw new Error("Không tìm thấy series");
  if (series.guide || !series.guidance.trim() || !textAiIsOwn()) return series;
  const pick = (ids: string[]) => ids.flatMap((id) => ws.assets.find((a) => a.id === id) ?? []);
  const assets: SeriesAssets = {
    characters: pick(series.characterIds),
    products: pick(series.productIds),
    environments: pick(series.environmentIds),
    notes: (series.notes ?? []).map((n) => n.text),
  };
  const drafted =
    textAiMode() === "fixture"
      ? await fixtureDraft(series.guidance, assets.characters)
      : await askDraft(series.guidance, assets);
  return saveDraftedGuide(series.id, drafted.guide, drafted.title);
}

const listed = (items: string[]) => (items.length ? items.join("\n") : "(chưa chọn)");

const castLine = (cast: readonly Asset[]) => (character: Asset) =>
  `- ${character.name}, giọng: "${characterVoice(character, cast)}"${
    character.description ? `: ${character.description}` : ""
  }`;

function draftPrompt(guidance: string, assets: SeriesAssets) {
  return `Mô tả của người dùng:
${guidance.trim()}

Nhân vật:
${listed(assets.characters.map(castLine(assets.characters)))}

Sản phẩm:
${listed(assets.products.map((p) => `- ${p.name}`))}

Bối cảnh:
${listed(assets.environments.map((e) => `- ${e.name}`))}

Ghi nhớ đã lưu:
${assets.notes.length ? assets.notes.map((n) => `- ${n}`).join("\n") : "(chưa có)"}`;
}

async function askDraft(guidance: string, assets: SeriesAssets): Promise<Draft> {
  const settings = readSettings();
  const choice = resolveChoice({ model: settings.chatModel, effort: settings.chatEffort });
  const answer = await askText({
    system: DRAFT_SYSTEM,
    prompt: draftPrompt(guidance, assets),
    purpose: "draft-series-guide",
    model: choice.model,
    effort: choice.effort,
    timeoutMs: DRAFT_TIMEOUT_MS,
  });
  return guideFromAnswer(parseJsonObject<unknown>(answer));
}

function namesTogether(names: string[]) {
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} và ${names.at(-1)}`;
}

async function fixtureDraft(guidance: string, characters: Asset[]): Promise<Draft> {
  await new Promise((resolve) => setTimeout(resolve, FIXTURE_PAUSE_MS));
  const stated = statedLength(guidance)?.seconds ?? null;
  const cast = characters.length >= 2 ? namesTogether(characters.map((c) => c.name)) : null;
  const guide: SeriesGuide = {
    lines: {
      ...guideFromText(guidance).lines,
      ...(cast
        ? { people: { text: `${cast} trò chuyện với nhau trong mỗi video.`, guessed: true } }
        : {}),
    },
    productMention: "natural",
    productMentionGuessed: true,
    targetSec: stated ?? DEFAULT_TARGET_SEC,
    ...(stated === null ? { targetSecGuessed: true } : {}),
    ...(cast
      ? {
          questions: [
            {
              id: "q1",
              slot: "people",
              ask:
                characters.length === 2
                  ? "Hai nhân vật nói chuyện với nhau thế nào?"
                  : "Các nhân vật nói chuyện với nhau thế nào?",
              options: [
                {
                  label: "Thân mật",
                  text: `${cast} thân nhau, xưng hô thân mật và nói chuyện thoải mái.`,
                },
                {
                  label: "Lịch sự",
                  text: `${cast} xưng hô lịch sự và nói chuyện nhã nhặn với nhau.`,
                },
              ],
            },
          ],
        }
      : {}),
  };
  return { guide, title: "" };
}
