import { outputResolution } from "./batch-settings";
import {
  estimateSeconds,
  estimateUsd,
  estimateVoiceUsd,
  FRAME_USD,
  levelEstimateUsd,
  SPEECH_RATE,
  syllables,
} from "./board";
import type { DirectionEntry } from "./direction";
import type { ScriptLine } from "./ipc";
import {
  type CostRow,
  type CostTable,
  keyframeDeps,
  type LiveDirection,
  liveFrameUsd,
  liveShotUsd,
  modelName,
  plannedShotSec,
  ROUTE_LABEL,
  type Route,
  requestCost,
} from "./live-plan";
import { mediaLevel } from "./media-level";
import { isNetworkError, isNetworkMessage, retryDelayMs } from "./net-error";
import { CUTOUT_USD } from "./product-shot";
import type { Framing, ShotKind, ShotPlan } from "./shot-plan";
import {
  clipUsd,
  fitResolution,
  legacyModel,
  modelForClip,
  type VideoModel,
  videoModel,
} from "./video-models";

// A video job: one committed script made into one video
// (docs/VIDEO_GENERATION_DECISIONS.md, docs/DIRECTING_RULES.md). Everything
// here is pure, so the main process, the Video tab and tests share one answer
// for what a job is, what it costs, what stopping loses and what to do next
// after a restart.
//
// Persisted as job.json in the script's video folder. Stage is derived from
// what exists (plan, voice, stills, clips, final) rather than stored, so a
// restart continues from whatever was saved last.

/** At most this many speaking shots are with the provider at once. */
export const SHOTS_IN_FLIGHT = 3;
/** Shortest audio a speaking or listening shot is given; shorter ones are padded with silence. */
export const MIN_SHOT_SEC = 2;
/** Silence kept before and after each line when cutting the dialogue. */
export const LINE_PAD_SEC = 0.12;

export type ShotState =
  /** Waiting for its voice. */
  | "planned"
  /** Voice ready, not yet sent (or not yet rendered locally). */
  | "queued"
  /** With the provider (a request id is saved). */
  | "rendering"
  | "done"
  /** Failed after the automatic retry; can be retried by hand. */
  | "failed"
  /** Never sent because the job was stopped. */
  | "stopped";

/**
 * Speaker and listener shots are made by the provider from a still and audio
 * (the line, or silence). Wide and detail shots are stills moved locally,
 * free of charge.
 */
export const madeByProvider = (shot: Pick<JobShot, "kind" | "route" | "fallback">) =>
  shot.route
    ? // Planned live: its route says; a motion shot that fell back is moved locally.
      shot.route === "lip-sync" || (shot.route === "motion" && !shot.fallback)
    : shot.kind === "speaker" || shot.kind === "listener";

export interface JobShot {
  index: number;
  /** Experiment branch: how the live plan makes it; absent on the fixed pipeline. */
  route?: Route;
  /** Experiment branch: the plan's keyframe it starts from. */
  keyframe?: string;
  /** Experiment branch: the endpoint it was sent to, recorded with the request. */
  endpoint?: string;
  /**
   * Experiment branch: failed twice on its planned model, so it is made the
   * fixed way: lip-sync with the default speaking model, motion as a still-move.
   */
  fallback?: boolean;
  kind: ShotKind;
  framing: Framing | null;
  lineIndex: number;
  /** On screen, for speaker and listener shots. */
  characterId: string | null;
  /** Who speaks the words heard during this shot. */
  speaker: string;
  /** Words heard during this shot. */
  text: string;
  /** What is in frame (English), from the plan. */
  visual: string;
  productId: string | null;
  /**
   * Seconds of silence after this shot's words (a hold, from the plan): the
   * shot lasts that much longer and every later shot moves by it. Speaking
   * shots get the silence in their audio, so the person stays alive through it.
   */
  hold?: number;
  /** What the viewer sees, in plain Vietnamese (from the plan). */
  brief?: string;
  /**
   * Where the shot sits in the video (seconds), once the voice exists: the
   * dialogue's own timeline with the holds before it added.
   */
  start?: number;
  end?: number;
  state: ShotState;
  /** Audio sent with the shot (its words, or silence for a listener). */
  audio?: string;
  audioSec?: number;
  /**
   * Speaking-shot model that made (or is making) this shot, recorded when it
   * is sent so it is polled at the same endpoint. One model per video: the
   * job's, or the default when the shot is too long for it. Shots sent before
   * models could be chosen have none and read as the default.
   */
  model?: string;
  /** Provider request; saved the moment the provider accepts it. */
  requestId?: string;
  submittedAt?: string;
  /** Finished clip (file in the job folder) and its length. */
  clip?: string;
  clipSec?: number;
  /** Result read from the provider (cost logged); download pending if no clip. */
  resultUrl?: string;
  /** Charged (estimate from seconds × rate). */
  costUsd?: number;
  /** The automatic retry was used. */
  retried: boolean;
  /** Provider attempts that failed (fixture mode uses it to simulate failures). */
  failures: number;
  error?: string;
}

export type FrameKind =
  /** The whole scene, made first; the others are drawn from it. */
  | "wide"
  /** One per character on screen. */
  | "character"
  /** One per detail shot of an object or action. */
  | "detail"
  /**
   * A product shot: its cut-out placed on a generated plate of the spot in
   * the scene (`plate`, charged like a still), or its own photo on a blurred
   * fill when there is no place or no usable cut-out (free).
   */
  | "product";

export interface JobFrame {
  /** "wide", "character:<id>", "detail:<shot>", "product:<shot>", or "kf:<keyframe>" (live plan). */
  id: string;
  /** Experiment branch: the live plan's keyframe this still is. */
  keyframe?: string;
  /** Experiment branch: the keyframe's framing, for the still check. */
  framing?: string;
  /** Experiment branch: the endpoint it was sent to, recorded with the request. */
  endpoint?: string;
  /** Experiment branch: failed twice on its planned model, so it is made the fixed way. */
  fallback?: boolean;
  kind: FrameKind;
  characterId?: string;
  /** Detail and product stills: the shot they belong to. */
  shot?: number;
  productId?: string;
  /** Still file in the job folder. */
  file?: string;
  /** Generated (charged); the character's cover, the product's photo or the series' kept look (free). */
  source?: "generated" | "cover" | "photo" | "look";
  /** A correction from the operator's feedback, added to the request for this still. */
  note?: string;
  /** Product shots: the generated plate (the spot, empty) under the cut-out; `file` is the two composited. */
  plate?: string;
  /** Product shots: the product's cut-out, copied into the job folder. */
  cutout?: string;
  /** Product shots: no usable cut-out exists, so the product's own photo is used (free). */
  noCutout?: boolean;
  /** Product shots: cut-outs that may still have to be made for it, at most (estimate only). */
  cutouts?: number;
  requestId?: string;
  submittedAt?: string;
  /** Result read from the provider (cost logged); download pending if no file. */
  resultUrl?: string;
  costUsd?: number;
  retried: boolean;
  /** Made again once because the automatic check found a problem. */
  redone?: boolean;
  /** What the automatic check found, kept for the record. */
  check?: string;
  error?: string;
}

export type JobStatus =
  /** Committed before jobs existed, or not started: shows the make button. */
  | "idle"
  /** Committed; another video is being made first. */
  | "waiting"
  | "running"
  | "stopped"
  /** A step failed for good (or a shot did); "tạo tiếp" continues. */
  | "failed"
  /** Test video: voice and stills are ready; waits for the operator before the expensive step. */
  | "review"
  | "done";

export type JobPhase = "plan" | "voice" | "frames" | "shots" | "assemble" | "done";

export interface VideoJob {
  version: 2;
  sessionId: string;
  scriptId: string;
  seriesId: string;
  status: JobStatus;
  /** Order of commitment; jobs run one at a time in this order. */
  queuedAt: string;
  createdAt: string;
  updatedAt: string;
  /** Script title, kept for the record. */
  title: string;
  /** The dialogue as committed (lines with a library speaker). */
  lines: ScriptLine[];
  /** What the viewer sees, decided before anything is paid for. */
  plan?: ShotPlan;
  /**
   * Experiment branch: the live director's plan (models per step, keyframes,
   * routes) and its prices. Absent when the fixed pipeline planned.
   */
  live?: LiveDirection;
  /** Experiment branch: the Media level (src/shared/media-level.ts), fixed at creation. */
  level?: string;
  /** Experiment branch: the plan is being made now, before any hold. */
  planning?: boolean;
  /** While planning: what the director has done so far, one short line each (src/shared/plan-progress.ts). */
  planningSteps?: string[];
  /**
   * The operator's wishes for how it is filmed (src/shared/direction.ts),
   * given to the director; kept when the plan is made again.
   */
  direction?: DirectionEntry[];
  /** The script's products when the job was made, to tell when its plan no longer fits. */
  productIds?: string[];
  /** Whole dialogue (file), its length and what it cost. */
  dialogue?: string;
  dialogueSec?: number;
  voiceCostUsd?: number;
  voiceChars?: number;
  /** Where each line sits in the dialogue (seconds), kept so a restart can cut again for free. */
  lineSpans?: { start: number; end: number }[];
  /** Generated stills need a place; otherwise covers are used. */
  useEnvironment: boolean;
  /**
   * Speaking-shot model. Until the first shot is sent the video follows its
   * batch (or its own `ownModel`) and this is only provisional
   * (`followBatch`); then it is fixed for good (`modelLocked`). Missing on
   * jobs saved before models could be chosen (the default).
   */
  model?: string;
  /** This video's own model, chosen on its card before any shot was sent; overrides the batch. */
  ownModel?: string;
  /** Model and resolution were fixed when the first shot was sent. */
  modelLocked?: boolean;
  /**
   * Output size ("720p" | "1080p"), resolved like the model and kept, also
   * through fixes; missing on jobs saved before (720p, src/shared/batch-settings.ts).
   */
  resolution?: string;
  frames: JobFrame[];
  shots: JobShot[];
  /** Assembly progress 0–1 while assembling. */
  assembleProgress?: number;
  final?: string;
  finalSec?: number;
  /** Why the job failed, for the status line. */
  error?: string;
  /**
   * No connection right now (src/shared/net-error.ts): the job keeps running
   * and tries again at `retryAt`, with saved request ids polled, never sent
   * again. Cleared by the first step that reaches the provider.
   */
  offline?: { since: string; tries: number; retryAt: string; error: string };
  /** When the current phase started (for the time estimate). */
  phaseStartedAt?: string;
  /** Test video: stop once after voice and stills so the operator can listen and look. */
  pause?: boolean;
  reviewed?: boolean;
  /**
   * Fixes made after the first cut (docs/VIDEO_REVIEW_DECISIONS.md): each one
   * raises `rev`, so remade files get new names and the previous cut's files
   * stay playable. `previous` is the cut before the last fix.
   */
  rev?: number;
  cutRev?: number;
  previous?: JobCut;
  /**
   * Charged for everything not in the current cut: parts a fix replaced, and
   * other takes (so `spentUsd` is the whole video, all takes included).
   */
  pastCostUsd?: number;
  /**
   * Takes with other models (src/shared/video-takes.ts), parked while this
   * one (the top-level fields) is the one being worked on.
   */
  takes?: JobTake[];
  /** Model of the take that is "the video"; missing: the one being worked on. */
  chosen?: string;
  /** Takes by model, in the order they were made (the first is the original). */
  takeOrder?: string[];
  /** What each take cost on its own (src/shared/video-takes.ts, `takeCostUsd`). */
  takeLedger?: TakeLedger;
}

/**
 * Who paid for what across takes. `shared`: the voice and stills made once
 * and reused by every take. `spent`: each take's own spend (its speaking
 * shots, and anything remade in fixes while it was worked on), up to `since`,
 * the video's total when the working take was last put to work.
 */
export interface TakeLedger {
  shared: number;
  spent: Record<string, number>;
  since: number;
  /** Takes made before costs were kept per take, and not reconstructable. */
  unknown?: boolean;
}

/** A take with another model, parked: its cut and what the top-level fields hold for the working take. */
export interface JobTake {
  /** Speaking-shot model id: one take per model. */
  model: string;
  resolution?: string;
  status: JobStatus;
  cut: JobCut;
  previous?: JobCut;
}

/** Everything that makes one cut of the video; a fix swaps it as a whole. */
export interface JobCut {
  plan?: ShotPlan;
  dialogue?: string;
  dialogueSec?: number;
  voiceCostUsd?: number;
  voiceChars?: number;
  lineSpans?: { start: number; end: number }[];
  frames: JobFrame[];
  shots: JobShot[];
  final?: string;
  finalSec?: number;
  /** The revision this cut's final video was made at: tells the newer cut from the older. */
  cutRev?: number;
}

/** A file name for something made now: remade files never overwrite an earlier cut's. */
export const revFile = (job: Pick<VideoJob, "rev">, base: string, ext: string) =>
  job.rev ? `${base}-r${job.rev}.${ext}` : `${base}.${ext}`;

// ---------------------------------------------------------------------------
// Shot list from the plan
// ---------------------------------------------------------------------------

/** Lines that can be voiced: a library speaker and some text. */
export const spokenLines = (lines: ScriptLine[]) =>
  lines.filter((l) => l.characterId && l.text.trim());

export function newJob(input: {
  sessionId: string;
  seriesId: string;
  scriptId: string;
  title: string;
  lines: ScriptLine[];
  useEnvironment: boolean;
  /** The resolved speaking-shot model (src/shared/batch-settings.ts); absent means the default. */
  model?: string;
  /** The resolved output size; absent means 720p. */
  resolution?: string;
  now: string;
}): VideoJob {
  return {
    version: 2,
    sessionId: input.sessionId,
    seriesId: input.seriesId,
    scriptId: input.scriptId,
    title: input.title,
    status: "waiting",
    queuedAt: input.now,
    createdAt: input.now,
    updatedAt: input.now,
    lines: spokenLines(input.lines).map((l) => ({ ...l, text: l.text.trim() })),
    useEnvironment: input.useEnvironment,
    ...(input.model ? { model: videoModel(input.model).id } : {}),
    ...(input.resolution ? { resolution: outputResolution(input.resolution) } : {}),
    frames: [],
    shots: [],
  };
}

/** The still a shot is made from. */
export function frameIdFor(
  shot: Pick<JobShot, "kind" | "characterId" | "productId" | "index" | "keyframe">,
) {
  if (shot.keyframe) return `kf:${shot.keyframe}`;
  if (shot.kind === "wide") return "wide";
  if (shot.kind === "detail") return `${shot.productId ? "product" : "detail"}:${shot.index}`;
  return `character:${shot.characterId}`;
}

export const frameFor = (job: VideoJob, shot: JobShot) =>
  job.frames.find((f) => f.id === frameIdFor(shot));

/** Shots and stills from a plan. Without a place, only covers and product photos are used. */
export function applyPlan(job: VideoJob, plan: ShotPlan): VideoJob {
  const shots: JobShot[] = plan.shots.map((p, index) => ({
    index,
    kind: p.kind,
    framing: p.framing,
    lineIndex: p.line,
    characterId: p.characterId,
    speaker: job.lines[p.line]?.speaker ?? "",
    text: p.text,
    visual: p.visual,
    productId: p.productId,
    ...(p.hold ? { hold: p.hold } : {}),
    ...(p.brief ? { brief: p.brief } : {}),
    state: "planned",
    retried: false,
    failures: 0,
  }));
  const frames: JobFrame[] = [];
  const add = (frame: Omit<JobFrame, "retried">) => {
    if (!frames.some((f) => f.id === frame.id)) frames.push({ ...frame, retried: false });
  };
  // The wide still comes first: every other generated still is drawn from it.
  if (job.useEnvironment && shots.some((s) => s.kind !== "detail" || !s.productId)) {
    add({ id: "wide", kind: "wide" });
  }
  for (const shot of shots) {
    if (madeByProvider(shot) && shot.characterId) {
      add({ id: frameIdFor(shot), kind: "character", characterId: shot.characterId });
    } else if (shot.kind === "detail") {
      add(
        shot.productId
          ? { id: frameIdFor(shot), kind: "product", shot: shot.index, productId: shot.productId }
          : { id: frameIdFor(shot), kind: "detail", shot: shot.index },
      );
    }
  }
  return { ...job, plan, shots, frames };
}

/** How a planned keyframe is treated by the stills' code: its kind there. */
const KEYFRAME_FRAME: Record<string, FrameKind> = {
  master: "wide",
  character: "character",
  action: "detail",
  plate: "product",
};

/**
 * Experiment branch: shots and stills from a live plan. Every still is one of
 * the plan's keyframes (`kf:<id>`); each shot keeps its route and keyframe. A
 * product shot without a plate keyframe keeps the fixed product still.
 */
export function applyLivePlan(job: VideoJob, live: LiveDirection): VideoJob {
  const base = applyPlan(job, live.plan.shots);
  const shots = base.shots.map((s) => {
    const r = live.plan.routes[s.index];
    if (!r) return s;
    const keyframe = r.keyframe && live.plan.keyframes.some((k) => k.id === r.keyframe);
    return { ...s, route: r.route, ...(keyframe ? { keyframe: r.keyframe as string } : {}) };
  });
  const frames: JobFrame[] = live.plan.keyframes.map((k) => {
    const kind = KEYFRAME_FRAME[k.kind] ?? "detail";
    const first = shots.find((s) => s.keyframe === k.id);
    const product = shots.find((s) => s.keyframe === k.id && s.productId);
    return {
      id: `kf:${k.id}`,
      kind,
      keyframe: k.id,
      framing: k.framing,
      retried: false,
      ...(k.characterId ? { characterId: k.characterId } : {}),
      ...(first ? { shot: first.index } : {}),
      ...(kind === "product" && product?.productId ? { productId: product.productId } : {}),
    };
  });
  // A plate keyframe no product shot uses is only a still: a detail.
  for (const f of frames) if (f.kind === "product" && !f.productId) f.kind = "detail";
  for (const s of shots) {
    if (!s.keyframe && s.productId) {
      const fixed = base.frames.find((f) => f.id === frameIdFor(s));
      if (fixed && !frames.some((f) => f.id === fixed.id)) frames.push(fixed);
    }
  }
  return { ...base, live, shots, frames };
}

/** Experiment branch: the keyframes a still waits for (it is made from them). */
export const frameDeps = (job: Pick<VideoJob, "live">, frame: JobFrame): string[] =>
  job.live && frame.keyframe && !frame.fallback
    ? keyframeDeps(job.live, frame.keyframe).map((id) => `kf:${id}`)
    : [];

// ---------------------------------------------------------------------------
// Phase and costs
// ---------------------------------------------------------------------------

export function jobPhase(job: VideoJob): JobPhase {
  if (!job.plan) return "plan";
  if (
    !job.dialogue ||
    job.shots.some((s) => s.end === undefined || (madeByProvider(s) && !s.audio))
  )
    return "voice";
  if (job.frames.some((f) => !f.file)) return "frames";
  if (job.shots.some((s) => s.state !== "done")) return "shots";
  if (!job.final) return "assemble";
  return "done";
}

/** Seconds a shot lasts: its place in the dialogue once known, else a guess from its words. */
export function shotSeconds(shot: JobShot): number {
  if (shot.start !== undefined && shot.end !== undefined) return shot.end - shot.start;
  return syllables([shot]) / SPEECH_RATE + 2 * LINE_PAD_SEC + (shot.hold ?? 0);
}

/** Seconds of silence the holds add to the video. */
export const holdsSec = (shots: Pick<JobShot, "hold">[]) =>
  shots.reduce((n, s) => n + (s.hold ?? 0), 0);

/** Seconds billed: the clip once made, else its audio, never under the minimum. Local shots: none. */
export function billedSeconds(shot: JobShot): number {
  if (!madeByProvider(shot)) return 0;
  if (shot.clipSec) return shot.clipSec;
  if (shot.audioSec) return Math.max(MIN_SHOT_SEC, shot.audioSec);
  return Math.max(MIN_SHOT_SEC, shotSeconds(shot));
}

/**
 * The model that makes a shot. Sent or made: the one recorded on it. Not yet
 * sent (also a remake): the job's, or the default when the shot is longer
 * than that model takes.
 */
export function shotModel(job: Pick<VideoJob, "model">, shot: JobShot): VideoModel {
  if (shot.requestId || shot.state === "rendering" || shot.state === "done") {
    return videoModel(shot.model);
  }
  return modelForClip(job.model, billedSeconds(shot));
}

/**
 * Experiment branch: seconds a planned shot is sent and priced at: its audio
 * for lip-sync, its place on the timeline for motion, else as planned.
 */
export function liveSeconds(shot: JobShot): number {
  if (shot.route === "lip-sync" && shot.audioSec) return shot.audioSec;
  if (shot.start !== undefined && shot.end !== undefined) return shot.end - shot.start;
  return plannedShotSec(shot);
}

/** What a shot costs (or cost) at its model's rate and minimum, at the video's size. */
export const shotEstimateUsd = (
  job: Pick<VideoJob, "model" | "resolution" | "live">,
  shot: JobShot,
) => {
  if (!madeByProvider(shot)) return 0;
  if (job.live && shot.route && !shot.fallback) {
    return liveShotUsd(job.live, shot.index, liveSeconds(shot)) ?? 0;
  }
  return clipUsd(shotModel(job, shot), billedSeconds(shot), job.resolution);
};

/** What one still costs: its keyframe's planned model, else the default image model. */
export const frameUsd = (job: Pick<VideoJob, "live">, frame: JobFrame) =>
  job.live && frame.keyframe && !frame.fallback
    ? (liveFrameUsd(job.live, frame.keyframe) ?? 0)
    : FRAME_USD;

/**
 * Model and resolution are fixed: a shot has been sent (or made), or the
 * video is finished, fixed or has takes. Before that the video follows its
 * batch's settings, or its own model.
 */
export const modelLocked = (job: VideoJob) =>
  Boolean(
    job.modelLocked ||
      job.takes?.length ||
      job.final ||
      job.previous ||
      job.shots.some(
        (s) =>
          madeByProvider(s) &&
          Boolean(s.requestId || s.model || s.state === "rendering" || s.state === "done"),
      ),
  );

/**
 * The job with the model and resolution it would use now: its own fixed
 * ones once locked, else its own model or the batch's, at the batch's
 * resolution fitted to that model.
 */
export function followBatch(job: VideoJob, batch: { model: string; resolution: string }): VideoJob {
  // Experiment branch: a live plan fixes its own models and size.
  if (modelLocked(job) || job.live) return job;
  const model = videoModel(job.ownModel ?? batch.model).id;
  return { ...job, model, resolution: fitResolution(model, batch.resolution) };
}

/** Charged for the parts of one cut. */
export const cutCostUsd = (cut: Pick<JobCut, "voiceCostUsd" | "frames" | "shots">) =>
  (cut.voiceCostUsd ?? 0) +
  cut.frames.reduce((n, f) => n + (f.costUsd ?? 0), 0) +
  cut.shots.reduce((n, s) => n + (s.costUsd ?? 0), 0);

/** Money already charged, including parts later replaced by a fix. */
export const spentUsd = (job: VideoJob) => cutCostUsd(job) + (job.pastCostUsd ?? 0);

/**
 * Stills that cost money, only with a place: everything but a product shot
 * made from its own photo (no usable cut-out, or made before plates).
 */
export const isGenerated = (job: Pick<VideoJob, "useEnvironment">, frame: JobFrame) =>
  job.useEnvironment && (frame.kind !== "product" || (!frame.noCutout && frame.source !== "photo"));

/** Cut-outs still to be made for product shots (once per photo, ever). */
const cutoutsToMakeUsd = (job: VideoJob) =>
  job.frames
    .filter((f) => f.kind === "product" && !f.file && !f.cutout && isGenerated(job, f))
    .reduce((n, f) => n + (f.cutouts ?? 0) * CUTOUT_USD, 0);

const framesToMake = (job: VideoJob) => job.frames.filter((f) => !f.file && isGenerated(job, f));

/**
 * What stopping now costs in total: what is spent, plus requests already with
 * the provider (they finish and are charged; their results are kept).
 */
export function lossIfStoppedUsd(job: VideoJob): number {
  return (
    spentUsd(job) +
    job.shots
      .filter((s) => s.state === "rendering")
      .reduce((n, s) => n + shotEstimateUsd(job, s), 0) +
    framesToMake(job)
      .filter((f) => f.requestId)
      .reduce((n, f) => n + frameUsd(job, f), 0)
  );
}

/** What making the rest costs from here: only what is missing and not already with the provider. */
export function costToFinishUsd(job: VideoJob): number {
  // Before the plan, the same estimate as the make button.
  if (!job.plan) {
    return estimateUsd(job.lines, {
      frames: job.useEnvironment,
      model: job.model,
      resolution: job.resolution,
      level: job.level,
    });
  }
  const voice = job.dialogue ? 0 : estimateVoiceUsd(job.lines);
  const frames =
    framesToMake(job)
      .filter((f) => !f.requestId)
      .reduce((n, f) => n + frameUsd(job, f), 0) + cutoutsToMakeUsd(job);
  const shots = job.shots
    .filter((s) => s.state !== "done" && s.state !== "rendering")
    .reduce((n, s) => n + shotEstimateUsd(job, s), 0);
  return voice + frames + shots;
}

/** Whether the next hold stops at "Nghe và xem thử" after the voice and the stills. */
export const stopsForPreview = (job: VideoJob) =>
  Boolean(
    job.plan &&
      job.pause &&
      !job.reviewed &&
      job.status !== "review" &&
      // The preview is still to make: once voice and stills exist, the next hold makes the video.
      (!job.dialogue || job.frames.some((f) => !f.file)) &&
      job.shots.every((s) => s.state === "queued" || s.state === "planned"),
  );

/** What the hold up to "Nghe và xem thử" spends: the voice and the stills still to make. */
export function costToPreviewUsd(job: VideoJob): number {
  if (!job.plan) return costToFinishUsd(job);
  const voice = job.dialogue ? 0 : estimateVoiceUsd(job.lines);
  return (
    voice +
    framesToMake(job)
      .filter((f) => !f.requestId)
      .reduce((n, f) => n + frameUsd(job, f), 0) +
    cutoutsToMakeUsd(job)
  );
}

/**
 * Experiment branch: the cost table of a planned video as it stands: what is
 * made at what it cost, the rest at the session's recorded rates (unknown
 * when none fits). Its total is what the hold and the status line show.
 */
export function liveCostTable(job: VideoJob): CostTable | null {
  const live = job.live;
  if (!live) return null;
  const rows: CostRow[] = [
    {
      step: "Giọng đọc",
      model: null,
      quantity: "",
      usd: job.voiceCostUsd ?? estimateVoiceUsd(job.lines),
      paid: job.voiceCostUsd !== undefined,
    },
  ];
  for (const f of job.frames) {
    const k = f.keyframe ? live.plan.keyframes.find((x) => x.id === f.keyframe) : undefined;
    const made = Boolean(f.file || f.resultUrl);
    const planned = k && !f.fallback;
    const estimate = !isGenerated(job, f) ? 0 : planned ? liveFrameUsd(live, k.id) : FRAME_USD;
    rows.push({
      // A product's still is its cut-out on a drawn spot, not a planned keyframe.
      step: f.kind === "product" && !planned ? "Ảnh sản phẩm" : `Khung hình ${f.keyframe ?? f.id}`,
      model: planned ? modelName(live.schemas, k.endpoint) : null,
      quantity: isGenerated(job, f) ? "1 ảnh" : "",
      usd: made ? (f.costUsd ?? 0) : estimate,
      paid: made,
    });
  }
  const cutouts = cutoutsToMakeUsd(job);
  if (cutouts > 0)
    rows.push({ step: "Tách nền sản phẩm", model: null, quantity: "", usd: cutouts });
  for (const shot of job.shots) {
    const route = shot.route ?? "still-move";
    const step = `Cảnh ${shot.index + 1} · ${ROUTE_LABEL[shot.fallback && route === "motion" ? "still-move" : route]}`;
    const made = shot.state === "done" || Boolean(shot.resultUrl);
    if (!madeByProvider(shot)) {
      rows.push({ step, model: null, quantity: "", usd: 0 });
      continue;
    }
    const r = live.plan.routes[shot.index];
    if (r?.endpoint && r.input && !shot.fallback) {
      const cost = requestCost(
        live.rates[r.endpoint],
        live.schemas[r.endpoint],
        r.input,
        r.route,
        liveSeconds(shot),
      );
      rows.push({
        step,
        model: modelName(live.schemas, r.endpoint),
        quantity: cost.quantity,
        usd: made ? (shot.costUsd ?? 0) : cost.usd,
        paid: made,
      });
    } else {
      rows.push({
        step,
        model: shotModel(job, shot).name,
        quantity: `${Math.round(billedSeconds(shot) * 10) / 10} giây`,
        usd: made ? (shot.costUsd ?? 0) : shotEstimateUsd(job, shot),
        paid: made,
      });
    }
  }
  return {
    rows,
    knownUsd: rows.reduce((n, r) => n + (r.usd ?? 0), 0),
    unknownSteps: rows.filter((r) => r.usd === null).length,
    budgetUsd: levelEstimateUsd(mediaLevel(job.level), estimateSeconds(job.lines)),
    seconds: job.shots.reduce((n, sh) => n + liveSeconds(sh), 0),
  };
}

/** Expected all-in total: spent, in flight, and the rest. */
export const totalEstimateUsd = (job: VideoJob) => lossIfStoppedUsd(job) + costToFinishUsd(job);

export const doneShots = (job: VideoJob) => job.shots.filter((s) => s.state === "done").length;

/**
 * A job saved with a model id from before MiniMax became one entry: the merged
 * model, at the output size that id implied unless the job has its own, so
 * remakes still ask for the same resolution.
 */
function legacyJobModel<T extends Pick<VideoJob, "model" | "resolution">>(job: T): T {
  const legacy = legacyModel(job.model);
  return legacy
    ? { ...job, model: legacy.id, resolution: job.resolution ?? legacy.resolution }
    : job;
}

/**
 * Jobs saved before shot plans (version 1): one close-up per line. They are
 * read as a plan of speaker shots, each covering its own line, so finished
 * ones still show and unfinished ones continue without paying again.
 */
export function migrateJob(raw: unknown): VideoJob {
  const job = legacyJobModel(raw as VideoJob & { version: number });
  if (job.version === 2) return job;
  type OldShot = Omit<JobShot, "kind" | "framing" | "visual" | "productId">;
  type OldFrame = Omit<JobFrame, "id" | "kind">;
  const oldShots = job.shots as unknown as OldShot[];
  const lines: ScriptLine[] = oldShots.map((s) => ({
    characterId: s.characterId,
    speaker: s.speaker,
    text: s.text,
  }));
  const spans = job.lineSpans ?? [];
  const total = job.dialogueSec ?? 0;
  return {
    ...job,
    version: 2,
    lines,
    plan: {
      source: "legacy",
      seats: [],
      props: [],
      stateChanges: [],
      shots: oldShots.map((s, i) => ({
        kind: "speaker",
        characterId: s.characterId,
        framing: "medium_close",
        line: i,
        text: s.text,
        visual: "",
        productId: null,
        why: "",
      })),
    },
    frames: (job.frames as unknown as OldFrame[]).map((f) => ({
      ...f,
      id: `character:${f.characterId}`,
      kind: "character",
    })),
    shots: oldShots.map((s, i) => {
      const span = spans[i];
      const next = spans[i + 1];
      const prev = spans[i - 1];
      return {
        ...s,
        kind: "speaker",
        framing: "medium_close",
        visual: "",
        productId: null,
        lineIndex: i,
        ...(span
          ? {
              start: i === 0 ? 0 : prev ? (prev.end + span.start) / 2 : span.start,
              end: next ? (span.end + next.start) / 2 : Math.max(total, span.end),
            }
          : {}),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Transitions (operator actions)
// ---------------------------------------------------------------------------

/**
 * Stop: shots not yet sent are never sent; shots with the provider finish, are
 * charged and kept. Nothing else changes, so resuming continues from here.
 */
export function stopJob(job: VideoJob, now: string): VideoJob {
  if (job.status !== "running" && job.status !== "waiting") return job;
  return {
    ...job,
    status: "stopped",
    offline: undefined,
    updatedAt: now,
    shots: job.shots.map((s) =>
      s.state === "queued" || s.state === "planned" ? { ...s, state: "stopped" } : s,
    ),
  };
}

/**
 * Start or continue ("tạo tiếp"): everything that exists is kept; stopped and
 * failed shots go back in line with a fresh automatic retry.
 */
export function resumeJob(job: VideoJob, now: string): VideoJob {
  if (job.status === "running" || job.status === "waiting" || job.status === "done") return job;
  return {
    ...job,
    status: "waiting",
    // Continuing from the pause is the operator's go-ahead for the expensive step.
    reviewed: job.status === "review" ? true : job.reviewed,
    queuedAt: job.status === "idle" ? now : job.queuedAt,
    error: undefined,
    offline: undefined,
    updatedAt: now,
    frames: job.frames.map((f) =>
      f.file || f.requestId ? f : { ...f, retried: false, error: undefined },
    ),
    shots: job.shots.map((s) =>
      s.state === "stopped" || s.state === "failed"
        ? { ...s, state: hasInput(s) ? "queued" : "planned", retried: false, error: undefined }
        : s,
    ),
  };
}

/**
 * "Make everything" on the Video tab: the job runs to the end with no stop at
 * "Nghe và xem thử", whatever state it is in. A finished video is left alone.
 */
export function runThrough(job: VideoJob, now: string): VideoJob {
  if (job.status === "done") return job;
  return { ...resumeJob(job, now), reviewed: true };
}

/** One failed shot, retried by hand: back in line, and the job continues. */
export function retryShot(job: VideoJob, index: number, now: string): VideoJob {
  const shot = job.shots[index];
  if (shot?.state !== "failed") return job;
  const shots = job.shots.map((s) =>
    s.index === index ? { ...s, state: "queued" as const, retried: false, error: undefined } : s,
  );
  const active = job.status === "running" || job.status === "waiting";
  return {
    ...job,
    shots,
    status: active ? job.status : "waiting",
    error: undefined,
    updatedAt: now,
  };
}

/**
 * A provider attempt failed (not charged). The first failure goes back in
 * line once; the second marks the shot failed.
 */
export function shotFailed(shot: JobShot, message: string): JobShot {
  const base = {
    ...shot,
    requestId: undefined,
    submittedAt: undefined,
    failures: shot.failures + 1,
  };
  return shot.retried
    ? { ...base, state: "failed", error: message }
    : { ...base, state: "queued", retried: true, error: undefined };
}

/**
 * Experiment branch: as `shotFailed`, except that a planned shot failing for
 * the second time falls back (decision 9): lip-sync is made with the default
 * speaking model, motion as a still-move. It goes back in line at once.
 */
export function shotAttemptFailed(
  job: Pick<VideoJob, "live">,
  shot: JobShot,
  message: string,
): JobShot {
  const next = { ...shotFailed(shot, message), endpoint: undefined };
  if (next.state !== "failed" || !job.live || !shot.route || shot.fallback) return next;
  return { ...next, state: "queued", fallback: true, retried: false, error: undefined };
}

/** A shot has what it needs to be made: its place in the dialogue, and audio if the provider makes it. */
export const hasInput = (s: JobShot) =>
  s.end !== undefined && (!madeByProvider(s) || Boolean(s.audio));

/**
 * Voice cut for the shots: each gets its place in the dialogue and, when the
 * provider makes it, its audio. Shots with what they need are ready to make.
 */
export function withShotAudio(
  job: VideoJob,
  inputs: { start: number; end: number; audio?: string; audioSec?: number }[],
): VideoJob {
  return {
    ...job,
    shots: job.shots.map((s, i) => {
      const input = inputs[i];
      if (!input) return s;
      const next = { ...s, ...input };
      return { ...next, state: s.state === "planned" && hasInput(next) ? "queued" : s.state };
    }),
  };
}

// ---------------------------------------------------------------------------
// What to do next (also after a restart)
// ---------------------------------------------------------------------------

export type JobAction =
  | { kind: "plan" }
  | { kind: "voice" }
  | { kind: "frame"; frame: string }
  | { kind: "poll-frame"; frame: string }
  | { kind: "submit-shot"; index: number }
  | { kind: "poll-shot"; index: number }
  | { kind: "assemble" };

export const actionKey = (a: JobAction) =>
  a.kind === "frame" || a.kind === "poll-frame"
    ? `frame:${a.frame}`
    : a.kind === "submit-shot" || a.kind === "poll-shot"
      ? `shot:${a.index}`
      : a.kind;

/**
 * The actions to start now. `busy` holds action keys already running in this
 * process. Never pays twice: anything with a saved request id is polled,
 * never resubmitted; anything finished on disk is reused. Stopped and failed
 * jobs still collect what is already with the provider.
 */
export function nextActions(job: VideoJob, busy: ReadonlySet<string>): JobAction[] {
  const actions: JobAction[] = [];
  const add = (a: JobAction) => {
    if (!busy.has(actionKey(a))) actions.push(a);
  };

  // Paid requests in flight are always collected, whatever the job's status.
  for (const f of job.frames) {
    if (!f.file && f.requestId) add({ kind: "poll-frame", frame: f.id });
  }
  for (const s of job.shots) {
    if (s.state === "rendering" && s.requestId) add({ kind: "poll-shot", index: s.index });
  }
  if (job.status !== "running") return actions;

  const phase = jobPhase(job);
  if (phase === "plan") {
    add({ kind: "plan" });
  } else if (phase === "voice") {
    add({ kind: "voice" });
  } else if (phase === "frames") {
    // Generated stills are drawn from the wide one, so it comes first.
    const wide = job.frames.find((f) => f.kind === "wide");
    const wideReady = !wide || Boolean(wide.file) || !isGenerated(job, wide);
    for (const f of job.frames) {
      if (f.file || f.requestId || f.error) continue;
      if (f.keyframe && !f.fallback) {
        // A planned keyframe waits for the keyframes it is made from.
        const deps = frameDeps(job, f);
        if (deps.some((id) => !job.frames.find((x) => x.id === id)?.file)) continue;
        add({ kind: "frame", frame: f.id });
        continue;
      }
      // A product's plate is drawn from the wide still too.
      if (f.kind !== "wide" && (isGenerated(job, f) || f.kind === "product") && !wideReady) {
        continue;
      }
      add({ kind: "frame", frame: f.id });
    }
  } else if (phase === "shots") {
    const sending = (s: JobShot) => busy.has(actionKey({ kind: "submit-shot", index: s.index }));
    // Provider shots: at most three with the provider. Local shots: one at a time.
    let free =
      SHOTS_IN_FLIGHT -
      job.shots.filter((s) => madeByProvider(s) && (s.state === "rendering" || sending(s))).length;
    let localFree = job.shots.some((s) => !madeByProvider(s) && sending(s)) ? 0 : 1;
    for (const s of job.shots) {
      if (s.state !== "queued" || sending(s)) continue;
      if (madeByProvider(s) ? free <= 0 : localFree <= 0) continue;
      actions.push({ kind: "submit-shot", index: s.index });
      if (madeByProvider(s)) free--;
      else localFree--;
    }
  } else if (phase === "assemble") {
    add({ kind: "assemble" });
  }
  return actions;
}

/**
 * After each step: a running job whose shots can no longer all finish
 * (one failed, nothing left in line or with the provider) becomes failed;
 * a job with its final video is done.
 */
export function settle(job: VideoJob): VideoJob {
  if (job.final && job.status !== "done")
    return { ...job, status: "done", assembleProgress: undefined };
  if (job.status !== "running") return job;
  // Test video: once voice and stills exist and nothing expensive has started, wait.
  if (
    job.pause &&
    !job.reviewed &&
    jobPhase(job) === "shots" &&
    job.shots.every((s) => s.state === "queued")
  ) {
    return { ...job, status: "review" };
  }
  const failedFrame = job.frames.find((f) => !f.file && !f.requestId && f.error);
  if (failedFrame) return { ...job, status: "failed", error: failedFrame.error };
  const failed = job.shots.filter((s) => s.state === "failed");
  const open = job.shots.some((s) => s.state === "queued" || s.state === "rendering");
  if (failed.length && !open) return { ...job, status: "failed" };
  return job;
}

/**
 * On app start: a job that was running continues; queued jobs keep waiting.
 * Nothing is reset, so saved request ids are polled rather than resubmitted.
 * Jobs never auto-start from "idle".
 */
export const resumesOnStart = (job: VideoJob) =>
  job.status === "running" ||
  job.status === "waiting" ||
  job.shots.some((s) => s.state === "rendering" && s.requestId) ||
  job.frames.some((f) => !f.file && f.requestId);

// ---------------------------------------------------------------------------
// Network trouble (src/shared/net-error.ts)
// ---------------------------------------------------------------------------

/**
 * A step could not reach the provider. Nothing about the step changes: no
 * attempt is counted, no fallback, saved request ids stay. The job waits a
 * little longer after each failure in a row and then tries again by itself.
 */
export function wentOffline(job: VideoJob, message: string, nowMs: number): VideoJob {
  // Steps running side by side fail together: one round of failures is one try.
  if (waitingForNetwork(job, nowMs)) return job;
  const tries = (job.offline?.tries ?? 0) + 1;
  return {
    ...job,
    offline: {
      since: job.offline?.since ?? new Date(nowMs).toISOString(),
      tries,
      retryAt: new Date(nowMs + retryDelayMs(tries)).toISOString(),
      error: message,
    },
  };
}

/** Experiment branch: the still is one of the live plan's keyframes, still on its planned model. */
export const plannedFrame = (job: Pick<VideoJob, "live">, frame: JobFrame) =>
  Boolean(job.live && frame.keyframe && !frame.fallback);

/**
 * A still's attempt failed (nothing charged). The first failure tries again;
 * the second fails it, except a planned keyframe, which falls back to the
 * fixed request with the default image model (decision 9).
 */
export function frameAttemptFailed(
  job: Pick<VideoJob, "live">,
  frame: JobFrame,
  message: string,
): JobFrame {
  const reset = { ...frame, requestId: undefined, submittedAt: undefined, resultUrl: undefined };
  if (!frame.retried) return { ...reset, retried: true, error: undefined };
  if (plannedFrame(job, frame)) {
    return { ...reset, fallback: true, endpoint: undefined, retried: false, error: undefined };
  }
  return { ...reset, error: message };
}

export type JobStep = { frame: string } | { shot: number };

/** The provider reported that a still or shot failed: always an attempt. */
export function stepReportedFailure(job: VideoJob, step: JobStep, message: string): VideoJob {
  if ("frame" in step) {
    return {
      ...job,
      frames: job.frames.map((f) =>
        f.id === step.frame ? frameAttemptFailed(job, f, message) : f,
      ),
    };
  }
  return {
    ...job,
    shots: job.shots.map((s) => (s.index === step.shot ? shotAttemptFailed(job, s, message) : s)),
  };
}

/**
 * Sending a still or shot threw. Network trouble is not an attempt: the job
 * waits and sends it again, so two lost connections never cause a fallback.
 * Anything else (a refused request, a missing file) counts.
 */
export function stepThrew(job: VideoJob, step: JobStep, error: unknown, nowMs: number): VideoJob {
  const message = error instanceof Error ? error.message : String(error);
  if (isNetworkError(error)) return wentOffline(job, message, nowMs);
  return stepReportedFailure(job, step, message);
}

/** A step reached the provider again. */
export function backOnline(job: VideoJob): VideoJob {
  if (!job.offline) return job;
  const { offline: _, ...rest } = job;
  return rest;
}

/** Waiting for the next try after network trouble: no step starts before `retryAt`. */
export const waitingForNetwork = (job: VideoJob, nowMs: number) =>
  Boolean(job.offline && nowMs < Date.parse(job.offline.retryAt));

/** Try again now (the operator asked): keeps the offline mark until a step gets through. */
export const retryNetworkNow = (job: VideoJob, nowMs: number): VideoJob =>
  job.offline
    ? { ...job, offline: { ...job.offline, retryAt: new Date(nowMs).toISOString() } }
    : job;

/**
 * Jobs that failed on network trouble before it was told apart (the first live
 * run, 14 Nov): every still or shot that "failed" or "fell back" only because
 * the connection was gone goes back to its planned model, untried. Paid
 * results (files and saved request ids) are never touched. `cutoutsLeft`
 * says how many cut-outs a product still has untried: a product still shown
 * as its photo because the cut-out never ran is made again.
 */
export function repairNetworkFailure(
  job: VideoJob,
  cutoutsLeft: (productId: string) => number,
): VideoJob {
  if (job.status === "done" || job.status === "running" || job.status === "waiting") return job;
  const network = isNetworkMessage(job.error);
  let changed = false;
  const frames = job.frames.map((f) => {
    if (!f.file && !f.requestId && f.error && isNetworkMessage(f.error)) {
      changed = true;
      const { error: _, ...rest } = f;
      return { ...rest, retried: false, fallback: undefined };
    }
    // The cut-out never ran (it would be recorded on the product): the photo was a stopgap.
    if (
      network &&
      f.kind === "product" &&
      f.noCutout &&
      f.source === "photo" &&
      !f.requestId &&
      job.useEnvironment &&
      f.productId &&
      cutoutsLeft(f.productId) > 0
    ) {
      changed = true;
      const { file: _f, source: _s, noCutout: _n, ...rest } = f;
      return { ...rest, retried: false };
    }
    return f;
  });
  const shots = job.shots.map((s) => {
    if (s.state === "failed" && isNetworkMessage(s.error)) {
      changed = true;
      return {
        ...s,
        state: hasInput(s) ? ("queued" as const) : ("planned" as const),
        retried: false,
        error: undefined,
        fallback: undefined,
      };
    }
    return s;
  });
  return changed ? { ...job, frames, shots } : job;
}

/** Of all jobs, the one to run now: the running one, else the earliest waiting. */
export function pickNext(jobs: VideoJob[]): VideoJob | null {
  const running = jobs.find((j) => j.status === "running");
  if (running) return running;
  // A stopped job's shots still with the provider count against the limit: wait for them.
  if (jobs.some((j) => j.shots.some((s) => s.state === "rendering"))) return null;
  const waiting = jobs
    .filter((j) => j.status === "waiting")
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  return waiting[0] ?? null;
}

// ---------------------------------------------------------------------------
// Time left (rough, from per-step averages)
// ---------------------------------------------------------------------------

export interface StepAverages {
  /** Seconds for the shot plan (the user's own AI). */
  plan: number;
  /** Seconds per whole voice request. */
  voice: number;
  /** Seconds per start frame (frames run in parallel). */
  frame: number;
  /** Seconds per speaking shot, submit to downloaded. */
  shot: number;
  /** Seconds per assembly. */
  assemble: number;
}

export function remainingSec(job: VideoJob, avg: StepAverages, nowMs: number): number {
  const phase = jobPhase(job);
  const since = (iso?: string) => (iso ? Math.max(0, (nowMs - Date.parse(iso)) / 1000) : 0);
  const notDone = job.shots.filter((s) => s.state !== "done");
  const waves = (n: number) => Math.ceil(n / SHOTS_IN_FLIGHT) * avg.shot;
  let left = avg.assemble;
  if (phase === "plan") {
    left += Math.max(0, avg.plan - since(job.phaseStartedAt));
    left += avg.voice + (framesToMake(job).length || job.useEnvironment ? 2 * avg.frame : 0);
    left += waves(Math.max(notDone.length, job.lines.length));
  } else if (phase === "voice") {
    left += Math.max(0, avg.voice - since(job.phaseStartedAt));
    // The wide still first, then the rest in parallel.
    left += framesToMake(job).length ? 2 * avg.frame : 0;
    left += waves(notDone.length);
  } else if (phase === "frames") {
    left += Math.max(0, avg.frame - since(job.phaseStartedAt));
    left += waves(notDone.length);
  } else if (phase === "shots") {
    const rendering = job.shots.filter((s) => s.state === "rendering");
    const longest = rendering.length
      ? Math.max(...rendering.map((s) => Math.max(10, avg.shot - since(s.submittedAt))))
      : 0;
    const queued = notDone.filter((s) => s.state === "queued").length;
    left += longest + waves(queued);
  } else if (phase === "assemble") {
    left = avg.assemble * (1 - (job.assembleProgress ?? 0));
  } else {
    left = 0;
  }
  return Math.max(0, left);
}

/** Running average that moves a fifth of the way toward each new measurement. */
export const nextAverage = (current: number, measured: number) =>
  current + (measured - current) / 5;

// ---------------------------------------------------------------------------
// Line timings
// ---------------------------------------------------------------------------

/**
 * Where to cut the whole dialogue into lines. `segments` are the provider's
 * per-line spans (seconds). Each cut keeps a little silence around its line
 * without reaching into the neighbours: a cut never passes the midpoint of
 * the gap to the next line, so no syllable is clipped or duplicated.
 */
export function lineCuts(
  segments: { start: number; end: number }[],
  totalSec: number,
  pad = LINE_PAD_SEC,
): { start: number; end: number }[] {
  return segments.map((seg, i) => {
    const prev = segments[i - 1];
    const next = segments[i + 1];
    const lo = prev ? (prev.end + seg.start) / 2 : 0;
    const hi = next ? (seg.end + next.start) / 2 : totalSec;
    const start = Math.max(lo, seg.start - pad, 0);
    const end = Math.min(hi, seg.end + pad, totalSec);
    return { start: round3(start), end: round3(Math.max(end, start)) };
  });
}

/**
 * Per-line spans from the provider's voice segments: a line may arrive as
 * several segments; take the earliest start and latest end per line.
 */
export function lineSpans(
  segments: { dialogueInputIndex: number; startTimeSeconds: number; endTimeSeconds: number }[],
  lineCount: number,
): { start: number; end: number }[] | null {
  const spans: { start: number; end: number }[] = [];
  for (let i = 0; i < lineCount; i++) {
    const mine = segments.filter((s) => s.dialogueInputIndex === i);
    if (!mine.length) return null;
    spans.push({
      start: Math.min(...mine.map((s) => s.startTimeSeconds)),
      end: Math.max(...mine.map((s) => s.endTimeSeconds)),
    });
  }
  return spans;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
