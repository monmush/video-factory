import { askClaudeCode } from "./claude-code";
import { falClient, providerMode } from "./providers";
import { readSettings } from "./settings";
import { logUsage } from "./usage";

// Text-only AI calls (script planning and writing), routed like descriptions:
//   - "claude-code": the user's own Claude Code CLI, billed to their plan;
//   - "fal": an LLM hosted on fal, live mode only;
//   - "fixture": fal selected in fixture mode; callers use sample content instead.

// fal's text router. Same model as the vision tasks; not yet run live for scripts.
const FAL_ENDPOINT = "openrouter/router";
const FAL_MODEL = "google/gemini-2.5-flash";

export type TextAiMode = "claude-code" | "fal" | "fixture";

export function textAiMode(): TextAiMode {
  if (readSettings().textProvider === "claude-code") return "claude-code";
  return providerMode() === "fixture" ? "fixture" : "fal";
}

/** Runs at most `limit` tasks at once; the rest wait their turn. */
function limiter(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

// Each Claude Code call is a separate process, so keep the count low.
const queues = { "claude-code": limiter(3), fal: limiter(6) };

export async function askText(input: {
  system: string;
  prompt: string;
  /** What the app was doing, for usage.jsonl. */
  purpose: string;
  sessionId?: string;
  temperature?: number;
  /** Claude only: the session's chosen model and effort. */
  model?: string;
  effort?: string;
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
        timeoutMs: 240_000,
      });
      await logUsage({
        provider: "claude-code",
        purpose: input.purpose,
        sessionId: input.sessionId,
        notionalCostUsd: answer.notionalCostUsd,
        durationMs: answer.durationMs,
      });
      return answer.text;
    });
  }

  return queues.fal(async () => {
    const fal = await falClient();
    const result = await fal.subscribe(FAL_ENDPOINT, {
      input: {
        model: FAL_MODEL,
        prompt: input.prompt,
        system_prompt: input.system,
        temperature: input.temperature ?? 0.8,
      },
    });
    const data = result.data as { output: string; usage?: { cost?: number } };
    const cost = data.usage?.cost ?? null;
    await logUsage({
      provider: "fal",
      endpoint: FAL_ENDPOINT,
      model: FAL_MODEL,
      purpose: input.purpose,
      sessionId: input.sessionId,
      requestId: result.requestId,
      cost,
    });
    return data.output;
  });
}

/** The JSON object in a model answer, ignoring any text or code fence around it. */
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
