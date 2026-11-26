import { resolveChoice, type VoiceSuggestion } from "../shared/ipc";
import { characterVoiceTraits, cleanVoiceText, defaultVoiceText, voiceKey } from "../shared/voices";
import { readSettings } from "./settings";
import { askText, parseJsonObject, textAiIsOwn, textAiMode } from "./text-ai";

const SUGGEST_TIMEOUT_MS = 60_000;
const FIXTURE_PAUSE_MS = 1200;
const SUGGESTIONS = 3;
const LABEL_WORDS = 4;
const TEXT_CHARS = 160;

const SYSTEM = `Bạn gợi ý giọng nói cho một nhân vật trong video ngắn dọc tiếng Việt. Một máy tạo giọng sẽ đọc mô tả giọng của bạn để tạo ra giọng thật, nên mô tả phải cụ thể và nghe được.

Trả về đúng ${SUGGESTIONS} gợi ý khác hẳn nhau và đều hợp với nhân vật. Mỗi gợi ý có:
- "label": tối đa ${LABEL_WORDS} chữ, ví dụ "Trầm ấm, chậm rãi".
- "text": mô tả đầy đủ trên một dòng, tối đa ${TEXT_CHARS} ký tự, tiếng Việt: giới tính, tuổi, vùng miền hoặc giọng, chất giọng, tốc độ nói, thái độ.

Vùng miền: theo mô tả nhân vật; không nói gì thì giọng miền Bắc. Nhân vật người nước ngoài thì ghi rõ người nước nào nói tiếng Việt. Không bắt chước giọng của người thật nổi tiếng.

Chỉ trả về một đối tượng JSON hợp lệ, không markdown, đúng dạng:
{"suggestions":[{"label":"","text":""}]}`;

const prompt = (name: string, description: string) =>
  `Nhân vật: ${name.trim() || "(chưa đặt tên)"}\nMô tả: ${description.trim()}`;

const words = (text: string, most: number) =>
  text.split(/\s+/).filter(Boolean).slice(0, most).join(" ");

function cleanSuggestions(raw: unknown): VoiceSuggestion[] {
  const list = (raw as { suggestions?: unknown })?.suggestions;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: VoiceSuggestion[] = [];
  for (const item of list) {
    const label = words(String((item as { label?: unknown })?.label ?? "").trim(), LABEL_WORDS);
    const text = cleanVoiceText(String((item as { text?: unknown })?.text ?? "")).slice(
      0,
      TEXT_CHARS,
    );
    if (!label || !text || seen.has(voiceKey(text))) continue;
    seen.add(voiceKey(text));
    out.push({ label, text });
  }
  return out.slice(0, SUGGESTIONS);
}

async function fixtureSuggestions(name: string, description: string): Promise<VoiceSuggestion[]> {
  await new Promise((resolve) => setTimeout(resolve, FIXTURE_PAUSE_MS));
  const traits = characterVoiceTraits(name, description);
  const texts: string[] = [];
  for (let i = 0; i < SUGGESTIONS; i++) texts.push(defaultVoiceText(traits, texts));
  const labelOf = (text: string) => {
    const label = words(text.split(", ").slice(2).join(", "), LABEL_WORDS);
    return `${label.charAt(0).toLocaleUpperCase("vi")}${label.slice(1)}`;
  };
  return texts.map((text) => ({ label: labelOf(text), text }));
}

export async function suggestVoices(input: {
  name: string;
  description: string;
}): Promise<VoiceSuggestion[]> {
  if (!input.description.trim() || !textAiIsOwn()) return [];
  if (textAiMode() === "fixture") return fixtureSuggestions(input.name, input.description);
  const settings = readSettings();
  const choice = resolveChoice({ model: settings.chatModel, effort: settings.chatEffort });
  const answer = await askText({
    system: SYSTEM,
    prompt: prompt(input.name, input.description),
    purpose: "suggest-character-voice",
    model: choice.model,
    effort: choice.effort,
    timeoutMs: SUGGEST_TIMEOUT_MS,
  });
  return cleanSuggestions(parseJsonObject<unknown>(answer));
}
