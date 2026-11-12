import type { GroupedProduct, ProductGroupingResult } from "../shared/ipc";
import { askClaudeCode } from "./claude-code";
import { uploadImages } from "./fal-upload";
import { falClient, providerMode } from "./providers";
import { readSettings } from "./settings";
import { logUsage } from "./usage";

// Batch product import: one AI pass over a pile of photos. It groups photos of
// the same product, names each product from its label (copied, never invented),
// writes a factual description, sets aside non-product photos and suggests
// gift sets. The user reviews everything before anything is saved.

const FAL_ENDPOINT = "openrouter/router/vision";
const FAL_MODEL = "google/gemini-2.5-flash";

const SYSTEM_PROMPT = `Bạn giúp sắp xếp ảnh sản phẩm cho thư viện của một thương hiệu. Độ chính xác về thương hiệu là bắt buộc.
Các ảnh được đánh số Ảnh 1, Ảnh 2, ... theo thứ tự gửi.
Nhiệm vụ:
1. Nhóm các ảnh chụp cùng một sản phẩm (cùng bao bì, màu sắc, chữ, logo), kể cả ảnh chụp nghiêng, mặt sau hoặc khi mở hộp.
2. Ảnh mà chủ thể chính là người hoặc nhân vật (kể cả người cầm sản phẩm) thì không xếp vào sản phẩm nào; đưa vào "skipped" với lý do ngắn bằng tiếng Việt.
3. Đặt tên mỗi sản phẩm bằng cách chép chính xác chữ đọc rõ trên nhãn. Không đọc rõ thì để "name" rỗng và ghi lý do vào "note". Không tự đặt tên.
4. "description": 1–3 câu tiếng Việt, chỉ mô tả điều nhìn thấy (bao bì, hình dạng, màu sắc, vị trí logo); chép chữ đọc rõ trong ngoặc kép; không đoán hương vị, công dụng, giá hay mặt không có trong ảnh.
5. Nếu một sản phẩm (ví dụ hộp quà) rõ ràng chứa những sản phẩm khác cũng có trong danh sách, ghi số thứ tự của chúng (bắt đầu từ 0, theo mảng "products") vào "contains". Chỉ một cấp: sản phẩm được chứa thì "contains" rỗng.
6. Mỗi ảnh xuất hiện đúng một lần, hoặc trong một sản phẩm, hoặc trong "skipped". Mỗi sản phẩm tối đa 4 ảnh; ảnh thừa thì đưa vào "skipped" với lý do "thừa ảnh".
Chỉ trả về JSON hợp lệ, không markdown, đúng dạng:
{"products":[{"name":"","description":"","images":[1,2],"contains":[],"note":""}],"skipped":[{"image":3,"reason":""}]}`;

const userPrompt = (count: number) =>
  `Có ${count} ảnh. Hãy nhóm thành sản phẩm theo đúng hướng dẫn và trả về JSON.`;

interface RawResult {
  products?: {
    name?: string;
    description?: string;
    images?: number[];
    contains?: number[];
    note?: string;
  }[];
  skipped?: { image?: number; reason?: string }[];
}

/** Parses the model's JSON and enforces the rules, converting 1-based image numbers to indexes. */
function normalise(text: string, count: number): Omit<ProductGroupingResult, "source" | "cost"> {
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let raw: RawResult;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("AI trả về kết quả không đọc được. Thử lại hoặc tự xếp nhóm.");
  }
  const used = new Set<number>();
  const take = (n: unknown) => {
    const index = Number(n) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= count || used.has(index)) return null;
    used.add(index);
    return index;
  };
  const products: GroupedProduct[] = (raw.products ?? [])
    .map((p) => ({
      name: String(p.name ?? "").trim(),
      description: String(p.description ?? "").trim(),
      images: (p.images ?? [])
        .map(take)
        .filter((i): i is number => i !== null)
        .slice(0, 4),
      contains: (p.contains ?? []).map(Number).filter(Number.isInteger),
      note: p.note ? String(p.note).trim() : undefined,
    }))
    .filter((p) => p.images.length > 0);
  // Keep only valid one-level set links between products that survived.
  const isChild = new Set(products.flatMap((p) => p.contains));
  for (const [i, p] of products.entries()) {
    p.contains = isChild.has(i)
      ? []
      : [...new Set(p.contains)].filter((c) => c !== i && c >= 0 && c < products.length);
  }
  const skipped = (raw.skipped ?? [])
    .map((s) => ({ index: take(s.image), reason: String(s.reason ?? "").trim() }))
    .filter((s): s is { index: number; reason: string } => s.index !== null)
    .map((s) => ({ image: s.index, reason: s.reason || "Không phải ảnh sản phẩm" }));
  return { products, skipped };
}

export async function groupProducts(paths: string[]): Promise<ProductGroupingResult> {
  if (paths.length === 0) return { products: [], skipped: [], source: "fixture", cost: null };

  if (readSettings().textProvider === "claude-code") {
    const answer = await askClaudeCode({
      system: SYSTEM_PROMPT,
      prompt: userPrompt(paths.length),
      imagePaths: paths,
      numberImages: true,
      maxImageSide: 768,
      timeoutMs: 240_000,
    });
    await logUsage({
      provider: "claude-code",
      purpose: "group-products",
      images: paths.length,
      notionalCostUsd: answer.notionalCostUsd,
      durationMs: answer.durationMs,
    });
    return { ...normalise(answer.text, paths.length), source: "claude-code", cost: null };
  }

  // Fixture mode: one product per photo, so the review board can be tried for free.
  if (providerMode() === "fixture") {
    await new Promise((r) => setTimeout(r, 900));
    return {
      products: paths.map((_, i) => ({
        name: "",
        description: "",
        images: [i],
        contains: [],
        note: "Chế độ thử: chưa gọi AI, mỗi ảnh là một sản phẩm.",
      })),
      skipped: [],
      source: "fixture",
      cost: null,
    };
  }

  const fal = await falClient();
  const image_urls = await uploadImages(fal, paths, 768);
  const result = await fal.subscribe(FAL_ENDPOINT, {
    input: {
      model: FAL_MODEL,
      prompt: userPrompt(paths.length),
      system_prompt: SYSTEM_PROMPT,
      image_urls,
      temperature: 0.2,
    },
  });
  const data = result.data as { output: string; usage?: { cost?: number } };
  const cost = data.usage?.cost ?? null;
  await logUsage({
    provider: "fal",
    endpoint: FAL_ENDPOINT,
    model: FAL_MODEL,
    purpose: "group-products",
    requestId: result.requestId,
    images: image_urls.length,
    cost,
  });
  return { ...normalise(data.output, paths.length), source: "fal", cost };
}
