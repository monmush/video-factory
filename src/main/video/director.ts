import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MAX_HOLDS_SEC, SPEECH_RATE } from "../../shared/board";
import type { Asset } from "../../shared/ipc";
import { DIRECTOR_AREAS, notesBlock } from "../../shared/notes";
import {
  castOf,
  type DirectorAnswer,
  type PlanContext,
  readDirectorAnswer,
  rulesPlan,
  type ShotPlan,
  seatsFor,
} from "../../shared/shot-plan";
import type { VideoJob } from "../../shared/video-job";
import { getBoard } from "../board";
import { getWorkspace } from "../store";
import { askText, parseJsonObject, textAiMode } from "../text-ai";
import PROMPT from "./director-prompt.md?raw";

// The directing pass (docs/DIRECTING_RULES.md, layer A): the user's own AI
// turns the committed script into a shot plan from built-in rules. The
// answer is checked mechanically; one retry with the problems listed, then
// the rules-only plan, so a video is never blocked by the director. Free:
// it runs on the user's own AI. Prompt and answers are saved beside the job
// for whoever maintains the rules.

const SYSTEM =
  "You are a film director for short vertical videos. Answer with one JSON object and nothing else.";

const describe = (a: Asset) => `${a.name}: ${a.description.trim() || "(no description)"}`;

function fill(slots: Record<string, string>): string {
  let text = PROMPT;
  for (const [key, value] of Object.entries(slots)) {
    text = text.replaceAll(`{{${key}}}`, value);
  }
  return text;
}

/**
 * Fixture mode: the rules-only plan, or HYAN_FIXTURE_PLAN, a saved director
 * answer (JSON) put through the same checks, so plans with cutaways, holds
 * and product shots can be driven for free.
 */
async function fixturePlan(ctx: PlanContext): Promise<ShotPlan> {
  const file = process.env.HYAN_FIXTURE_PLAN;
  if (!file) return rulesPlan(ctx);
  try {
    const answer = parseJsonObject<DirectorAnswer>(await readFile(file, "utf8"));
    const { plan, errors } = readDirectorAnswer(answer, ctx);
    if (!errors.length) return plan;
    console.warn("[video] fixture plan broke rules:", errors.join(" | "));
    return rulesPlan(ctx, errors);
  } catch (error) {
    return rulesPlan(ctx, [(error as Error).message]);
  }
}

/** The plan for a job, and how it was made. */
export async function directJob(job: VideoJob, dir: string): Promise<ShotPlan> {
  const ws = await getWorkspace();
  const series = ws.series.find((s) => s.id === job.seriesId);
  const script = (await getBoard(job.sessionId)).scripts.find((s) => s.id === job.scriptId);
  const asset = (id: string) => ws.assets.find((a) => a.id === id);
  const castIds = castOf(job.lines);
  const cast = castIds.map((id) => asset(id)).filter((a): a is Asset => Boolean(a));
  const products = (script?.productIds ?? [])
    .map((id) => asset(id))
    .filter((a): a is Asset => Boolean(a));
  const place = series?.environmentIds
    .map((id) => asset(id))
    .find((a): a is Asset => Boolean(a?.images.length));
  const ctx: PlanContext = {
    lines: job.lines,
    cast: cast.map((c) => ({ id: c.id, name: c.name })),
    products: products.map((p) => ({ id: p.id, name: p.name })),
    hasPlace: job.useEnvironment && Boolean(place),
  };

  // Without a place there is nothing to stage, and without text AI nobody to ask.
  if (!ctx.hasPlace || !place) return rulesPlan(ctx);
  if (textAiMode() === "fixture") return fixturePlan(ctx);

  const names = new Map(cast.map((c) => [c.id, c.name]));
  const seats = seatsFor(castIds)
    .map(
      (s) =>
        `- ${names.get(s.characterId)}: sits ${s.side}, looks toward ${s.looks.replace("_", " ")}`,
    )
    .join("\n");
  const prompt = fill({
    speech_rate: String(SPEECH_RATE),
    max_holds: String(MAX_HOLDS_SEC),
    place: describe(place),
    cast: cast.map((c) => `- ${describe(c)}`).join("\n"),
    products: products.map((p) => `- ${describe(p)}`).join("\n") || "none",
    series_direction: series?.guidance.trim() || "none",
    notes: notesBlock(ws.notes, series?.notes, DIRECTOR_AREAS) || "none",
    seats,
    staging_note: script?.staging?.trim() || "none",
    dialogue: job.lines
      .map((l, i) => `${i + 1}. ${names.get(l.characterId ?? "") ?? l.speaker}: ${l.text}`)
      .join("\n"),
  });

  const log: string[] = [];
  const save = (name: string, text: string) =>
    writeFile(join(dir, name), text, "utf8").catch(() => undefined);
  await save("director-prompt.md", prompt);

  let request = prompt;
  let problems: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const answer = await askText({
        system: SYSTEM,
        prompt: request,
        purpose: "video-plan",
        sessionId: job.sessionId,
        temperature: 0.4,
      });
      await save(`director-answer-${attempt}.json`, answer);
      const { plan, errors } = readDirectorAnswer(parseJsonObject<DirectorAnswer>(answer), ctx);
      if (!errors.length) return plan;
      problems = errors;
      log.push(`attempt ${attempt}: ${errors.join(" | ")}`);
      request = `${prompt}\n\n## Your previous plan\n\n${answer}\n\n## It broke these rules\n\n${errors.map((e) => `- ${e}`).join("\n")}\n\nAnswer again with a corrected plan, as one JSON object.`;
    } catch (error) {
      problems = [(error as Error).message];
      log.push(`attempt ${attempt}: ${(error as Error).message}`);
    }
  }
  console.warn("[video] director fell back to rules:", log.join("\n"));
  return rulesPlan(ctx, problems);
}
