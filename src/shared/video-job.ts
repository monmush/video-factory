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
  type PlannedRoute,
  plannedShotSec,
  ROUTE_LABEL,
  type Route,
  requestCost,
  SHORTEST_AUDIO_A_SPEAKING_SHOT_IS_GIVEN_SEC,
} from "./live-plan";
import { mediaLevel } from "./media-level";
import { isNetworkError, MAX_BUSY_ANSWERS, providerBusy, retryDelayMs } from "./net-error";
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

export const MIN_SHOT_SEC = SHORTEST_AUDIO_A_SPEAKING_SHOT_IS_GIVEN_SEC;
const SILENCE_KEPT_AROUND_EACH_LINE_SEC = 0.12;

export type ShotState = "planned" | "queued" | "rendering" | "done" | "failed" | "stopped";

export const madeByProvider = (shot: Pick<JobShot, "kind" | "route" | "fallback">) =>
  shot.route
    ? shot.route === "lip-sync" || (shot.route === "motion" && !shot.fallback)
    : shot.kind === "speaker" || shot.kind === "listener";

export interface JobShot {
  index: number;
  route?: Route;
  keyframe?: string;
  endpoint?: string;
  fallback?: boolean;
  kind: ShotKind;
  framing: Framing | null;
  lineIndex: number;
  characterId: string | null;
  speaker: string;
  text: string;
  visual: string;
  productId: string | null;
  hold?: number;
  brief?: string;
  start?: number;
  end?: number;
  state: ShotState;
  audio?: string;
  audioSec?: number;
  model?: string;
  requestId?: string;
  submittedAt?: string;
  sending?: string;
  clip?: string;
  clipSec?: number;
  resultUrl?: string;
  costUsd?: number | null;
  busyAnswers?: number;
  retried: boolean;
  failures: number;
  error?: string;
}

export type FrameKind = "wide" | "character" | "detail" | "product";

export interface JobFrame {
  id: string;
  keyframe?: string;
  framing?: string;
  people?: number;
  endpoint?: string;
  fallback?: boolean;
  kind: FrameKind;
  characterId?: string;
  shot?: number;
  productId?: string;
  file?: string;
  source?: "generated" | "cover" | "photo" | "look";
  note?: string;
  plate?: string;
  cutout?: string;
  noCutout?: boolean;
  cutouts?: number;
  requestId?: string;
  submittedAt?: string;
  sending?: string;
  resultUrl?: string;
  costUsd?: number | null;
  busyAnswers?: number;
  retried: boolean;
  redone?: boolean;
  check?: string;
  error?: string;
}

export type JobStatus = "idle" | "waiting" | "running" | "stopped" | "failed" | "review" | "done";

export type JobPhase = "plan" | "voice" | "frames" | "shots" | "assemble" | "done";

export interface VideoJob {
  version: 2;
  sessionId: string;
  scriptId: string;
  seriesId: string;
  status: JobStatus;
  queuedAt: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  lines: ScriptLine[];
  plan?: ShotPlan;
  live?: LiveDirection;
  level?: string;
  planning?: boolean;
  planningSteps?: string[];
  direction?: DirectionEntry[];
  productIds?: string[];
  dialogue?: string;
  dialogueSec?: number;
  voiceCostUsd?: number;
  voiceChars?: number;
  lineSpans?: { start: number; end: number }[];
  useEnvironment: boolean;
  model?: string;
  ownModel?: string;
  modelLocked?: boolean;
  resolution?: string;
  frames: JobFrame[];
  shots: JobShot[];
  assembleProgress?: number;
  final?: string;
  finalSec?: number;
  error?: string;
  offline?: { since: string; tries: number; retryAt: string; error: string };
  phaseStartedAt?: string;
  pause?: boolean;
  reviewed?: boolean;
  rev?: number;
  cutRev?: number;
  previous?: JobCut;
  pastCostUsd?: number;
  takes?: JobTake[];
  chosen?: string;
  takeOrder?: string[];
  takeLedger?: TakeLedger;
}

export interface TakeLedger {
  shared: number;
  spent: Record<string, number>;
  since: number;
  unknown?: boolean;
}

export interface JobTake {
  model: string;
  resolution?: string;
  status: JobStatus;
  cut: JobCut;
  previous?: JobCut;
}

export interface JobCut {
  plan?: ShotPlan;
  dialogue?: string;
  dialogueSec?: number;
  voiceCostUsd?: number;
  voiceChars?: number;
  lineSpans?: { start: number; end: number }[];
  frames: JobFrame[];
  shots: JobShot[];
  routes?: PlannedRoute[];
  final?: string;
  finalSec?: number;
  cutRev?: number;
}

export const revFile = (job: Pick<VideoJob, "rev">, base: string, ext: string) =>
  job.rev ? `${base}-r${job.rev}.${ext}` : `${base}.${ext}`;

export const spokenLines = (lines: ScriptLine[]) =>
  lines.filter((l) => l.characterId && l.text.trim());

export function newJob(input: {
  sessionId: string;
  seriesId: string;
  scriptId: string;
  title: string;
  lines: ScriptLine[];
  useEnvironment: boolean;
  model?: string;
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

const KEYFRAME_FRAME: Record<string, FrameKind> = {
  master: "wide",
  character: "character",
  action: "detail",
  plate: "product",
};

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
      ...(k.people ? { people: k.people } : {}),
      retried: false,
      ...(k.characterId ? { characterId: k.characterId } : {}),
      ...(first ? { shot: first.index } : {}),
      ...(kind === "product" && product?.productId ? { productId: product.productId } : {}),
    };
  });
  for (const f of frames) if (f.kind === "product" && !f.productId) f.kind = "detail";
  for (const s of shots) {
    if (!s.keyframe && s.productId) {
      const fixed = base.frames.find((f) => f.id === frameIdFor(s));
      if (fixed && !frames.some((f) => f.id === fixed.id)) frames.push(fixed);
    }
  }
  return { ...base, live, shots, frames };
}

export const frameDeps = (job: Pick<VideoJob, "live">, frame: JobFrame): string[] =>
  job.live && frame.keyframe && !frame.fallback
    ? keyframeDeps(job.live, frame.keyframe).map((id) => `kf:${id}`)
    : [];

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

function shotSeconds(shot: JobShot): number {
  if (shot.start !== undefined && shot.end !== undefined) return shot.end - shot.start;
  return syllables([shot]) / SPEECH_RATE + 2 * SILENCE_KEPT_AROUND_EACH_LINE_SEC + (shot.hold ?? 0);
}

export const holdsSec = (shots: Pick<JobShot, "hold">[]) =>
  shots.reduce((n, s) => n + (s.hold ?? 0), 0);

export function billedSeconds(shot: JobShot): number {
  if (!madeByProvider(shot)) return 0;
  if (shot.clipSec) return shot.clipSec;
  if (shot.audioSec) return Math.max(MIN_SHOT_SEC, shot.audioSec);
  return Math.max(MIN_SHOT_SEC, shotSeconds(shot));
}

export function shotModel(job: Pick<VideoJob, "model">, shot: JobShot): VideoModel {
  if (shot.requestId || shot.state === "rendering" || shot.state === "done") {
    return videoModel(shot.model);
  }
  return modelForClip(job.model, billedSeconds(shot));
}

export function liveSeconds(shot: JobShot): number {
  if (shot.route === "lip-sync" && shot.audioSec) return shot.audioSec;
  if (shot.start !== undefined && shot.end !== undefined) return shot.end - shot.start;
  return plannedShotSec(shot);
}

export const shotEstimateUsd = (
  job: Pick<VideoJob, "model" | "resolution" | "live">,
  shot: JobShot,
): number | null => {
  if (!madeByProvider(shot)) return 0;
  if (job.live && shot.route && !shot.fallback) {
    return liveShotUsd(job.live, shot.index, liveSeconds(shot));
  }
  return clipUsd(shotModel(job, shot), billedSeconds(shot), job.resolution);
};

export const frameUsd = (job: Pick<VideoJob, "live">, frame: JobFrame): number | null =>
  job.live && frame.keyframe && !frame.fallback
    ? liveFrameUsd(job.live, frame.keyframe)
    : FRAME_USD;

export const addUsd = (a: number | null | undefined, b: number | null): number | null =>
  a === null || b === null ? null : (a ?? 0) + b;

const orZero = (usd: number | null | undefined) => usd ?? 0;

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

export function followBatch(job: VideoJob, batch: { model: string; resolution: string }): VideoJob {
  if (modelLocked(job) || job.live) return job;
  const model = videoModel(job.ownModel ?? batch.model).id;
  return { ...job, model, resolution: fitResolution(model, batch.resolution) };
}

export const cutCostUsd = (cut: Pick<JobCut, "voiceCostUsd" | "frames" | "shots">) =>
  (cut.voiceCostUsd ?? 0) +
  cut.frames.reduce((n, f) => n + (f.costUsd ?? 0), 0) +
  cut.shots.reduce((n, s) => n + (s.costUsd ?? 0), 0);

export const spentUsd = (job: VideoJob) => cutCostUsd(job) + (job.pastCostUsd ?? 0);

export const isGenerated = (job: Pick<VideoJob, "useEnvironment">, frame: JobFrame) =>
  job.useEnvironment && (frame.kind !== "product" || (!frame.noCutout && frame.source !== "photo"));

const cutoutsToMakeUsd = (job: VideoJob) =>
  job.frames
    .filter((f) => f.kind === "product" && !f.file && !f.cutout && isGenerated(job, f))
    .reduce((n, f) => n + (f.cutouts ?? 0) * CUTOUT_USD, 0);

const framesToMake = (job: VideoJob) => job.frames.filter((f) => !f.file && isGenerated(job, f));

export function lossIfStoppedUsd(job: VideoJob): number {
  return (
    spentUsd(job) +
    job.shots
      .filter((s) => s.state === "rendering" && !s.resultUrl)
      .reduce((n, s) => n + orZero(shotEstimateUsd(job, s)), 0) +
    framesToMake(job)
      .filter((f) => f.requestId && !f.resultUrl)
      .reduce((n, f) => n + orZero(frameUsd(job, f)), 0)
  );
}

const makeButtonEstimateUsd = (job: VideoJob) =>
  estimateUsd(job.lines, {
    frames: job.useEnvironment,
    model: job.model,
    resolution: job.resolution,
    level: job.level,
  });

export function costToFinishUsd(job: VideoJob): number {
  if (!job.plan) return makeButtonEstimateUsd(job);
  const voice = job.dialogue ? 0 : estimateVoiceUsd(job.lines);
  const frames =
    framesToMake(job)
      .filter((f) => !f.requestId)
      .reduce((n, f) => n + orZero(frameUsd(job, f)), 0) + cutoutsToMakeUsd(job);
  const shots = job.shots
    .filter((s) => s.state !== "done" && s.state !== "rendering")
    .reduce((n, s) => n + orZero(shotEstimateUsd(job, s)), 0);
  return voice + frames + shots;
}

const previewStillToMake = (job: VideoJob) => !job.dialogue || job.frames.some((f) => !f.file);

export const stopsForPreview = (job: VideoJob) =>
  Boolean(
    job.plan &&
      job.pause &&
      !job.reviewed &&
      job.status !== "review" &&
      previewStillToMake(job) &&
      job.shots.every((s) => s.state === "queued" || s.state === "planned"),
  );

export function costToPreviewUsd(job: VideoJob): number {
  if (!job.plan) return costToFinishUsd(job);
  const voice = job.dialogue ? 0 : estimateVoiceUsd(job.lines);
  return (
    voice +
    framesToMake(job)
      .filter((f) => !f.requestId)
      .reduce((n, f) => n + orZero(frameUsd(job, f)), 0) +
    cutoutsToMakeUsd(job)
  );
}

const paidUsd = (usd: number | null | undefined) => (usd === undefined ? 0 : usd);

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
      step: f.kind === "product" && !planned ? "Ảnh sản phẩm" : `Khung hình ${f.keyframe ?? f.id}`,
      model: planned ? modelName(live.schemas, k.endpoint) : null,
      quantity: isGenerated(job, f) ? "1 ảnh" : "",
      usd: made ? paidUsd(f.costUsd) : estimate,
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
        usd: made ? paidUsd(shot.costUsd) : cost.usd,
        paid: made,
      });
    } else {
      rows.push({
        step,
        model: shotModel(job, shot).name,
        quantity: `${Math.round(billedSeconds(shot) * 10) / 10} giây`,
        usd: made ? paidUsd(shot.costUsd) : shotEstimateUsd(job, shot),
        paid: made,
      });
    }
  }
  if (job.pastCostUsd)
    rows.push({ step: "Làm lại", model: null, quantity: "", usd: job.pastCostUsd, paid: true });
  return {
    rows,
    knownUsd: rows.reduce((n, r) => n + (r.usd ?? 0), 0),
    unknownSteps: rows.filter((r) => r.usd === null).length,
    budgetUsd: levelEstimateUsd(mediaLevel(job.level), estimateSeconds(job.lines)),
    seconds: job.shots.reduce((n, sh) => n + liveSeconds(sh), 0),
  };
}

export const totalEstimateUsd = (job: VideoJob) => lossIfStoppedUsd(job) + costToFinishUsd(job);

export const doneShots = (job: VideoJob) => job.shots.filter((s) => s.state === "done").length;

function legacyJobModel<T extends Pick<VideoJob, "model" | "resolution">>(job: T): T {
  const legacy = legacyModel(job.model);
  return legacy
    ? { ...job, model: legacy.id, resolution: job.resolution ?? legacy.resolution }
    : job;
}

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

export function resumeJob(job: VideoJob, now: string): VideoJob {
  if (job.status === "running" || job.status === "waiting" || job.status === "done") return job;
  const continuingFromPauseApprovesExpensiveStep = job.status === "review";
  return {
    ...job,
    status: "waiting",
    reviewed: continuingFromPauseApprovesExpensiveStep || job.reviewed,
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

export function runThrough(job: VideoJob, now: string): VideoJob {
  if (job.status === "done") return job;
  return { ...resumeJob(job, now), reviewed: true };
}

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

export function shotFailed(shot: JobShot, message: string): JobShot {
  const base = {
    ...shot,
    requestId: undefined,
    submittedAt: undefined,
    sending: undefined,
    resultUrl: undefined,
    busyAnswers: undefined,
    failures: shot.failures + 1,
  };
  return shot.retried
    ? { ...base, state: "failed", error: message }
    : { ...base, state: "queued", retried: true, error: undefined };
}

export function shotAttemptFailed(
  job: Pick<VideoJob, "live">,
  shot: JobShot,
  message: string,
): JobShot {
  const next = { ...shotFailed(shot, message), endpoint: undefined };
  if (next.state !== "failed" || !job.live || !shot.route || shot.fallback) return next;
  return { ...next, state: "queued", fallback: true, retried: false, error: undefined };
}

export const hasInput = (s: JobShot) =>
  s.end !== undefined && (!madeByProvider(s) || Boolean(s.audio));

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

const paidRequestsInFlight = (job: VideoJob): JobAction[] => [
  ...job.frames
    .filter((f) => !f.file && f.requestId)
    .map((f): JobAction => ({ kind: "poll-frame", frame: f.id })),
  ...job.shots
    .filter((s) => s.state === "rendering" && s.requestId)
    .map((s): JobAction => ({ kind: "poll-shot", index: s.index })),
];

const keyframeSourcesMade = (job: VideoJob, f: JobFrame) =>
  frameDeps(job, f).every((id) => Boolean(job.frames.find((x) => x.id === id)?.file));

const drawnFromWideStill = (job: VideoJob, f: JobFrame) =>
  f.kind !== "wide" && (isGenerated(job, f) || f.kind === "product");

function wideStillReady(job: VideoJob): boolean {
  const wide = job.frames.find((f) => f.kind === "wide");
  return !wide || Boolean(wide.file) || !isGenerated(job, wide);
}

function framesToStart(job: VideoJob): JobAction[] {
  const wideReady = wideStillReady(job);
  return job.frames
    .filter((f) => !f.file && !f.requestId && !f.error)
    .filter((f) =>
      f.keyframe && !f.fallback
        ? keyframeSourcesMade(job, f)
        : wideReady || !drawnFromWideStill(job, f),
    )
    .map((f) => ({ kind: "frame", frame: f.id }));
}

const LOCAL_SHOTS_AT_A_TIME = 1;

function shotsToSubmit(job: VideoJob, busy: ReadonlySet<string>): JobAction[] {
  const sending = (s: JobShot) => busy.has(actionKey({ kind: "submit-shot", index: s.index }));
  let localSlots = Math.max(
    0,
    LOCAL_SHOTS_AT_A_TIME - job.shots.filter((s) => !madeByProvider(s) && sending(s)).length,
  );
  const actions: JobAction[] = [];
  for (const s of job.shots) {
    if (s.state !== "queued" || sending(s)) continue;
    if (!madeByProvider(s)) {
      if (localSlots <= 0) continue;
      localSlots--;
    }
    actions.push({ kind: "submit-shot", index: s.index });
  }
  return actions;
}

function stepsForPhase(job: VideoJob, busy: ReadonlySet<string>): JobAction[] {
  const phase = jobPhase(job);
  if (phase === "plan") return [{ kind: "plan" }];
  if (phase === "voice") return [{ kind: "voice" }];
  if (phase === "frames") return framesToStart(job);
  if (phase === "shots") return shotsToSubmit(job, busy);
  if (phase === "assemble") return [{ kind: "assemble" }];
  return [];
}

export function nextActions(job: VideoJob, busy: ReadonlySet<string>): JobAction[] {
  const notBusy = (a: JobAction) => !busy.has(actionKey(a));
  const polls = paidRequestsInFlight(job).filter(notBusy);
  if (job.status !== "running") return polls;
  return [...polls, ...stepsForPhase(job, busy).filter(notBusy)];
}

const testVideoReachedItsPause = (job: VideoJob) =>
  job.pause === true &&
  !job.reviewed &&
  jobPhase(job) === "shots" &&
  job.shots.every((s) => s.state === "queued");

export function settle(job: VideoJob): VideoJob {
  if (job.final && job.status !== "done")
    return { ...job, status: "done", assembleProgress: undefined };
  if (job.status !== "running") return job;
  if (testVideoReachedItsPause(job)) return { ...job, status: "review" };
  const failedFrame = job.frames.find((f) => !f.file && !f.requestId && f.error);
  if (failedFrame) return { ...job, status: "failed", error: failedFrame.error };
  const failed = job.shots.filter((s) => s.state === "failed");
  const open = job.shots.some((s) => s.state === "queued" || s.state === "rendering");
  if (failed.length && !open) return { ...job, status: "failed" };
  return job;
}

export const resumesOnStart = (job: VideoJob) =>
  job.status === "running" ||
  job.status === "waiting" ||
  job.shots.some((s) => s.state === "rendering" && s.requestId) ||
  job.frames.some((f) => !f.file && f.requestId);

export function wentOffline(job: VideoJob, message: string, nowMs: number): VideoJob {
  const failedInTheSameRoundAsAnotherStep = waitingForNetwork(job, nowMs);
  if (failedInTheSameRoundAsAnotherStep) return job;
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

export const plannedFrame = (job: Pick<VideoJob, "live">, frame: JobFrame) =>
  Boolean(job.live && frame.keyframe && !frame.fallback);

function frameAttemptFailed(
  job: Pick<VideoJob, "live">,
  frame: JobFrame,
  message: string,
): JobFrame {
  const reset = {
    ...frame,
    requestId: undefined,
    submittedAt: undefined,
    resultUrl: undefined,
    sending: undefined,
    busyAnswers: undefined,
  };
  if (!frame.retried) return { ...reset, retried: true, error: undefined };
  if (plannedFrame(job, frame)) {
    return { ...reset, fallback: true, endpoint: undefined, retried: false, error: undefined };
  }
  return { ...reset, error: message };
}

export type JobStep = { frame: string } | { shot: number };

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

export function stepThrew(job: VideoJob, step: JobStep, error: unknown, nowMs: number): VideoJob {
  const message = error instanceof Error ? error.message : String(error);
  if (providerBusy(error)) {
    const answers = busyAnswersOf(job, step) + 1;
    if (answers >= MAX_BUSY_ANSWERS) return stepReportedFailure(job, step, message);
    return wentOffline(withBusyAnswers(job, step, answers), message, nowMs);
  }
  if (isNetworkError(error)) return wentOffline(job, message, nowMs);
  return stepReportedFailure(job, step, message);
}

const busyAnswersOf = (job: VideoJob, step: JobStep) =>
  ("frame" in step
    ? job.frames.find((f) => f.id === step.frame)?.busyAnswers
    : job.shots.find((s) => s.index === step.shot)?.busyAnswers) ?? 0;

const withBusyAnswers = (job: VideoJob, step: JobStep, busyAnswers: number): VideoJob =>
  "frame" in step
    ? {
        ...job,
        frames: job.frames.map((f) => (f.id === step.frame ? { ...f, busyAnswers } : f)),
      }
    : {
        ...job,
        shots: job.shots.map((s) => (s.index === step.shot ? { ...s, busyAnswers } : s)),
      };

export function backOnline(job: VideoJob): VideoJob {
  if (!job.offline) return job;
  const { offline: _, ...rest } = job;
  return rest;
}

export const waitingForNetwork = (job: VideoJob, nowMs: number) =>
  Boolean(job.offline && nowMs < Date.parse(job.offline.retryAt));

export const retryNetworkNow = (job: VideoJob, nowMs: number): VideoJob =>
  job.offline
    ? { ...job, offline: { ...job.offline, retryAt: new Date(nowMs).toISOString() } }
    : job;

export function pickNext(jobs: VideoJob[]): VideoJob | null {
  const running = jobs.find((j) => j.status === "running");
  if (running) return running;
  const waiting = jobs
    .filter((j) => j.status === "waiting")
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  return waiting[0] ?? null;
}

export interface StepAverages {
  plan: number;
  voice: number;
  frame: number;
  shot: number;
  assemble: number;
}

const MIN_SEC_LEFT_FOR_A_RENDERING_SHOT = 10;
const MEASUREMENTS_IN_RUNNING_AVERAGE = 5;

export function remainingSec(job: VideoJob, avg: StepAverages, nowMs: number): number {
  const phase = jobPhase(job);
  const since = (iso?: string) => (iso ? Math.max(0, (nowMs - Date.parse(iso)) / 1000) : 0);
  const notDone = job.shots.filter((s) => s.state !== "done");
  const oneRoundForAllShots = (n: number) => (n > 0 ? avg.shot : 0);
  const wideStillThenTheRestTogether = 2 * avg.frame;
  let left = avg.assemble;
  if (phase === "plan") {
    left += Math.max(0, avg.plan - since(job.phaseStartedAt));
    left +=
      avg.voice +
      (framesToMake(job).length || job.useEnvironment ? wideStillThenTheRestTogether : 0);
    left += oneRoundForAllShots(Math.max(notDone.length, job.lines.length));
  } else if (phase === "voice") {
    left += Math.max(0, avg.voice - since(job.phaseStartedAt));
    left += framesToMake(job).length ? wideStillThenTheRestTogether : 0;
    left += oneRoundForAllShots(notDone.length);
  } else if (phase === "frames") {
    left += Math.max(0, avg.frame - since(job.phaseStartedAt));
    left += oneRoundForAllShots(notDone.length);
  } else if (phase === "shots") {
    const rendering = job.shots.filter((s) => s.state === "rendering");
    const longest = rendering.length
      ? Math.max(
          ...rendering.map((s) =>
            Math.max(MIN_SEC_LEFT_FOR_A_RENDERING_SHOT, avg.shot - since(s.submittedAt)),
          ),
        )
      : 0;
    const queued = notDone.filter((s) => s.state === "queued").length;
    left += Math.max(longest, oneRoundForAllShots(queued));
  } else if (phase === "assemble") {
    left = avg.assemble * (1 - (job.assembleProgress ?? 0));
  } else {
    left = 0;
  }
  return Math.max(0, left);
}

export const nextAverage = (current: number, measured: number) =>
  current + (measured - current) / MEASUREMENTS_IN_RUNNING_AVERAGE;

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
