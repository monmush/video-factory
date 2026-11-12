import type { AssetKind, DescribeResult } from "../shared/ipc";
import { askClaudeCode } from "./claude-code";
import { uploadImages } from "./fal-upload";
import { falClient, providerMode } from "./providers";
import { readSettings } from "./settings";
import { logUsage } from "./usage";

// Describes an asset (character or product) from its reference images, in
// Vietnamese. Routed to the text provider chosen in settings:
//   - "claude-code": the user's own Claude Code CLI (their plan; no per-call charge to us)
//   - "fal": a vision model hosted on fal (fixture mode returns a sample instead)

const FAL_ENDPOINT = "openrouter/router/vision";
const FAL_MODEL = "google/gemini-2.5-flash";
const MAX_IMAGES = 4;

const PROMPTS: Record<
  AssetKind,
  { system: string; user: (name: string) => string; fixture: string }
> = {
  character: {
    system: `Bạn viết mô tả nhân vật để dùng làm chỉ dẫn cho mô hình tạo ảnh và video.
Chỉ mô tả bản thân nhân vật nhìn thấy trong ảnh: giới tính, độ tuổi ước chừng, khuôn mặt, kiểu tóc, vóc dáng, trang phục, phụ kiện và màu sắc chủ đạo.
Không mô tả bối cảnh, ánh sáng hay tư thế. Không đoán tiểu sử, tính cách hay tên. Nếu các ảnh là cùng một người ở nhiều góc, gộp thành một mô tả.
Viết bằng tiếng Việt tự nhiên, một đoạn duy nhất gồm 2–4 câu ngắn, không dùng markdown, không gạch đầu dòng.`,
    user: (name) =>
      name.trim()
        ? `Mô tả ngoại hình nhân vật "${name.trim()}" trong các ảnh này.`
        : "Mô tả ngoại hình nhân vật trong các ảnh này.",
    fixture:
      "[Mô tả mẫu] Khi gọi AI thật, phần này sẽ mô tả độ tuổi, khuôn mặt, kiểu tóc, vóc dáng, trang phục và màu sắc chủ đạo của nhân vật trong ảnh.",
  },
  // A place to stage scenes in. People and products are described elsewhere.
  environment: {
    system: `Bạn viết mô tả bối cảnh để dùng làm chỉ dẫn cho mô hình tạo ảnh và video.
Chỉ mô tả không gian nhìn thấy trong ảnh: loại địa điểm, kiến trúc, đồ vật và vật liệu chính, cây cối, thời điểm trong ngày, ánh sáng, bảng màu và không khí chung.
Không mô tả người hay sản phẩm có trong ảnh. Nếu các ảnh là cùng một nơi ở nhiều góc, gộp thành một mô tả.
Viết bằng tiếng Việt tự nhiên, một đoạn duy nhất gồm 2–4 câu ngắn, không dùng markdown, không gạch đầu dòng.`,
    user: (name) =>
      name.trim()
        ? `Mô tả bối cảnh "${name.trim()}" trong các ảnh này.`
        : "Mô tả bối cảnh trong các ảnh này.",
    fixture:
      "[Mô tả mẫu] Khi gọi AI thật, phần này sẽ mô tả địa điểm, kiến trúc, đồ vật, ánh sáng, bảng màu và không khí của bối cảnh trong ảnh.",
  },
  // Products must stay factual: brand fidelity is a firm requirement, so the
  // description copies visible text and never invents claims.
  product: {
    system: `Bạn viết mô tả sản phẩm để dùng làm chỉ dẫn cho mô hình tạo ảnh và video. Độ chính xác về thương hiệu là bắt buộc.
Chỉ mô tả những gì nhìn thấy trong ảnh: loại bao bì, hình dạng, chất liệu, kích thước tương đối, màu sắc, họa tiết, vị trí logo.
Chép lại chính xác từng chữ đọc rõ trên bao bì và đặt trong ngoặc kép. Chữ nào không đọc rõ thì ghi "chữ không đọc rõ", tuyệt đối không đoán.
Không suy đoán hương vị, công dụng, thành phần, giá, nguồn gốc hay những mặt không có trong ảnh. Không mô tả bối cảnh hay ánh sáng.
Viết bằng tiếng Việt tự nhiên, một đoạn duy nhất gồm 2–4 câu ngắn, không dùng markdown, không gạch đầu dòng.`,
    user: (name) =>
      name.trim()
        ? `Mô tả sản phẩm "${name.trim()}" trong các ảnh này.`
        : "Mô tả sản phẩm trong các ảnh này.",
    fixture:
      "[Mô tả mẫu] Khi gọi AI thật, phần này sẽ mô tả bao bì, hình dạng, màu sắc và chép lại chính xác chữ đọc được trên nhãn sản phẩm.",
  },
};

export async function describeAsset(
  kind: AssetKind,
  name: string,
  paths: string[],
): Promise<DescribeResult> {
  if (paths.length === 0) throw new Error("Cần ít nhất một ảnh");
  const prompt = PROMPTS[kind];
  if (!prompt) throw new Error(`Unknown asset kind: ${kind}`);
  const images = paths.slice(0, MAX_IMAGES);
  const purpose = `describe-${kind}`;

  if (readSettings().textProvider === "claude-code") {
    const answer = await askClaudeCode({
      system: prompt.system,
      prompt: prompt.user(name),
      imagePaths: images,
    });
    await logUsage({
      provider: "claude-code",
      purpose,
      images: images.length,
      notionalCostUsd: answer.notionalCostUsd,
      durationMs: answer.durationMs,
    });
    return { description: answer.text, source: "claude-code", cost: null };
  }

  if (providerMode() === "fixture") {
    await new Promise((r) => setTimeout(r, 900));
    return { description: prompt.fixture, source: "fixture", cost: null };
  }

  const fal = await falClient();
  const image_urls = await uploadImages(fal, images, 1280);
  const result = await fal.subscribe(FAL_ENDPOINT, {
    input: {
      model: FAL_MODEL,
      prompt: prompt.user(name),
      system_prompt: prompt.system,
      image_urls,
      temperature: 0.4,
    },
  });
  const data = result.data as { output: string; usage?: { cost?: number } };
  const cost = data.usage?.cost ?? null;
  // Every paid request is logged so cost per accepted video can be measured later.
  await logUsage({
    provider: "fal",
    endpoint: FAL_ENDPOINT,
    model: FAL_MODEL,
    purpose,
    requestId: result.requestId,
    images: image_urls.length,
    cost,
  });
  return { description: data.output.trim(), source: "fal", cost };
}
