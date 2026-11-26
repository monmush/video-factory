import { askClaudeCode } from "./claude-code";
import { falCall } from "./fal";
import { falClient, providerMode } from "./providers";
import { readSettings } from "./settings";
import { logUsage } from "./usage";

const FAL_ENDPOINT = "openrouter/router";
const FAL_MODEL = "google/gemini-2.5-flash";

export type TextAiMode = "claude-code" | "fal" | "fixture";

export function textAiMode(): TextAiMode {
  if (readSettings().textProvider === "claude-code") return "claude-code";
  return providerMode() === "fixture" ? "fixture" : "fal";
}

export const textAiIsOwn = () => textAiMode() !== "fal";

const stopped = () => new Error("Đã dừng");

function limiter(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  const turn = (signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const go = () => {
        signal?.removeEventListener("abort", leave);
        resolve();
      };
      const leave = () => {
        const at = waiting.indexOf(go);
        if (at >= 0) waiting.splice(at, 1);
        reject(stopped());
      };
      waiting.push(go);
      signal?.addEventListener("abort", leave, { once: true });
    });
  return async <T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (signal?.aborted) throw stopped();
    if (active >= limit) await turn(signal);
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

const CLAUDE_CODE_PROCESSES_AT_ONCE = 5;
const CLAUDE_CODE_TIMEOUT_MS = 240_000;
const queues = { "claude-code": limiter(CLAUDE_CODE_PROCESSES_AT_ONCE), fal: limiter(6) };

export async function askText(input: {
  system: string;
  prompt: string;
  purpose: string;
  sessionId?: string;
  temperature?: number;
  model?: string;
  effort?: string;
  onText?: (soFar: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<string> {
  const mode = textAiMode();
  if (mode === "fixture") throw new Error("Text AI is not available in fixture mode");

  if (mode === "claude-code") {
    return queues["claude-code"](async () => {
      const answer = await askClaudeCode({
        system: input.system,
        prompt: input.prompt,
        ...(input.model ? { model: input.model } : {}),
        ...(input.effort ? { effort: input.effort } : {}),
        ...(input.onText ? { onText: input.onText } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
        timeoutMs: input.timeoutMs ?? CLAUDE_CODE_TIMEOUT_MS,
      });
      await logUsage({
        provider: "claude-code",
        purpose: input.purpose,
        sessionId: input.sessionId,
        notionalCostUsd: answer.notionalCostUsd,
        durationMs: answer.durationMs,
      });
      return answer.text;
    }, input.signal);
  }

  return queues.fal(async () => {
    const fal = await falClient();
    const { data } = await falCall<{ output: string; usage?: { cost?: number } }>(
      fal,
      FAL_ENDPOINT,
      {
        model: FAL_MODEL,
        prompt: input.prompt,
        system_prompt: input.system,
        temperature: input.temperature ?? 0.8,
      },
      {
        purpose: input.purpose,
        model: FAL_MODEL,
        sessionId: input.sessionId,
        cost: (d) => d.usage?.cost ?? null,
      },
    );
    if (input.signal?.aborted) throw stopped();
    return data.output;
  }, input.signal);
}

export function parseJsonObject<T>(text: string): T {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("AI trả về kết quả không đọc được");
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    throw new Error("AI trả về kết quả không đọc được");
  }
}
