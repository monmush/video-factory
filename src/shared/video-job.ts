import type { Charge } from "./cost/charges";
import type { FirstPass } from "./cost/estimate";
import type { DirectionEntry } from "./direction";
import type { ScriptLine } from "./ipc";
import {
  keyframeDeps,
  type LiveDirection,
  type PlannedRoute,
  plannedShotSec,
  type Route,
} from "./live-plan";
import {
  frameMishapsFromCounters,
  type Mishap,
  type MishapKind,
  mishapOfError,
  mishapOfMessage,
  segmentMishapsFromCounters,
  shotMishapsFromCounters,
  stillProblemMishaps,
  withMishaps,
  withMishapsFromCounters,
} from "./mishaps";
import { AUTO_MODELS, type JobModels, resolvedModels, type SeriesModels } from "./models";
import { isNetworkError, MAX_BUSY_ANSWERS, providerBusy, retryDelayMs } from "./net-error";
import { PACE_OF_VIDEOS_MADE_BEFORE_PACES } from "./pace";
import type { RestageBasis } from "./restage";
import type { Reworded, RewordedFrom } from "./reworded";
import type { Framing, ShotKind, ShotPlan } from "./shot-plan";
import {
  type CueShot,
  type JobSound,
  type SoundCue,
  soundAttemptFailed,
  soundCues,
  soundInFlight,
  soundSource,
  soundsSettled,
  soundToSend,
  soundWithdrawn,
  withAsks,
} from "./sound";
import {
  cutOffAskedAgainLonger,
  type JobSegment,
  type SpeechBounds,
  segmentAttemptFailed,
  segmentCutOff,
  segmentKept,
  segmentOpen,
  segmentTriedAfresh,
  segmentWithdrawn,
  speechSegments,
  withSegments,
} from "./speech";
import type { Tempo } from "./tempo";
import { type VideoModel, videoModel } from "./video-models";
import {
  type JobVoice,
  voiceAttemptFailed,
  voiceFailed,
  voiceInFlight,
  voiceReady,
  voiceRetried,
  voicesToRecord,
  voiceToSend,
  voiceWithdrawn,
} from "./voice-step";

export type ShotState = "planned" | "queued" | "rendering" | "done" | "failed" | "stopped";

export const madeByProvider = (shot: Pick<JobShot, "kind" | "route" | "fallback" | "speech">) =>
  !shot.speech &&
  !shot.fallback &&
  (shot.route
    ? shot.route === "motion" || shot.route === "lip-sync"
    : shot.kind === "speaker" || shot.kind === "listener");

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
  sound?: string;
  speech?: string;
  cutFrom?: number;
  start?: number;
  end?: number;
  state: ShotState;
  requestId?: string;
  submittedAt?: string;
  sending?: string;
  clip?: string;
  clipSec?: number;
  resultUrl?: string;
  costUsd?: number | null;
  costBilled?: boolean;
  busyAnswers?: number;
  retried: boolean;
  failures: number;
  autoRedos?: number;
  rejectedClips?: number;
  materialClip?: { id: string; file: string; seconds: number };
  reused?: string;
  mishaps?: Mishap[];
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
  source?: "generated" | "cover" | "photo" | "look" | "material";
  material?: string;
  materialFile?: string;
  fresh?: boolean;
  note?: string;
  plate?: string;
  cutout?: string;
  noCutout?: boolean;
  cutouts?: number;
  cutoutCostUsd?: number;
  cutoutBilled?: boolean;
  requestId?: string;
  submittedAt?: string;
  sending?: string;
  resultUrl?: string;
  costUsd?: number | null;
  costBilled?: boolean;
  busyAnswers?: number;
  retried: boolean;
  redone?: boolean;
  check?: string;
  mishaps?: Mishap[];
  error?: string;
}

export type JobStatus = "idle" | "waiting" | "running" | "stopped" | "failed" | "review" | "done";

export type JobPhase = "plan" | "voice" | "frames" | "speech" | "shots" | "assemble" | "done";

export type TimedPhase = Exclude<JobPhase, "done">;

export const JOB_VERSION = 3;

export interface VideoJob {
  version: typeof JOB_VERSION;
  sessionId: string;
  scriptId: string;
  seriesId: string;
  status: JobStatus;
  queuedAt: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  lines: ScriptLine[];
  pace?: number;
  plan?: ShotPlan;
  live?: LiveDirection;
  models?: JobModels;
  modelsKept?: true;
  voices?: JobVoice[];
  voicesKept?: true;
  dubbed?: true;
  oldFiles?: true;
  segments?: JobSegment[];
  planning?: boolean;
  planningSteps?: string[];
  restageFrom?: RestageBasis;
  rewordedFrom?: RewordedFrom;
  reworded?: Reworded;
  direction?: DirectionEntry[];
  stagedDirection?: DirectionEntry[];
  productIds?: string[];
  dialogue?: string;
  dialogueSec?: number;
  voiceCostUsd?: number;
  voiceChars?: number;
  lineSpans?: { start: number; end: number }[];
  useEnvironment: boolean;
  frames: JobFrame[];
  shots: JobShot[];
  sounds?: JobSound[];
  soundSource?: string;
  assembleProgress?: number;
  final?: string;
  finalSec?: number;
  tempo?: Tempo;
  error?: string;
  offline?: { since: string; tries: number; retryAt: string; error: string };
  phaseStartedAt?: string;
  phaseSec?: Partial<Record<TimedPhase, number>>;
  clockAt?: string;
  pause?: boolean;
  reviewed?: boolean;
  rev?: number;
  cutRev?: number;
  previous?: JobCut;
  charges?: Charge[];
  firstPass?: FirstPass;
  pastCostUsd?: number;
  autoRedos?: number;
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
  sounds?: JobSound[];
  segments?: JobSegment[];
  voices?: JobVoice[];
  routes?: PlannedRoute[];
  final?: string;
  finalSec?: number;
  cutRev?: number;
  firstPass?: FirstPass;
}

export const cutOf = (job: Omit<VideoJob, "version">): JobCut => ({
  plan: job.plan,
  dialogue: job.dialogue,
  dialogueSec: job.dialogueSec,
  voiceCostUsd: job.voiceCostUsd,
  voiceChars: job.voiceChars,
  lineSpans: job.lineSpans,
  frames: job.frames,
  shots: job.shots,
  ...(job.sounds ? { sounds: job.sounds } : {}),
  ...(job.segments ? { segments: job.segments } : {}),
  ...(job.live ? { routes: job.live.plan.routes } : {}),
  final: job.final,
  finalSec: job.finalSec,
  cutRev: job.cutRev,
  ...(job.firstPass ? { firstPass: job.firstPass } : {}),
});

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
  pace?: number;
  useEnvironment: boolean;
  models: JobModels;
  now: string;
}): VideoJob {
  return {
    version: JOB_VERSION,
    sessionId: input.sessionId,
    seriesId: input.seriesId,
    scriptId: input.scriptId,
    title: input.title,
    status: "waiting",
    queuedAt: input.now,
    createdAt: input.now,
    updatedAt: input.now,
    lines: spokenLines(input.lines).map((l) => ({ ...l, text: l.text.trim() })),
    ...(input.pace === undefined ? {} : { pace: input.pace }),
    useEnvironment: input.useEnvironment,
    models: input.models,
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
    ...(p.sound ? { sound: p.sound } : {}),
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
      ...(k.material ? { material: k.material } : {}),
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

export const modelsOf = (job: Pick<VideoJob, "models">): JobModels => job.models ?? AUTO_MODELS;

export const videoModelOf = (job: Pick<VideoJob, "models">): VideoModel =>
  videoModel(modelsOf(job).video);

const sameModels = (a: JobModels | undefined, b: JobModels) =>
  a?.image === b.image && a?.video === b.video;

export function followSeriesModels(job: VideoJob, picked: SeriesModels | undefined): VideoJob {
  if (job.modelsKept || job.dubbed) return job;
  const models = resolvedModels(picked);
  return sameModels(job.models, models) ? job : { ...job, models };
}

export function keepModels(job: VideoJob, picked: SeriesModels | undefined): VideoJob {
  if (job.modelsKept || job.dubbed) return job;
  return { ...followSeriesModels(job, picked), modelsKept: true };
}

function pictureOfSpeaker(job: VideoJob, characterId: string): string | null {
  const own = job.frames.find((f) => f.kind === "character" && f.characterId === characterId);
  const wide = job.frames.find((f) => f.kind === "wide");
  const anyone = job.frames.find((f) => f.kind === "character");
  return (own ?? wide ?? anyone)?.id ?? null;
}

const withoutSpeechMark = (shot: JobShot): JobShot => {
  const { speech: _, cutFrom: __, ...rest } = shot;
  return rest;
};

export function withSpeech(job: VideoJob): VideoJob {
  if (!job.plan) return job;
  const planned = speechSegments(
    job.lines,
    job.shots,
    frameIdFor,
    (id) => pictureOfSpeaker(job, id),
    job.pace,
  );
  const segments = withSegments(job.segments, planned);
  return {
    ...job,
    segments,
    shots: job.shots.map((shot) => {
      const own = segments.find((g) => g.speakerShot === shot.index);
      if (!own) return shot.speech ? withoutSpeechMark(shot) : shot;
      return shot.speech === own.id ? shot : { ...shot, speech: own.id };
    }),
  };
}

const segmentSent = (s: JobSegment) => Boolean(s.requestId || s.sending || s.state !== "queued");

export const speechSent = (job: Pick<VideoJob, "segments">) =>
  (job.segments ?? []).some(segmentSent);

export const jobPace = (job: Pick<VideoJob, "pace">) =>
  job.pace ?? PACE_OF_VIDEOS_MADE_BEFORE_PACES;

export function repaced(job: VideoJob, pace: number): VideoJob {
  if (job.pace === undefined || job.pace === pace || speechSent(job)) return job;
  return withSpeech({ ...job, pace });
}

export const segmentAnchor = (s: Pick<JobSegment, "speakerShot" | "shots">) =>
  s.speakerShot ?? s.shots[0] ?? 0;

export const speechMade = (job: Pick<VideoJob, "segments">) =>
  (job.segments ?? []).every((s) => s.state === "done");

export function jobPhase(job: VideoJob): JobPhase {
  if (!job.plan) return "plan";
  if (job.frames.some((f) => !f.file)) return "frames";
  if (!speechMade(job)) return "speech";
  if (!job.dialogue || job.shots.some((s) => s.end === undefined)) return "voice";
  if (job.shots.some((s) => s.state !== "done")) return "shots";
  if (!job.final) return "assemble";
  return "done";
}

export const holdsSec = (shots: Pick<JobShot, "hold">[]) =>
  shots.reduce((n, s) => n + (s.hold ?? 0), 0);

export function liveSeconds(job: Pick<VideoJob, "pace">, shot: JobShot): number {
  if (shot.start !== undefined && shot.end !== undefined) return shot.end - shot.start;
  return plannedShotSec(shot, jobPace(job));
}

export const isGenerated = (job: Pick<VideoJob, "useEnvironment">, frame: JobFrame) =>
  job.useEnvironment && (frame.kind !== "product" || (!frame.noCutout && frame.source !== "photo"));

const soundTotalSec = (job: VideoJob) =>
  job.dialogueSec !== undefined
    ? job.dialogueSec + holdsSec(job.shots)
    : job.shots.reduce((n, s) => n + liveSeconds(job, s), 0);

const timedShots = (job: VideoJob): CueShot[] => {
  let at = 0;
  return job.shots.map((s) => {
    const start = s.start ?? at;
    const end = s.end ?? start + liveSeconds(job, s);
    at = end;
    return { index: s.index, kind: s.kind, sound: s.sound, start, end };
  });
};

export const jobSoundCues = (job: VideoJob): SoundCue[] =>
  job.plan ? soundCues(job.plan.ambience, timedShots(job), soundTotalSec(job)) : [];

export const jobSoundSource = (job: Pick<VideoJob, "soundSource">) => soundSource(job.soundSource);

export function withJobSounds(job: VideoJob): VideoJob {
  const source = jobSoundSource(job);
  const sounds = withAsks(job.sounds, source.asks(jobSoundCues(job)));
  if (!sounds.length && !job.sounds?.length) return job;
  return { ...job, sounds, soundSource: source.id };
}

const framesToMake = (job: VideoJob) => job.frames.filter((f) => !f.file && isGenerated(job, f));

const previewStillToMake = (job: VideoJob) => job.frames.some((f) => !f.file);

export const stopsForPreview = (job: VideoJob) =>
  Boolean(
    job.plan &&
      job.pause &&
      !job.reviewed &&
      job.status !== "review" &&
      previewStillToMake(job) &&
      job.shots.every((s) => s.state === "queued" || s.state === "planned") &&
      !speechSent(job),
  );

export const doneShots = (job: VideoJob) => job.shots.filter((s) => s.state === "done").length;

type SavedJob = Omit<VideoJob, "version"> & {
  version: number;
  voiceMode?: string;
  level?: string;
  model?: string;
  ownModel?: string;
  modelLocked?: boolean;
  resolution?: string;
  takes?: SavedTake[];
  chosen?: string;
};

interface SavedTake {
  model?: string;
  level?: string;
  status?: JobStatus;
  cut: JobCut;
  previous?: JobCut;
}

function fromVersion1(job: SavedJob): SavedJob {
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

const SAME_LEVEL: Record<string, string> = {
  fastest: "fast",
  detailed: "balanced",
  "most-detailed": "balanced",
};

const versionOf = (made: { level?: string; model?: string }) =>
  made.level ? (SAME_LEVEL[made.level] ?? made.level) : (made.model ?? "");

const LEVELS_THAT_SPOKE_WITH_MINIMAX = ["fast", "fastest"];

function withoutOldModelFields(job: SavedJob): VideoJob {
  const {
    voiceMode: _mode,
    level: _level,
    model: _model,
    ownModel: _own,
    modelLocked: _locked,
    resolution: _size,
    ...rest
  } = job;
  return { ...rest, version: JOB_VERSION };
}

const startedToPay = (job: Pick<VideoJob, "status" | "dialogue" | "charges">) =>
  job.status !== "idle" || Boolean(job.dialogue) || Boolean(job.charges?.length);

function nativeJob(job: SavedJob): VideoJob {
  const video = LEVELS_THAT_SPOKE_WITH_MINIMAX.includes(job.level ?? "")
    ? "minimax-h3-max"
    : AUTO_MODELS.video;
  const kept = withoutOldModelFields(job);
  return {
    ...kept,
    models: { image: AUTO_MODELS.image, video },
    ...(startedToPay(kept) ? { modelsKept: true as const } : {}),
  };
}

function withVersionInUse(job: SavedJob): SavedJob {
  const working = versionOf(job);
  const take =
    job.chosen && job.chosen !== working
      ? job.takes?.find((t) => versionOf(t) === job.chosen && t.cut.final)
      : undefined;
  if (!take || (job.live && !take.cut.routes)) return job;
  const { routes, ...fields } = take.cut;
  const parked: SavedTake = {
    ...(job.model ? { model: job.model } : {}),
    ...(job.level ? { level: job.level } : {}),
    status: job.status,
    cut: cutOf(job),
    ...(job.previous ? { previous: job.previous } : {}),
  };
  const { chosen: _, ...rest } = job;
  return {
    ...rest,
    ...fields,
    ...(take.model ? { model: take.model } : {}),
    ...(take.level ? { level: take.level } : {}),
    status: take.status ?? "done",
    previous: take.previous,
    ...(routes && job.live ? { live: { ...job.live, plan: { ...job.live.plan, routes } } } : {}),
    takes: [...(job.takes ?? []).filter((t) => t !== take), parked],
  };
}

const dubbedVideo = (job: SavedJob): VideoJob => ({
  ...withoutOldModelFields(withVersionInUse(job)),
  dubbed: true,
});

function freshVideo(job: SavedJob): VideoJob {
  const fresh = newJob({
    sessionId: job.sessionId,
    seriesId: job.seriesId,
    scriptId: job.scriptId,
    title: job.title,
    lines: job.lines,
    pace: job.pace,
    useEnvironment: job.useEnvironment,
    models: AUTO_MODELS,
    now: job.updatedAt,
  });
  return {
    ...fresh,
    status: "idle",
    ...(job.direction?.length ? { direction: job.direction } : {}),
    ...(job.productIds ? { productIds: job.productIds } : {}),
    rev: (job.rev ?? 0) + 1,
    oldFiles: true,
  };
}

function migratedVersion(saved: SavedJob): VideoJob {
  if (saved.version === JOB_VERSION) return saved as VideoJob;
  const job = saved.version === 2 ? saved : fromVersion1(saved);
  if (job.voiceMode === "native") return nativeJob(job);
  return job.final ? dubbedVideo(job) : freshVideo(job);
}

export const shotModel = (job: Pick<VideoJob, "models" | "dubbed">): string | undefined =>
  job.dubbed ? undefined : modelsOf(job).video;

function withMishapsOfOldJobs(job: VideoJob): VideoJob {
  const at = job.updatedAt;
  return {
    ...job,
    frames: job.frames.map((f) =>
      withMishapsFromCounters(f, (x) => frameMishapsFromCounters(x, at, modelsOf(job).image)),
    ),
    shots: job.shots.map((s) =>
      withMishapsFromCounters(s, (x) => shotMishapsFromCounters(x, at, shotModel(job))),
    ),
    ...(job.segments
      ? {
          segments: job.segments.map((s) =>
            withMishapsFromCounters(s, (x) => segmentMishapsFromCounters(x, at)),
          ),
        }
      : {}),
  };
}

export const migrateJob = (raw: unknown): VideoJob =>
  withMishapsOfOldJobs(migratedVersion(raw as SavedJob));

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
    ...(job.segments
      ? {
          segments: job.segments.map((s) =>
            s.state === "queued" ? { ...s, state: "stopped" as const } : s,
          ),
        }
      : {}),
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
    ...(job.segments
      ? {
          segments: job.segments.map((s) =>
            s.state === "failed"
              ? segmentTriedAfresh(s)
              : s.state === "stopped"
                ? { ...s, state: "queued" as const, retried: false, error: undefined }
                : s,
          ),
        }
      : {}),
    ...(job.voices ? { voices: job.voices.map(voiceRetried) } : {}),
  };
}

export function runThrough(job: VideoJob, now: string): VideoJob {
  if (job.status === "done") return job;
  return { ...resumeJob(job, now), reviewed: true };
}

export function segmentHeard(
  job: VideoJob,
  id: string,
  resultUrl: string,
  heard: { clip: string; clipSec: number; speech: SpeechBounds; cutOff: boolean },
): VideoJob {
  const sent = job.segments?.find((s) => s.id === id);
  if (sent?.state !== "rendering" || sent.resultUrl !== resultUrl) return job;
  const next = cutOffAskedAgainLonger(sent, heard.cutOff)
    ? segmentCutOff(sent, videoModelOf(job))
    : segmentKept(sent, heard);
  return { ...job, segments: job.segments?.map((s) => (s.id === id ? next : s)) };
}

export const failedSegmentAt = (job: Pick<VideoJob, "segments">, index: number) =>
  (job.segments ?? []).find((s) => s.state === "failed" && segmentAnchor(s) === index);

export function retryShot(job: VideoJob, index: number, now: string): VideoJob {
  const shot = job.shots[index];
  const segment = failedSegmentAt(job, index);
  if (shot?.state !== "failed" && !segment) return job;
  const again = { state: "queued" as const, retried: false, error: undefined };
  const shots = job.shots.map((s) =>
    s.index === index && s.state === "failed" ? { ...s, ...again } : s,
  );
  const active = job.status === "running" || job.status === "waiting";
  return {
    ...job,
    shots,
    ...(segment
      ? { segments: job.segments?.map((s) => (s.id === segment.id ? segmentTriedAfresh(s) : s)) }
      : {}),
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

function shotFailedWithMishap(
  job: VideoJob,
  shot: JobShot,
  message: string,
  kind: MishapKind,
  at: string,
): JobShot {
  const next = shotAttemptFailed(job, shot, message);
  const kinds: MishapKind[] = next.fallback && !shot.fallback ? [kind, "still-instead"] : [kind];
  return withMishaps(next, kinds, at, shotModel(job));
}

export const hasInput = (s: JobShot) => s.end !== undefined;

export interface ShotInput {
  start: number;
  end: number;
  cutFrom?: number;
}

export function withShotTimes(job: VideoJob, inputs: ShotInput[]): VideoJob {
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
  | { kind: "timeline" }
  | { kind: "frame"; frame: string }
  | { kind: "poll-frame"; frame: string }
  | { kind: "submit-shot"; index: number }
  | { kind: "poll-shot"; index: number }
  | { kind: "submit-sound"; sound: string }
  | { kind: "poll-sound"; sound: string }
  | { kind: "submit-segment"; segment: string }
  | { kind: "poll-segment"; segment: string }
  | { kind: "voices" }
  | { kind: "submit-voice"; voice: string }
  | { kind: "poll-voice"; voice: string }
  | { kind: "assemble" };

export const actionKey = (a: JobAction) =>
  a.kind === "frame" || a.kind === "poll-frame"
    ? `frame:${a.frame}`
    : a.kind === "submit-shot" || a.kind === "poll-shot"
      ? `shot:${a.index}`
      : a.kind === "submit-sound" || a.kind === "poll-sound"
        ? `sound:${a.sound}`
        : a.kind === "submit-segment" || a.kind === "poll-segment"
          ? `segment:${a.segment}`
          : a.kind === "submit-voice" || a.kind === "poll-voice"
            ? `voice:${a.voice}`
            : a.kind;

const paidRequestsInFlight = (job: VideoJob): JobAction[] => [
  ...job.frames
    .filter((f) => !f.file && f.requestId)
    .map((f): JobAction => ({ kind: "poll-frame", frame: f.id })),
  ...job.shots
    .filter((s) => s.state === "rendering" && s.requestId)
    .map((s): JobAction => ({ kind: "poll-shot", index: s.index })),
  ...(job.sounds ?? [])
    .filter(soundInFlight)
    .map((s): JobAction => ({ kind: "poll-sound", sound: s.id })),
  ...(job.segments ?? [])
    .filter((s) => s.state === "rendering" && s.requestId)
    .map((s): JobAction => ({ kind: "poll-segment", segment: s.id })),
  ...(job.voices ?? [])
    .filter(voiceInFlight)
    .map((v): JobAction => ({ kind: "poll-voice", voice: v.characterId })),
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

const soundsToSubmit = (job: VideoJob): JobAction[] =>
  (job.sounds ?? [])
    .filter(soundToSend)
    .map((s): JobAction => ({ kind: "submit-sound", sound: s.id }));

const waitsForTheFirstLook = (job: VideoJob) => Boolean(job.pause && !job.reviewed);

const segmentsToSubmit = (job: VideoJob): JobAction[] =>
  waitsForTheFirstLook(job)
    ? []
    : (job.segments ?? [])
        .filter((s) => s.state === "queued" && !s.requestId)
        .filter((s) => Boolean(job.frames.find((f) => f.id === s.frame)?.file))
        .filter((s) => voiceReady(job, s.characterId))
        .map((s): JobAction => ({ kind: "submit-segment", segment: s.id }));

const voicesToMake = (job: VideoJob): JobAction[] =>
  voicesToRecord(job)
    ? [{ kind: "voices" }]
    : (job.voices ?? [])
        .filter(voiceToSend)
        .map((v): JobAction => ({ kind: "submit-voice", voice: v.characterId }));

function stepsForPhase(job: VideoJob, busy: ReadonlySet<string>): JobAction[] {
  const phase = jobPhase(job);
  if (phase === "plan") return job.planning ? [] : [{ kind: "plan" }];
  if (phase === "voice") return [{ kind: "timeline" }];
  if (phase === "speech") return [...voicesToMake(job), ...segmentsToSubmit(job)];
  if (phase === "frames")
    return [
      ...framesToStart(job),
      ...voicesToMake(job),
      ...segmentsToSubmit(job),
      ...soundsToSubmit(job),
    ];
  if (phase === "shots") return [...shotsToSubmit(job, busy), ...soundsToSubmit(job)];
  if (phase === "assemble") {
    return soundsSettled(job.sounds) ? [{ kind: "assemble" }] : soundsToSubmit(job);
  }
  return [];
}

export function nextActions(job: VideoJob, busy: ReadonlySet<string>): JobAction[] {
  const notBusy = (a: JobAction) => !busy.has(actionKey(a));
  const polls = paidRequestsInFlight(job).filter(notBusy);
  if (job.status !== "running") return polls;
  return [...polls, ...stepsForPhase(job, busy).filter(notBusy)];
}

const testVideoReachedItsPause = (job: VideoJob) =>
  job.pause === true && !job.reviewed && jobPhase(job) === "speech" && !speechSent(job);

export function settle(job: VideoJob): VideoJob {
  if (job.final && job.status !== "done")
    return { ...job, status: "done", assembleProgress: undefined };
  if (job.status !== "running") return job;
  if (testVideoReachedItsPause(job)) return { ...job, status: "review" };
  const failedFrame = job.frames.find((f) => !f.file && !f.requestId && f.error);
  if (failedFrame) return { ...job, status: "failed", error: failedFrame.error };
  const failedVoice = job.voices?.find(voiceFailed);
  if (failedVoice) return { ...job, status: "failed", error: failedVoice.error };
  const failed = job.shots.filter((s) => s.state === "failed");
  const failedSpeech = (job.segments ?? []).filter((s) => s.state === "failed");
  const open =
    job.shots.some((s) => s.state === "queued" || s.state === "rendering") ||
    (job.segments ?? []).some(segmentOpen);
  if ((failed.length || failedSpeech.length) && !open) return { ...job, status: "failed" };
  return job;
}

export const resumesOnStart = (job: VideoJob) =>
  job.status === "running" ||
  job.status === "waiting" ||
  job.shots.some((s) => s.state === "rendering" && s.requestId) ||
  job.frames.some((f) => !f.file && f.requestId) ||
  (job.segments ?? []).some((s) => s.state === "rendering" && s.requestId) ||
  (job.voices ?? []).some(voiceInFlight);

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

export const stillToDrawAgain = (
  frame: JobFrame,
  problem: string,
  model?: string,
  at = new Date().toISOString(),
): JobFrame => ({
  ...withMishaps(frame, stillProblemMishaps(problem), at, model),
  redone: true,
  check: problem,
  requestId: undefined,
  resultUrl: undefined,
  submittedAt: undefined,
  costUsd: undefined,
  costBilled: undefined,
});

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

function frameFailedWithMishap(
  job: VideoJob,
  frame: JobFrame,
  message: string,
  kind: MishapKind,
  at: string,
): JobFrame {
  const next = frameAttemptFailed(job, frame, message);
  const kinds: MishapKind[] = next.fallback && !frame.fallback ? [kind, "simpler"] : [kind];
  return withMishaps(next, kinds, at, modelsOf(job).image);
}

export type JobStep =
  | { frame: string }
  | { shot: number }
  | { sound: string }
  | { segment: string }
  | { voice: string };

const withVoice = (job: VideoJob, id: string, change: (v: JobVoice) => JobVoice): VideoJob => ({
  ...job,
  voices: job.voices?.map((v) => (v.characterId === id ? change(v) : v)),
});

export function stepReportedFailure(
  job: VideoJob,
  step: JobStep,
  message: string,
  kind: MishapKind = mishapOfMessage(message),
  at = new Date().toISOString(),
): VideoJob {
  if ("voice" in step) return withVoice(job, step.voice, (v) => voiceAttemptFailed(v, message));
  if ("segment" in step) {
    return {
      ...job,
      segments: job.segments?.map((s) =>
        s.id === step.segment
          ? withMishaps(segmentAttemptFailed(s, message), [kind], at, s.model)
          : s,
      ),
    };
  }
  if ("sound" in step) {
    return {
      ...job,
      sounds: (job.sounds ?? []).map((s) =>
        s.id === step.sound ? soundAttemptFailed(s, message) : s,
      ),
    };
  }
  if ("frame" in step) {
    return {
      ...job,
      frames: job.frames.map((f) =>
        f.id === step.frame ? frameFailedWithMishap(job, f, message, kind, at) : f,
      ),
    };
  }
  return {
    ...job,
    shots: job.shots.map((s) =>
      s.index === step.shot ? shotFailedWithMishap(job, s, message, kind, at) : s,
    ),
  };
}

const stillAwaits = (item: { requestId?: string; resultUrl?: string }, requestId: string) =>
  item.requestId === requestId && !item.resultUrl;

const notSent = {
  requestId: undefined,
  submittedAt: undefined,
  resultUrl: undefined,
  sending: undefined,
  busyAnswers: undefined,
  endpoint: undefined,
};

export function requestWithdrawn(job: VideoJob, step: JobStep, requestId: string): VideoJob {
  const state = job.status === "running" || job.status === "waiting" ? "queued" : "stopped";
  if ("voice" in step) {
    return withVoice(job, step.voice, (v) => (stillAwaits(v, requestId) ? voiceWithdrawn(v) : v));
  }
  if ("segment" in step) {
    return {
      ...job,
      segments: job.segments?.map((s) =>
        s.id === step.segment && stillAwaits(s, requestId) ? segmentWithdrawn(s, state) : s,
      ),
    };
  }
  if ("sound" in step) {
    return {
      ...job,
      sounds: job.sounds?.map((s) =>
        s.id === step.sound && stillAwaits(s, requestId) ? soundWithdrawn(s) : s,
      ),
    };
  }
  if ("frame" in step) {
    return {
      ...job,
      frames: job.frames.map((f) =>
        f.id === step.frame && stillAwaits(f, requestId) ? { ...f, ...notSent } : f,
      ),
    };
  }
  return {
    ...job,
    shots: job.shots.map((s) =>
      s.index === step.shot && stillAwaits(s, requestId) ? { ...s, ...notSent, state } : s,
    ),
  };
}

export function stepThrew(job: VideoJob, step: JobStep, error: unknown, nowMs: number): VideoJob {
  const message = error instanceof Error ? error.message : String(error);
  const failed = () =>
    stepReportedFailure(job, step, message, mishapOfError(error), new Date(nowMs).toISOString());
  if ("sound" in step) return failed();
  if (providerBusy(error)) {
    const answers = busyAnswersOf(job, step) + 1;
    if (answers >= MAX_BUSY_ANSWERS) return failed();
    return wentOffline(withBusyAnswers(job, step, answers), message, nowMs);
  }
  if (isNetworkError(error)) return wentOffline(job, message, nowMs);
  return failed();
}

type PaidStep = Exclude<JobStep, { sound: string }>;

const busyAnswersOf = (job: VideoJob, step: PaidStep) =>
  ("voice" in step
    ? job.voices?.find((v) => v.characterId === step.voice)?.busyAnswers
    : "segment" in step
      ? job.segments?.find((s) => s.id === step.segment)?.busyAnswers
      : "frame" in step
        ? job.frames.find((f) => f.id === step.frame)?.busyAnswers
        : job.shots.find((s) => s.index === step.shot)?.busyAnswers) ?? 0;

const withBusyAnswers = (job: VideoJob, step: PaidStep, busyAnswers: number): VideoJob =>
  "voice" in step
    ? withVoice(job, step.voice, (v) => ({ ...v, busyAnswers }))
    : "segment" in step
      ? {
          ...job,
          segments: job.segments?.map((s) => (s.id === step.segment ? { ...s, busyAnswers } : s)),
        }
      : "frame" in step
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
  const speechRound = speechMade(job) ? 0 : avg.shot;
  const longestOf = (sent: { submittedAt?: string }[]) =>
    sent.length
      ? Math.max(
          ...sent.map((s) =>
            Math.max(MIN_SEC_LEFT_FOR_A_RENDERING_SHOT, avg.shot - since(s.submittedAt)),
          ),
        )
      : 0;
  let left = avg.assemble;
  if (phase === "plan") {
    left += Math.max(0, avg.plan - since(job.phaseStartedAt));
    left +=
      speechRound +
      (framesToMake(job).length || job.useEnvironment ? wideStillThenTheRestTogether : 0);
    left += oneRoundForAllShots(Math.max(notDone.length, job.lines.length));
  } else if (phase === "voice") {
    left += oneRoundForAllShots(notDone.length);
  } else if (phase === "frames") {
    left += Math.max(0, avg.frame - since(job.phaseStartedAt)) + speechRound;
    left += oneRoundForAllShots(notDone.length);
  } else if (phase === "speech") {
    const segments = job.segments ?? [];
    const queued = segments.some((s) => s.state === "queued");
    left += Math.max(
      longestOf(segments.filter((s) => s.state === "rendering")),
      queued ? avg.shot : 0,
    );
    left += oneRoundForAllShots(notDone.length);
  } else if (phase === "shots") {
    const queued = notDone.filter((s) => s.state === "queued").length;
    left += Math.max(
      longestOf(job.shots.filter((s) => s.state === "rendering")),
      oneRoundForAllShots(queued),
    );
  } else if (phase === "assemble") {
    left = avg.assemble * (1 - (job.assembleProgress ?? 0));
  } else {
    left = 0;
  }
  return Math.max(0, left);
}

export const nextAverage = (current: number, measured: number) =>
  current + (measured - current) / MEASUREMENTS_IN_RUNNING_AVERAGE;
