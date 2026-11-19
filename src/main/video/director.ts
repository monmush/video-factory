import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MAX_HOLDS_SEC, SPEECH_RATE } from "../../shared/board";
import { buildDirection } from "../../shared/build-direction";
import { directionSlot } from "../../shared/direction";
import type { Asset } from "../../shared/ipc";
import {
  type LiveContext,
  type LiveDirection,
  liveDirection,
  type ToolRecord,
} from "../../shared/live-plan";
import { type MediaLevel, mediaLevel } from "../../shared/media-level";
import { DIRECTOR_AREAS, notesBlock } from "../../shared/notes";
import { directorSteps } from "../../shared/plan-progress";
import { builtinRecipe, type Recipe, readRecipe } from "../../shared/recipe";
import {
  readShotList,
  rulesShotList,
  type ShotList,
  type ShotListAnswer,
  type ShotListCaps,
} from "../../shared/shot-list";
import {
  castOf,
  type PlanContext,
  rulesPlan,
  type ShotPlan,
  seatsFor,
} from "../../shared/shot-plan";
import type { VideoJob } from "../../shared/video-job";
import { getBoard } from "../board";
import { providerMode } from "../providers";
import { getWorkspace } from "../store";
import { askText, parseJsonObject, textAiMode } from "../text-ai";
import PROMPT from "./director-prompt.md?raw";
import { checkAnswer } from "./live-prompt";
import { shotListPrompt } from "./shot-list-prompt";

// The directing pass (docs/DIRECTING_RULES.md, layer A; docs/PLAN_PHASE_PROPOSAL.md):
// the user's own AI turns the committed script into a shot list (shots,
// pictures, a route per shot; no models), and code builds the requests and
// the price from it and the recipe. The answer is checked mechanically; one
// retry with the problems listed, then the rules-only list, so a video is
// never blocked by the director. Free: it runs on the user's own AI. Prompt
// and answers are saved beside the job for whoever maintains the rules.

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

async function fixtureShotList(ctx: PlanContext, caps: ShotListCaps): Promise<ShotList> {
  const listFile = process.env.HYAN_FIXTURE_SHOT_LIST;
  if (!listFile) return rulesShotList(ctx);
  try {
    const answer = parseJsonObject<ShotListAnswer>(await readFile(listFile, "utf8"));
    const { list, errors } = readShotList(answer, ctx, caps);
    if (!errors.length) return list;
    console.warn("[video] fixture shot list broke rules:", errors.join(" | "));
    return rulesShotList(ctx, rulesPlan(ctx, errors));
  } catch (error) {
    return rulesShotList(ctx, rulesPlan(ctx, [(error as Error).message]));
  }
}

/**
 * The recipe a video is built with: HYAN_RECIPE (a saved recipe or live plan,
 * JSON; a developer override) when readable, else the built-in one.
 */
async function loadRecipe(level: MediaLevel): Promise<Recipe> {
  const file = process.env.HYAN_RECIPE;
  if (file) {
    try {
      const recipe = readRecipe(JSON.parse(await readFile(file, "utf8")));
      if (recipe) return recipe;
      console.warn("[video] HYAN_RECIPE is not a recipe or a live plan; using the built-in one.");
    } catch (error) {
      console.warn(
        "[video] HYAN_RECIPE unreadable; using the built-in one:",
        (error as Error).message,
      );
    }
  }
  return builtinRecipe(level);
}

/** A job's plan; with `live` when it was built from a shot list (or a live director made it). */
export interface Direction {
  plan: ShotPlan;
  live?: LiveDirection;
}

function liveRefs(place: Asset, cast: Asset[]): string[] {
  return [
    ...place.images.map((_, i) => `place-${i + 1}`),
    ...cast.flatMap((c, ci) => c.images.slice(0, 3).map((_, i) => `cast${ci + 1}-${i + 1}`)),
  ];
}

/**
 * Fixture mode: HYAN_FIXTURE_LIVE_PLAN, a folder with a live session's
 * `answer.json` and `record.json`, put through the same checks and prices.
 */
async function fixtureLive(ctx: LiveContext): Promise<Direction | null> {
  const folder = process.env.HYAN_FIXTURE_LIVE_PLAN;
  if (!folder) return null;
  try {
    const record = JSON.parse(await readFile(join(folder, "record.json"), "utf8")) as ToolRecord;
    const { plan, errors } = checkAnswer(
      await readFile(join(folder, "answer.json"), "utf8"),
      ctx,
      record,
    );
    if (errors.length || !plan) {
      console.warn("[video] fixture live plan broke rules:", errors.join(" | "));
      return null;
    }
    return {
      plan: plan.shots,
      live: liveDirection(plan, record, ctx.lines, ctx.level, {
        connection: "signed-in",
        model: null,
        ms: 0,
      }),
    };
  } catch (error) {
    console.warn("[video] fixture live plan:", (error as Error).message);
    return null;
  }
}

/** The plan for a job, and how it was made. */
export async function directJob(
  job: VideoJob,
  dir: string,
  /** What the director is doing, as it plans (src/shared/plan-progress.ts). */
  onSteps?: (steps: string[]) => void,
): Promise<Direction> {
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
  if (!ctx.hasPlace || !place) return { plan: rulesPlan(ctx) };
  const level = mediaLevel(job.level);
  const liveCtx: LiveContext = { ...ctx, refs: liveRefs(place, cast), level };
  if (providerMode() === "fixture") {
    const replay = await fixtureLive(liveCtx);
    if (replay) return replay;
  }

  const recipe = await loadRecipe(level);
  const caps: ShotListCaps = { motion: Boolean(recipe.motion) };
  const save = (name: string, text: string) =>
    writeFile(join(dir, name), text, "utf8").catch(() => undefined);
  const build = async (list: ShotList, run?: { model: string | null; ms: number }) => {
    await save("shot-list.json", JSON.stringify(list, null, 2));
    return {
      plan: list.shots,
      live: buildDirection({
        list,
        recipe,
        lines: job.lines,
        level,
        cast: cast.map((c) => ({ id: c.id, name: c.name, photos: c.images.length })),
        placePhotos: place.images.length,
        ...(run ? { run } : {}),
      }),
    };
  };
  if (textAiMode() === "fixture") return build(await fixtureShotList(ctx, caps));

  const names = new Map(cast.map((c) => [c.id, c.name]));
  const seats = seatsFor(castIds)
    .map(
      (s) =>
        `- ${names.get(s.characterId)}: sits ${s.side}, looks toward ${s.looks.replace("_", " ")}`,
    )
    .join("\n");
  const base = fill({
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

  const prompt = shotListPrompt(base, {
    level,
    motion: caps.motion,
    direction: directionSlot(job.direction),
  });
  await save("shot-list-prompt.md", prompt);
  const log: string[] = [];
  let request = prompt;
  let problems: string[] = [];
  const startedAt = Date.now();
  for (let attempt = 1; attempt <= 2; attempt++) {
    // A second attempt says why before it rewrites the plan.
    const opening =
      attempt === 1 ? [] : [`Sửa ${problems.length} chỗ chưa đúng quy tắc, viết lại kế hoạch`];
    const report = (text: string, tail: string[] = []) =>
      onSteps?.([...opening, ...directorSteps(text), ...tail]);
    report("");
    try {
      const answer = await askText({
        system: SYSTEM,
        prompt: request,
        purpose: "video-plan",
        sessionId: job.sessionId,
        temperature: 0.4,
        onText: (soFar) => report(soFar),
      });
      report(answer, ["Kiểm tra quy tắc"]);
      await save(`shot-list-answer-${attempt}.json`, answer);
      const { list, errors } = readShotList(parseJsonObject<ShotListAnswer>(answer), ctx, caps);
      if (!errors.length) {
        report(answer, ["Kiểm tra quy tắc", "Tính giá"]);
        return build(list, { model: null, ms: Date.now() - startedAt });
      }
      problems = errors;
      log.push(`attempt ${attempt}: ${errors.join(" | ")}`);
      request = `${prompt}\n\n## Your previous plan\n\n${answer}\n\n## It broke these rules\n\n${errors.map((e) => `- ${e}`).join("\n")}\n\nAnswer again with a corrected plan, as one JSON object.`;
    } catch (error) {
      problems = [(error as Error).message];
      log.push(`attempt ${attempt}: ${(error as Error).message}`);
    }
  }
  console.warn("[video] director fell back to rules:", log.join("\n"));
  return build(rulesShotList(ctx, rulesPlan(ctx, problems)));
}
