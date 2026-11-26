import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MAX_HOLDS_SEC } from "../../shared/board";
import { buildDirection } from "../../shared/build-direction";
import { directionSlot } from "../../shared/direction";
import type { Asset } from "../../shared/ipc";
import {
  type LiveContext,
  type LiveDirection,
  liveDirection,
  type ToolRecord,
} from "../../shared/live-plan";
import { type MaterialOffer, withMaterialKeys } from "../../shared/material-offer";
import { DIRECTOR_AREAS, notesBlock } from "../../shared/notes";
import { builtinRecipe } from "../../shared/recipe";
import { restagePlan } from "../../shared/restage";
import { directionText } from "../../shared/series-guide";
import { NO_PLACE } from "../../shared/series-place";
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
import { jobPace, modelsOf, type VideoJob } from "../../shared/video-job";
import { getBoard } from "../board";
import { providerMode } from "../providers";
import { getWorkspace } from "../store";
import { askText, parseJsonObject, textAiMode } from "../text-ai";
import PROMPT from "./director-prompt.md?raw";
import { checkAnswer } from "./live-prompt";
import { shotListPrompt } from "./shot-list-prompt";
import { stageShotList } from "./staging";

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

async function fixtureShotList(
  ctx: PlanContext,
  caps: ShotListCaps,
  offer: MaterialOffer | null,
): Promise<ShotList> {
  const scene = offer?.scene ?? null;
  const listFile = process.env.HYAN_FIXTURE_SHOT_LIST;
  if (!listFile) return rulesShotList(ctx, rulesPlan(ctx), scene);
  try {
    const answer = parseJsonObject<ShotListAnswer>(await readFile(listFile, "utf8"));
    const { list, errors } = readShotList(answer, ctx, caps, offer);
    if (!errors.length) return list;
    console.warn("[video] fixture shot list broke rules:", errors.join(" | "));
    return rulesShotList(ctx, rulesPlan(ctx, errors), scene);
  } catch (error) {
    return rulesShotList(ctx, rulesPlan(ctx, [(error as Error).message]), scene);
  }
}

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
      live: liveDirection(
        plan,
        record,
        {
          connection: "signed-in",
          model: null,
          ms: 0,
        },
        ctx.pace,
      ),
    };
  } catch (error) {
    console.warn("[video] fixture live plan:", (error as Error).message);
    return null;
  }
}

const CAPS: ShotListCaps = { motion: true, sound: true };

function restageOf(job: VideoJob, ctx: PlanContext, caps: ShotListCaps) {
  const basis = job.restageFrom;
  if (!basis) return null;
  const restage = restagePlan(basis, job.lines, ctx, caps);
  if (restage.kind === "full") {
    console.log(`[video] staging again in full (${restage.why})`);
    return null;
  }
  return restage;
}

export interface DirectMaterial {
  offer: MaterialOffer | null;
  newKey: () => string;
}

export async function directJob(
  job: VideoJob,
  dir: string,
  onSteps?: (steps: string[]) => void,
  signal?: AbortSignal,
  material?: DirectMaterial,
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

  if (!ctx.hasPlace || !place) throw new Error(NO_PLACE);
  const pace = jobPace(job);
  const liveCtx: LiveContext = { ...ctx, refs: liveRefs(place, cast), pace };
  if (providerMode() === "fixture") {
    const replay = await fixtureLive(liveCtx);
    if (replay) return replay;
  }

  const recipe = builtinRecipe(modelsOf(job));
  const save = (name: string, text: string) =>
    writeFile(join(dir, name), text, "utf8").catch(() => undefined);
  const offer = material?.offer ?? null;
  const keyed = (list: ShotList) =>
    material ? withMaterialKeys(list, material.newKey, job.restageFrom?.list) : list;
  const build = async (read: ShotList, run?: { model: string | null; ms: number }) => {
    const list = keyed(read);
    await save("shot-list.json", JSON.stringify(list, null, 2));
    return {
      plan: list.shots,
      live: buildDirection({
        list,
        recipe,
        cast: cast.map((c) => ({ id: c.id, name: c.name, photos: c.images.length })),
        placePhotos: place.images.length,
        pace,
        ...(run ? { run } : {}),
      }),
    };
  };
  if (textAiMode() === "fixture") return build(await fixtureShotList(ctx, CAPS, offer));

  const names = new Map(cast.map((c) => [c.id, c.name]));
  const seats = seatsFor(castIds)
    .map(
      (s) =>
        `- ${names.get(s.characterId)}: sits ${s.side}, looks toward ${s.looks.replace("_", " ")}`,
    )
    .join("\n");
  const base = fill({
    speech_rate: pace.toFixed(1),
    max_holds: String(MAX_HOLDS_SEC),
    place: describe(place),
    cast: cast.map((c) => `- ${describe(c)}`).join("\n"),
    products: products.map((p) => `- ${describe(p)}`).join("\n") || "none",
    series_direction: (series && directionText(series)) || "none",
    notes: notesBlock(ws.notes, series?.notes, DIRECTOR_AREAS) || "none",
    seats,
    staging_note: script?.staging?.trim() || "none",
    dialogue: job.lines
      .map((l, i) => `${i + 1}. ${names.get(l.characterId ?? "") ?? l.speaker}: ${l.text}`)
      .join("\n"),
  });

  const prompt = shotListPrompt(base, {
    direction: directionSlot(job.direction),
    reuse: Boolean(material),
    material: { offer, names },
  });
  await save("shot-list-prompt.md", prompt);
  const partial = restageOf(job, ctx, CAPS);
  const staged = await stageShotList({
    prompt,
    ask: (request, onText) =>
      askText({
        system: SYSTEM,
        prompt: request,
        purpose: "video-plan",
        sessionId: job.sessionId,
        temperature: 0.4,
        onText,
        ...(signal ? { signal } : {}),
      }),
    parse: (text) => parseJsonObject<unknown>(text),
    read: (answer) => readShotList(answer, ctx, CAPS, offer),
    save,
    ...(onSteps ? { onSteps } : {}),
    ...(partial ? { partial } : {}),
    ...(signal ? { signal } : {}),
  });
  if ("list" in staged) return build(staged.list, { model: null, ms: staged.ms });
  console.warn(`[video] director fell back to rules; see shot-list-problems-*.json in ${dir}`);
  return build(rulesShotList(ctx, rulesPlan(ctx, staged.problems), offer?.scene ?? null));
}
