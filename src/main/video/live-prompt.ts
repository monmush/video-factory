import {
  type LiveAnswer,
  type LiveContext,
  type LivePlan,
  readLivePlan,
  type ToolRecord,
} from "../../shared/live-plan";

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
