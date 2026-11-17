import { estimateVoiceUsd } from "../../shared/board";
import type { ScriptLine } from "../../shared/ipc";
import {
  type LiveAnswer,
  type LiveContext,
  type LivePlan,
  readLivePlan,
  type ToolRecord,
} from "../../shared/live-plan";
import { levelMediaUsd, type MediaLevel } from "../../shared/media-level";
import ADDENDUM from "./live-director-prompt.md?raw";

// The live director's prompt: the fixed director's rules (filled, without
// their Output section) followed by the production part. Electron-free.

export const LIVE_SYSTEM =
  "You are a film director and producer for short vertical videos. You plan with read-only media tools and answer with one JSON object and nothing else.";

export interface LiveFile {
  /** Placeholder name, e.g. "place-1". */
  id: string;
  /** What it shows. */
  what: string;
}

export function livePrompt(
  base: string,
  v: { level: MediaLevel; files: LiveFile[]; seconds: number; lines: Pick<ScriptLine, "text">[] },
): string {
  const rules = base.split(/\n## Output\b/)[0]?.trimEnd() ?? base;
  const slots: Record<string, string> = {
    level_label: v.level.label,
    level_preference: v.level.preference,
    output_size: v.level.output,
    keyframe_size: `${v.level.keyframe.width}×${v.level.keyframe.height}`,
    // The steps the director chooses, the voice excluded (it is given apart).
    budget: levelMediaUsd(v.level, v.seconds).toFixed(2),
    seconds: String(Math.round(v.seconds)),
    voice_usd: estimateVoiceUsd(v.lines).toFixed(2),
    files: v.files.map((f) => `- \`{{${f.id}}}\`: ${f.what}`).join("\n") || "- none",
  };
  let addendum = ADDENDUM;
  for (const [key, value] of Object.entries(slots)) {
    addendum = addendum.replaceAll(`{{${key}}}`, value);
  }
  return `${rules}\n\n${addendum}`;
}

/** The first JSON object in a text. */
export function parseAnswer(text: string): LiveAnswer {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("The answer is not one JSON object.");
  return JSON.parse(text.slice(start, end + 1)) as LiveAnswer;
}

/** An answer read and checked: the plan and what is wrong with it. */
export function checkAnswer(
  text: string,
  ctx: LiveContext,
  record: ToolRecord,
): { plan: LivePlan | null; errors: string[] } {
  let answer: LiveAnswer;
  try {
    answer = parseAnswer(text);
  } catch (error) {
    return { plan: null, errors: [(error as Error).message] };
  }
  return readLivePlan(answer, ctx, record);
}
