import { CUES } from "./cues";
import { syllableBudget } from "./pace";
import type { ProductMention } from "./series-guide";
import { ACCENT_WRITING_RULE, type VoiceAccent } from "./voices";

export interface WritingRuleInput {
  targetSec: number | null;
  product: ProductMention;
  storyOrToneStated: boolean;
  closingStated: boolean;
  accents: readonly VoiceAccent[];
}

export function productRuleFor(
  seriesRule: ProductMention | undefined,
  hasProduct: boolean,
): ProductMention {
  if (!hasProduct) return "none";
  return seriesRule === "closing" ? "closing" : "natural";
}

const PRODUCT_LINE: Record<Exclude<ProductMention, "none">, string> = {
  natural:
    "Nhắc sản phẩm tự nhiên trong lời thoại một lần (nhiều nhất hai), dùng đúng tên sản phẩm, và để sản phẩm xuất hiện trong khung hình.",
  closing:
    "Giới thiệu sản phẩm ở phần cuối video, gắn với câu chuyện vừa kể, dùng đúng tên sản phẩm và để sản phẩm xuất hiện trong khung hình. Trước đó không nhắc tên sản phẩm.",
};

function accentLine(accents: readonly VoiceAccent[]): string | null {
  const present = [...new Set(accents)];
  if (!present.length) return null;
  return [
    "Mỗi nhân vật dùng từ ngữ hợp với giọng ghi cạnh tên.",
    ...present.map((a) => ACCENT_WRITING_RULE[a]),
  ].join(" ");
}

const cueList = Object.keys(CUES)
  .map((c) => `[${c}]`)
  .join(", ");

export function writingRules(input: WritingRuleInput): string {
  const rules = [
    "Định hướng series quyết định nhân vật là ai, cách xưng hô, kiểu chuyện, giọng điệu và câu kết. Làm đúng theo đó.",
    `${input.targetSec ? `Video dọc dài khoảng ${input.targetSec} giây. ` : ""}Mỗi kịch bản là một câu chuyện độc lập, không nhắc đến kịch bản khác.`,
    "Chỉ dùng nhân vật trong danh sách. Không thêm người, giọng nói hay con vật khác.",
    "Lời thoại là tiếng Việt nói tự nhiên: câu ngắn, dễ nói nhanh, không văn viết.",
    accentLine(input.accents),
    "Câu thoại đầu tiên nêu ngay câu hỏi, vấn đề hoặc điều bất ngờ, tối đa 14 âm tiết.",
    input.targetSec
      ? `Tổng lời thoại khoảng ${syllableBudget(input.targetSec)} âm tiết, lệch không quá 10% (mỗi chữ cách nhau bởi dấu cách là một âm tiết). Mỗi lượt thoại tối đa 25 âm tiết.`
      : "Không cắt hay viết thêm lời thoại chỉ để đổi độ dài. Mỗi lượt thoại tối đa 25 âm tiết.",
    input.storyOrToneStated
      ? null
      : "Mỗi kịch bản có một ý đáng nhớ và một điểm nhấn rõ: tiếng cười, bất ngờ hoặc cảm xúc.",
    'Dùng dấu "…" khi cần ngắt nhịp trước một câu chốt.',
    "Thành ngữ, tục ngữ nếu dùng thì phải có thật, trích đúng và hợp nghĩa.",
    input.product === "none" ? null : PRODUCT_LINE[input.product],
    'Chỉ nói về sản phẩm những điều có trong mô tả sản phẩm. Không bịa nguồn gốc, công dụng, sức khỏe, hương vị, giải thưởng hay giá. Cần thì nói cảm nhận ("con thích vị này").',
    input.closingStated
      ? 'Câu thoại cuối cùng theo đúng "Câu kết" của định hướng, tính trong tổng âm tiết.'
      : null,
    `Khi câu chuyện cần (ví dụ người nói cười sau câu đùa của mình), một lượt thoại được kết thúc bằng đúng một tiếng không lời trong ngoặc vuông: ${cueList}. Tiếng này nghe được nhưng không có phụ đề. Nhiều nhất hai lần mỗi kịch bản.`,
    "Ngoài tiếng đó, không lời thoại trong ngoặc, không chỉ dẫn diễn xuất trong lời thoại.",
  ];
  return `## Quy tắc viết\n${rules
    .filter((rule): rule is string => rule !== null)
    .map((rule) => `- ${rule}`)
    .join("\n")}`;
}
