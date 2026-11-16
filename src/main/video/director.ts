import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";
import { estimateSeconds, MAX_HOLDS_SEC, SPEECH_RATE } from "../../shared/board";
import type { Asset } from "../../shared/ipc";
import {
  type LiveContext,
  type LiveDirection,
  type LivePlan,
  liveDirection,
  type ToolRecord,
} from "../../shared/live-plan";
import { mediaLevel } from "../../shared/media-level";
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
import { claudeEnv, findClaude } from "../claude-code";
import { dataDir } from "../paths";
import { getKey, providerMode } from "../providers";
import { getWorkspace } from "../store";
import { askText, parseJsonObject, textAiMode } from "../text-ai";
import { logUsage } from "../usage";
import PROMPT from "./director-prompt.md?raw";
import { falConnections } from "./fal-tools";
import { ConnectionError, runLiveSession } from "./live-director";
import { checkAnswer, LIVE_SYSTEM, type LiveFile, livePrompt } from "./live-prompt";

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

/** A job's plan; with `live` when the live director made it (experiment branch). */
export interface Direction {
  plan: ShotPlan;
  live?: LiveDirection;
}

/** Placeholders the live director may reference: the place's photos and each cast member's. */
function liveFiles(place: Asset, cast: Asset[]): LiveFile[] {
  return [
    ...place.images.map((_, i) => ({
      id: `place-${i + 1}`,
      what: `photo ${i + 1} of the place (${place.name})`,
    })),
    ...cast.flatMap((c, ci) =>
      c.images.slice(0, 3).map((_, i) => ({
        id: `cast${ci + 1}-${i + 1}`,
        what: `reference photo ${i + 1} of ${c.name}`,
      })),
    ),
  ];
}

/**
 * The live director (experiment branch, docs/LIVE_DIRECTOR_EXPERIMENT.md):
 * the user's own Claude with the media provider's read-only planning tools,
 * signed in or with the app's key. Null when neither connection works or the
 * plan still breaks a rule after one correction: the fixed pipeline plans.
 */
async function directLive(
  job: VideoJob,
  dir: string,
  base: string,
  ctx: LiveContext,
  files: LiveFile[],
): Promise<Direction | null> {
  const bin = await findClaude();
  if (!bin) return null;
  const connections = await falConnections(await getKey("fal"));
  if (!connections.length) return null;
  const prompt = livePrompt(base, {
    level: ctx.level,
    files,
    seconds: estimateSeconds(job.lines),
    lines: job.lines,
  });
  await writeFile(join(dir, "live-prompt.md"), prompt, "utf8");
  const cwd = join(dataDir(), "claude-code");
  await mkdir(cwd, { recursive: true });
  const logFile = join(dir, "live-tools.jsonl");
  for (const connection of connections) {
    let plan: LivePlan | null = null;
    try {
      const result = await runLiveSession({
        bin,
        cwd,
        env: claudeEnv(),
        connection,
        system: LIVE_SYSTEM,
        prompt,
        timeoutMs: 15 * 60_000,
        clientVersion: app.getVersion(),
        check: (text, record) => {
          const checked = checkAnswer(text, ctx, record);
          plan = checked.plan;
          return checked.errors;
        },
        log: (entry) =>
          void appendFile(
            logFile,
            `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
          ).catch(() => undefined),
      });
      await writeFile(join(dir, "live-answer.json"), result.answer ?? "", "utf8");
      await writeFile(join(dir, "live-record.json"), JSON.stringify(result.record, null, 2));
      await logUsage({
        provider: "claude-code",
        purpose: "video-live-plan",
        sessionId: job.sessionId,
        durationMs: result.durationMs,
      });
      const accepted = plan as LivePlan | null;
      if (result.errors.length || !accepted) {
        console.warn("[video] live plan refused:", result.errors.join(" | "));
        return null;
      }
      return {
        plan: accepted.shots,
        live: liveDirection(accepted, result.record, ctx.lines, ctx.level, {
          connection: result.connection,
          model: result.model,
          ms: result.durationMs,
        }),
      };
    } catch (error) {
      console.warn(`[video] live director (${connection.kind}):`, (error as Error).message);
      if (!(error instanceof ConnectionError)) return null;
    }
  }
  return null;
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
export async function directJob(job: VideoJob, dir: string): Promise<Direction> {
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
  const files = liveFiles(place, cast);
  const liveCtx: LiveContext = {
    ...ctx,
    refs: files.map((f) => f.id),
    level: mediaLevel(job.level),
  };
  // Fixture mode never runs the live director (a saved one can be replayed),
  // unless HYAN_LIVE_DIRECTOR=1 asks for it: it is free, only planning tools.
  const liveAllowed =
    textAiMode() === "claude-code" &&
    (providerMode() === "live" || process.env.HYAN_LIVE_DIRECTOR === "1");
  if (providerMode() === "fixture" && !liveAllowed) {
    const replay = await fixtureLive(liveCtx);
    if (replay) return replay;
  }
  if (textAiMode() === "fixture") return { plan: await fixturePlan(ctx) };

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

  if (liveAllowed) {
    const live = await directLive(job, dir, prompt, liveCtx, files).catch((error) => {
      console.warn("[video] live director failed:", (error as Error).message);
      return null;
    });
    if (live) return live;
  }

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
      if (!errors.length) return { plan };
      problems = errors;
      log.push(`attempt ${attempt}: ${errors.join(" | ")}`);
      request = `${prompt}\n\n## Your previous plan\n\n${answer}\n\n## It broke these rules\n\n${errors.map((e) => `- ${e}`).join("\n")}\n\nAnswer again with a corrected plan, as one JSON object.`;
    } catch (error) {
      problems = [(error as Error).message];
      log.push(`attempt ${attempt}: ${(error as Error).message}`);
    }
  }
  console.warn("[video] director fell back to rules:", log.join("\n"));
  return { plan: rulesPlan(ctx, problems) };
}
