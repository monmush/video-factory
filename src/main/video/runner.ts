import { randomUUID } from "node:crypto";
import {
  constants,
  copyFile,
  link,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, BrowserWindow, dialog } from "electron";
import { outputSize, videoLevel } from "../../shared/batch-settings";
import {
  rejectClip,
  rejectSegmentClip,
  speakerForNextClip,
  withUnrecordedSpeakerRejections,
} from "../../shared/clip-check";
import {
  type ChargeKind,
  STEP,
  shotChargeKind,
  withCharge,
  withRecordedCharges,
} from "../../shared/cost/charges";
import {
  frameUsd,
  shotEstimateUsd,
  withCurrentRates,
  withFirstPass,
} from "../../shared/cost/estimate";
import type { ResultCost } from "../../shared/cost/rates";
import { segmentStep } from "../../shared/cost/speech-cost";
import {
  anchoredDirection,
  type DirectionEntry,
  sameSpokenLines,
  setDirection,
} from "../../shared/direction";
import { editsInPlace, failedUnpaid, unstarted, videoUntouched } from "../../shared/edit-in-place";
import type { Asset, Script } from "../../shared/ipc";
import { plannedMotion } from "../../shared/material";
import { mediaLevel } from "../../shared/media-level";
import { isNetworkError, providerBusy } from "../../shared/net-error";
import {
  makingVideo,
  type PaidWork,
  paidWork,
  type SentRequest,
  sentRequestOf,
  stepKey,
  stepsOut,
  videosBeingMade,
} from "../../shared/paid-work";
import { clocked, restartedClock } from "../../shared/phase-clock";
import { followProduct } from "../../shared/product-follow";
import { cutoutsToMake } from "../../shared/product-shot";
import { assertCommitted, committedIds, NOT_COMMITTED } from "../../shared/ready-check";
import {
  downloadFailedMessage,
  requestOverdue,
  timedOutMessage,
  unreadableResultMessage,
} from "../../shared/request-deadline";
import { reconcileJob, withSending } from "../../shared/request-reconcile";
import { classifyScriptEdit, listFitsPlan, type RestageBasis } from "../../shared/restage";
import { reworded, rewordedFrom } from "../../shared/reworded";
import type { ShotList } from "../../shared/shot-list";
import {
  castOf,
  heldSpans,
  heldTiming,
  holdInserts,
  lineOffsets,
  shotTimes,
  withHolds,
} from "../../shared/shot-plan";
import { asksUsd, type JobSound, placeLayers, soundToSend } from "../../shared/sound";
import type { JobSegment } from "../../shared/speech";
import {
  cutFrom,
  type SpeechTimeline,
  segmentAskedSec,
  segmentEstimateUsd,
  segmentModel,
  speechCutOff,
  speechTimeline,
} from "../../shared/speech";
import type { VoiceMode } from "../../shared/speech-models";
import {
  freeSettle,
  type OutdatedReason,
  outdatedReasons,
  readyToMake,
  type StagingStatus,
  stageable,
  stagingOutdated,
  stagingStatus,
  wishesChanged,
} from "../../shared/staging-status";
import { buildAss, wordCues } from "../../shared/subtitles";
import { type Tempo, tempoOf } from "../../shared/tempo";
import {
  type ExportPick,
  exportableVideos,
  exportPlan,
  freeFileName,
  sameFileName,
} from "../../shared/video-export";
import {
  applyFix,
  type FixChange,
  fixPriceUsd,
  fixScope,
  restorePrevious,
} from "../../shared/video-fix";
import {
  actionKey,
  applyLivePlan,
  applyPlan,
  backOnline,
  followBatch,
  frameFor,
  holdsSec,
  isGenerated,
  isNative,
  type JobAction,
  type JobFrame,
  type JobShot,
  type JobStep,
  jobPhase,
  jobSoundCues,
  jobSoundSource,
  levelSpeech,
  MIN_SHOT_SEC,
  madeByProvider,
  migrateJob,
  modelLocked,
  newJob,
  nextActions,
  nextAverage,
  pickNext,
  plannedFrame,
  requestWithdrawn,
  resumeJob,
  resumesOnStart,
  retryNetworkNow,
  retryShot as retryShotState,
  revFile,
  runThrough,
  type ShotInput,
  type StepAverages,
  segmentAnchor,
  segmentHeard,
  settle,
  shotModel,
  spokenLines,
  stepReportedFailure,
  stepThrew,
  stillToDrawAgain,
  stopJob,
  type VideoJob,
  waitingForNetwork,
  wentOffline,
  withJobSounds,
  withShotAudio,
  withSpeech,
  withVoiceMode,
} from "../../shared/video-job";
import { fitResolution } from "../../shared/video-models";
import {
  chooseVersion,
  chosenView,
  deleteVersion,
  focusVersion,
  planAtLevel,
  startVersion,
  workingVersion,
} from "../../shared/video-takes";
import { getBoard, onBoardChanged } from "../board";
import { type Canceller, falCancel, falCancelUnlessStarted } from "../fal";
import { type CancelOutcome, mayStillBeBilled } from "../fal-queue";
import {
  fileFinishedVideos,
  fileWhenFinished,
  markVideoKept,
  onMaterialChanged,
  placeMaterialFile,
  recordUse,
} from "../material";
import { assetDir } from "../media";
import { dataFile, mediaDir, removeStaleTmp, writeJsonAtomic } from "../paths";
import { providerMode } from "../providers";
import { nativeVoiceOn } from "../settings";
import { getWorkspace } from "../store";
import { logUsage, openFalRequests } from "../usage";
import { checkStill } from "./checks";
import { clipAddedLettering } from "./clip-check";
import { directJob } from "./director";
import {
  assembleOverDialogue,
  assertFfmpegBeforeAnyPaidStep,
  atTempo,
  audible,
  cropCloser,
  cutLine,
  exactClip,
  frameCount,
  insertSilence,
  integratedLufs,
  joinSpeech,
  mixSoundtrack,
  padAudio,
  probeSeconds,
  productStill,
  silence,
  speechShotClip,
  stillClip,
} from "./ffmpeg";
import { lookPath, lookStill, readLook, saveLook } from "./look";
import { availabilityIn, stagingMaterial, storedClip, storedPicture } from "./material-staging";
import {
  type CutoutResult,
  CutoutStopped,
  CutoutTimedOut,
  productClip,
  productCutout,
  productStillOn,
} from "./product-shot";
import { soundMaker } from "./sounds";
import {
  cancelSegment,
  downloadSegment,
  heardSpeech,
  pollSegment,
  segmentPrompt,
  submitSegment,
} from "./speech";
import { StagingStopped } from "./staging";
import {
  cancelFrame,
  cancelShot,
  coverFrame,
  download,
  type FrameInputs,
  generateVoice,
  type LiveFiles,
  pollFrame,
  pollLiveFrame,
  pollLiveShot,
  pollShot,
  type StepPoll,
  submitFrame,
  submitLiveFrame,
  submitLiveShot,
  submitShot,
} from "./steps";

const JOB_FILE = "job.json";
const AVERAGES_FILE = "video-averages.json";
const TICK_MS = 1000;

const keyOf = (sessionId: string, scriptId: string) => `${sessionId}/${scriptId}`;
const jobKey = (job: VideoJob) => keyOf(job.sessionId, job.scriptId);
export const jobDir = (job: Pick<VideoJob, "seriesId" | "sessionId" | "scriptId">) =>
  join(mediaDir(job.seriesId, job.sessionId), "videos", job.scriptId);
const nowIso = () => new Date().toISOString();

const jobs = new Map<string, VideoJob>();
const busy = new Set<string>();
const lastPoll = new Map<string, number>();
const writes = new Map<string, Promise<unknown>>();
const inProgress = new Map<string, Promise<void>>();
const abandoned = new Map<string, VideoJob>();
let accepting = true;
let timer: NodeJS.Timeout | null = null;
let loaded: Promise<void> | null = null;

const DEFAULT_AVERAGES: Record<"live" | "fixture", StepAverages> = {
  live: { plan: 70, voice: 25, frame: 45, shot: 150, assemble: 20 },
  fixture: { plan: 3, voice: 4, frame: 4, shot: 8, assemble: 5 },
};
let averages: Record<"live" | "fixture", StepAverages> | null = null;

async function loadAverages() {
  try {
    const saved = JSON.parse(await readFile(dataFile(AVERAGES_FILE), "utf8"));
    averages = {
      live: { ...DEFAULT_AVERAGES.live, ...saved.live },
      fixture: { ...DEFAULT_AVERAGES.fixture, ...saved.fixture },
    };
  } catch {
    averages = structuredClone(DEFAULT_AVERAGES);
  }
}

export const currentAverages = (): StepAverages => (averages ?? DEFAULT_AVERAGES)[providerMode()];

function measured(step: keyof StepAverages, seconds: number) {
  if (!averages || !(seconds > 0)) return;
  const mode = providerMode();
  averages[mode] = { ...averages[mode], [step]: nextAverage(averages[mode][step], seconds) };
  void writeJsonAtomic(dataFile(AVERAGES_FILE), averages).catch(() => undefined);
}

function emit(job: VideoJob) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("video:job", { job, averages: currentAverages() });
  }
  noticeMaking();
}

let makingShown = "{}";

function noticeMaking() {
  const counts = videosBeingMadeNow();
  const shown = JSON.stringify(counts);
  if (shown === makingShown) return;
  makingShown = shown;
  const total = Object.values(counts).reduce((n, c) => n + c, 0);
  app.dock?.setBadge(total ? String(total) : "");
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send("video:making", counts);
}

export const videosBeingMadeNow = () => videosBeingMade([...jobs.values()]);

export const paidWorkNow = (): PaidWork => paidWork([...jobs.values()]);

export async function paidWorkOf(sessionIds: readonly string[]): Promise<PaidWork> {
  await ensureLoaded();
  return paidWork([...jobs.values()].filter((job) => sessionIds.includes(job.sessionId)));
}

async function update(key: string, change: (job: VideoJob) => VideoJob): Promise<VideoJob | null> {
  const current = jobs.get(key);
  if (!current) {
    const left = abandoned.get(key);
    if (left) abandoned.set(key, change(left));
    return null;
  }
  const next = clocked(current, settle({ ...change(current), updatedAt: nowIso() }), Date.now());
  jobs.set(key, next);
  await save(key, next);
  emit(next);
  schedule();
  fileWhenFinished(current, next, jobDir(next));
  return next;
}

function save(key: string, job: VideoJob): Promise<unknown> {
  const write = (writes.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() =>
      jobs.has(key) ? writeJsonAtomic(join(jobDir(job), JOB_FILE), jobs.get(key)) : null,
    );
  writes.set(key, write);
  return write;
}

async function loadAll(): Promise<void> {
  await loadAverages();
  const ws = await getWorkspace();
  const open = await openFalRequests();
  for (const session of ws.sessions) {
    const dir = join(mediaDir(session.seriesId, session.id), "videos");
    const names = await readdir(dir).catch(() => [] as string[]);
    for (const name of names) {
      const folder = join(dir, name);
      await removeStaleTmp(folder);
      let raw: string;
      try {
        raw = await readFile(join(folder, JOB_FILE), "utf8");
      } catch {
        continue;
      }
      try {
        const migrated = withUnrecordedSpeakerRejections(migrateJob(JSON.parse(raw)));
        let job = restartedClock(
          withCurrentRates(withRecordedCharges(migrated, workingVersion(migrated))),
          Date.now(),
        );
        delete job.planning;
        delete job.planningSteps;
        const found = reconcileJob(job, open);
        if (found.job !== job) {
          job = found.job;
          if (found.attached.length) {
            console.log(`[video] ${name}: attached ${found.attached.join(", ")}`);
          }
          await writeJsonAtomic(join(folder, JOB_FILE), job);
        }
        jobs.set(jobKey(job), job);
      } catch (error) {
        console.warn(`[video] could not read ${name}/${JOB_FILE}:`, (error as Error).message);
      }
    }
  }
  void fileFinishedVideos([...jobs.values()].map((job) => ({ job, folder: jobDir(job) })));
}

function ensureLoaded() {
  loaded ??= loadAll();
  return loaded;
}

export async function startRunner(): Promise<void> {
  await ensureLoaded();
  const resumed = [...jobs.values()].filter(resumesOnStart);
  if (resumed.length) console.log(`[video] resuming ${resumed.length} job(s)`);
  timer ??= setInterval(pump, TICK_MS);
  unwatchBoard ??= onBoardChanged((sessionId, board) => {
    void syncScripts(sessionId, board.scripts);
  });
  unwatchMaterial ??= onMaterialChanged((seriesId) => {
    void followMaterial(seriesId).catch((error) =>
      console.error("[material] could not follow the store", error),
    );
  });
  schedule();
  noticeMaking();
}

let unwatchBoard: (() => void) | null = null;
let unwatchMaterial: (() => void) | null = null;

export function stopRunner() {
  if (timer) clearInterval(timer);
  timer = null;
  unwatchBoard?.();
  unwatchBoard = null;
  unwatchMaterial?.();
  unwatchMaterial = null;
}

const stagedNotStarted = (job: VideoJob) => Boolean(job.plan) && unstarted(job);

async function followMaterial(seriesId: string): Promise<void> {
  const available = await availabilityIn(seriesId);
  for (const job of [...jobs.values()]) {
    if (job.seriesId !== seriesId || !stagedNotStarted(job) || available(job) === job) continue;
    await update(jobKey(job), (j) => (stagedNotStarted(j) ? available(j) : j));
  }
}

export async function setFreshPicture(
  sessionId: string,
  scriptId: string,
  frameId: string,
  fresh: boolean,
): Promise<null> {
  await ensureLoaded();
  const key = keyOf(sessionId, scriptId);
  const job = jobs.get(key);
  if (!job || !stagedNotStarted(job)) throw new Error("Video đã bắt đầu tạo");
  if (!job.frames.some((f) => f.id === frameId && f.material)) {
    throw new Error("Không tìm thấy khung hình này");
  }
  const available = await availabilityIn(job.seriesId);
  await update(key, (j) =>
    stagedNotStarted(j)
      ? available({
          ...j,
          frames: j.frames.map((f) => (f.id === frameId ? freshOrNot(f, fresh) : f)),
        })
      : j,
  );
  return null;
}

function freshOrNot(frame: JobFrame, fresh: boolean): JobFrame {
  if (fresh) return { ...frame, fresh: true };
  const { fresh: _, ...rest } = frame;
  return rest;
}

const settledWithin = (ms: number, work: readonly (Promise<unknown> | undefined)[]) =>
  new Promise<void>((resolve) => {
    const late = setTimeout(resolve, ms);
    void Promise.allSettled(work).then(() => {
      clearTimeout(late);
      resolve();
    });
  });

function stopStartingWork() {
  accepting = false;
  stopRunner();
}

export async function finishRunner(withinMs: number): Promise<void> {
  stopStartingWork();
  const deadline = Date.now() + withinMs;
  await settledWithin(withinMs, [...inProgress.values()]);
  await settledWithin(Math.max(0, deadline - Date.now()), [...writes.values()]);
}

export async function flushRunner(withinMs: number): Promise<void> {
  stopStartingWork();
  await settledWithin(withinMs, [...writes.values()]);
}

export const isMakingVideo = () => [...jobs.values()].some((job) => job.status === "running");

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    pump();
  }, 50);
}

export async function jobsFor(sessionId: string): Promise<VideoJob[]> {
  await ensureLoaded();
  return [...jobs.values()].filter((j) => j.sessionId === sessionId);
}

interface StagingHold {
  holders: number;
  asked: Map<string, boolean>;
}

const stagingHolds = new Map<string, StagingHold>();

export function holdStaging(sessionId: string): () => void {
  const hold = stagingHolds.get(sessionId) ?? { holders: 0, asked: new Map() };
  hold.holders += 1;
  stagingHolds.set(sessionId, hold);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    hold.holders -= 1;
    if (hold.holders > 0) return;
    stagingHolds.delete(sessionId);
    const asked = [...hold.asked];
    const once = asked.filter(([, again]) => !again).map(([id]) => id);
    const again = asked.filter(([, again]) => again).map(([id]) => id);
    void stage(sessionId, once).catch(logStaging);
    void stage(sessionId, again, true).catch(logStaging);
  };
}

export async function askToStage(
  sessionId: string,
  scriptIds: string[],
  again = false,
): Promise<void> {
  const hold = stagingHolds.get(sessionId);
  if (!hold) {
    await stage(sessionId, scriptIds, again);
    return;
  }
  for (const id of scriptIds) hold.asked.set(id, again || hold.asked.get(id) === true);
}

const logStaging = (error: unknown) =>
  console.warn("[video] staging:", error instanceof Error ? error.message : String(error));

async function createJob(
  sessionId: string,
  scriptId: string,
  test = false,
  status?: "idle",
  direction?: DirectionEntry[],
  replaces: (current: VideoJob | undefined) => boolean = (current) => !current,
  carried: Pick<VideoJob, "restageFrom" | "rewordedFrom"> = {},
): Promise<VideoJob> {
  const ws = await getWorkspace();
  const session = ws.sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error("Không tìm thấy phiên này");
  const board = await getBoard(sessionId);
  const script = board.scripts.find((s) => s.id === scriptId && !s.deletedAt);
  if (!committedIds(session, board.scripts).includes(scriptId)) {
    if (status !== "idle") throw new Error(NOT_COMMITTED);
    if (script && script.status !== "ready") {
      throw new Error("Kịch bản đang được viết, thử lại sau");
    }
  }
  if (!script) throw new Error("Không tìm thấy kịch bản");
  const series = ws.series.find((s) => s.id === session.seriesId);
  const useEnvironment = Boolean(
    series?.environmentIds.some((id) => ws.assets.find((a) => a.id === id)?.images.length),
  );
  const level = mediaLevel(videoLevel(session, series, scriptId));
  const job = newJob({
    sessionId,
    seriesId: session.seriesId,
    scriptId,
    title: script.title,
    lines: script.lines,
    useEnvironment,
    model: level.speaker,
    resolution: fitResolution(level.speaker, level.output),
    now: nowIso(),
  });
  if (job.lines.length === 0) throw new Error("Kịch bản không có lời thoại");
  job.level = level.id;
  if (nativeVoiceOn()) job.voiceMode = "native";
  if (status) job.status = status;
  job.productIds = [...script.productIds];
  if (direction?.length) job.direction = direction;
  if (carried.restageFrom) job.restageFrom = carried.restageFrom;
  if (carried.rewordedFrom) job.rewordedFrom = carried.rewordedFrom;
  if (test && !(await readLook(job.seriesId))) job.pause = true;
  await mkdir(jobDir(job), { recursive: true });
  const key = jobKey(job);
  if (!replaces(jobs.get(key))) throw new JobInUse();
  jobs.set(key, job);
  await save(key, job);
  emit(job);
  return job;
}

class JobInUse extends Error {
  constructor() {
    super("Video đã bắt đầu tạo");
  }
}

const freeToReplace = (current: VideoJob | undefined) =>
  !current || unstarted(current) || failedUnpaid(current);

async function boardNow(sessionId: string) {
  const ws = await getWorkspace();
  const session = ws.sessions.find((s) => s.id === sessionId);
  const series = ws.series.find((s) => s.id === session?.seriesId);
  const board = await getBoard(sessionId);
  const levelOf = (id: string) => videoLevel(session, series, id);
  const find = (id: string) => board.scripts.find((s) => s.id === id && !s.deletedAt);
  return { ws, session, board, levelOf, find };
}

const STAGING_BEHIND = "Dàn dựng chưa theo thay đổi mới";
const NOT_STAGED = "Chưa dàn dựng";

function assertStagedToMake(job: VideoJob | undefined, script: Script | undefined, level: string) {
  if (job && !videoUntouched(job)) return;
  if (!job?.plan || !script) throw new Error(NOT_STAGED);
  if (!readyToMake(job, script, level)) throw new Error(STAGING_BEHIND);
}

export async function start(sessionId: string, scriptId: string): Promise<null> {
  await ensureLoaded();
  await committedOrThrow(sessionId, scriptId);
  const key = keyOf(sessionId, scriptId);
  const current = jobs.get(key);
  if (current?.planning) throw new Error("Đang lên dàn dựng");
  if (current?.offline && (current.status === "running" || current.status === "waiting")) {
    await update(key, (job) => retryNetworkNow(job, Date.now()));
    return null;
  }
  const { find, levelOf } = await boardNow(sessionId);
  const script = find(scriptId);
  const level = levelOf(scriptId);
  assertStagedToMake(current, script, level);
  const available = current ? await availabilityIn(current.seriesId) : (j: VideoJob) => j;
  await update(key, (job) =>
    videoUntouched(job) && !(script && readyToMake(job, script, level))
      ? job
      : resumeJob(spendingStarts(available(job), nowIso()), nowIso()),
  );
  return null;
}

const voiceModeNow = (): VoiceMode => (nativeVoiceOn() ? "native" : "dubbed");

function spendingStarts(job: VideoJob, now: string): VideoJob {
  const ready = withVoiceMode(job, voiceModeNow());
  return ready.status === "idle" ? withFirstPass(ready, now) : ready;
}

function charged(
  job: VideoJob,
  kind: ChargeKind,
  step: string,
  cost: Pick<ResultCost, "usd" | "billed">,
  requestId?: string,
): VideoJob {
  if (cost.usd === null) return job;
  return withCharge(job, {
    at: nowIso(),
    kind,
    step,
    usd: cost.usd,
    billed: cost.billed,
    ...(requestId ? { requestId } : {}),
    version: workingVersion(job),
  });
}

const chargedIfStillBilled = (
  outcome: CancelOutcome,
  job: VideoJob,
  kind: ChargeKind,
  step: string,
  usd: number | null,
  requestId: string | undefined,
) =>
  mayStillBeBilled(outcome) ? charged(job, kind, step, { usd, billed: false }, requestId) : job;

export async function followVoiceMode(): Promise<void> {
  await ensureLoaded();
  const mode = voiceModeNow();
  for (const job of [...jobs.values()]) {
    if (!unstarted(job) || withVoiceMode(job, mode) === job) continue;
    await update(jobKey(job), (j) => (unstarted(j) ? withVoiceMode(j, mode) : j));
  }
}

const stagings = new Map<string, AbortController>();
const preparing = new Set<string>();

async function beginStaging(key: string): Promise<void> {
  const job = jobs.get(key);
  if (!job || job.plan || job.planning || job.status !== "idle" || stagings.has(key)) return;
  const staging = new AbortController();
  stagings.set(key, staging);
  const planning = await update(key, (j) => ({ ...j, planning: true }));
  void finishStaging(key, planning, staging).catch(logStaging);
}

async function finishStaging(key: string, planning: VideoJob | null, staging: AbortController) {
  try {
    if (planning) await runPlan(key, planning, staging.signal);
  } finally {
    if (stagings.get(key) === staging) stagings.delete(key);
    await update(key, (j) => {
      const { planning: _, planningSteps: __, ...rest } = j;
      return rest;
    });
  }
  if (planning) await syncScripts(planning.sessionId, (await getBoard(planning.sessionId)).scripts);
}

export async function stage(sessionId: string, scriptIds: string[], again = false): Promise<null> {
  await ensureLoaded();
  const { levelOf, find } = await boardNow(sessionId);
  for (const scriptId of new Set(scriptIds)) {
    const key = keyOf(sessionId, scriptId);
    const script = find(scriptId);
    if (!script || preparing.has(key) || stagings.has(key)) continue;
    const job = jobs.get(key);
    const status = stagingStatus(job, script, levelOf(scriptId));
    if (!stageable(script) || status === "started" || status === "staging") continue;
    if (status === "ready" && !again) continue;
    preparing.add(key);
    try {
      await jobForStaging(sessionId, script, job, status === "ready", levelOf(scriptId));
      await beginStaging(key);
    } catch (error) {
      if (!(error instanceof JobInUse)) logStaging(error);
    } finally {
      preparing.delete(key);
    }
  }
  return null;
}

async function jobForStaging(
  sessionId: string,
  script: Script,
  job: VideoJob | undefined,
  fromScratch: boolean,
  level: string,
) {
  const direction = anchoredDirection(job?.direction, script.lines);
  if (!job || fromScratch) {
    await createJob(sessionId, script.id, true, "idle", direction, freeToReplace);
    return;
  }
  const otherLevel = Boolean(job.plan && mediaLevel(job.level).id !== mediaLevel(level).id);
  const planMustBeRewritten = otherLevel || wishesChanged(job, direction);
  const restageFrom = planMustBeRewritten ? undefined : await restageBasis(job, script);
  const wordsChanged = !sameSpokenLines(job.lines, script.lines);
  const rewordedBasis = wordsChanged
    ? rewordedFrom(job, direction)
    : job.plan
      ? undefined
      : job.rewordedFrom;
  await createJob(sessionId, script.id, true, "idle", direction, freeToReplace, {
    restageFrom,
    rewordedFrom: rewordedBasis,
  });
}

export async function stagingOf(
  sessionId: string,
  scriptId: string,
): Promise<{ status: StagingStatus; reasons: OutdatedReason[] }> {
  await ensureLoaded();
  const job = jobs.get(keyOf(sessionId, scriptId));
  const { find, levelOf } = await boardNow(sessionId);
  const script = find(scriptId);
  if (!script) return { status: job && !videoUntouched(job) ? "started" : "none", reasons: [] };
  const level = levelOf(scriptId);
  return {
    status: stagingStatus(job, script, level),
    reasons: outdatedReasons(job, script, level),
  };
}

export async function stopStaging(sessionId: string, scriptId: string): Promise<null> {
  stagings.get(keyOf(sessionId, scriptId))?.abort();
  return null;
}

export async function assertStaged(sessionId: string, scriptIds: string[]): Promise<void> {
  for (const scriptId of scriptIds) {
    if ((await stagingOf(sessionId, scriptId)).status !== "ready") {
      throw new Error("Dàn dựng kịch bản trước khi tạo video");
    }
  }
}

export async function direct(
  sessionId: string,
  scriptId: string,
  change: { words?: string; want: string; at?: string },
): Promise<null> {
  await ensureLoaded();
  const key = keyOf(sessionId, scriptId);
  const current = jobs.get(key);
  if (current && !videoUntouched(current)) throw new Error("Video đã bắt đầu tạo");
  if (!current) {
    const direction = setDirection(undefined, change, nowIso());
    await createJob(sessionId, scriptId, true, "idle", direction, freeToReplace);
    return null;
  }
  stagings.get(key)?.abort();
  await update(key, (job) =>
    videoUntouched(job)
      ? { ...job, direction: setDirection(job.direction, change, nowIso()) }
      : job,
  );
  return null;
}

async function committedOrThrow(sessionId: string, scriptId: string) {
  const ws = await getWorkspace();
  const session = ws.sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error("Không tìm thấy phiên này");
  assertCommitted(session, (await getBoard(sessionId)).scripts, scriptId);
}

async function removeJob(key: string) {
  const job = jobs.get(key);
  if (!job || !unstarted(job)) return;
  jobs.delete(key);
  await writes.get(key)?.catch(() => undefined);
  writes.delete(key);
  await rm(jobDir(job), { recursive: true, force: true });
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("video:job-removed", {
      sessionId: job.sessionId,
      scriptId: job.scriptId,
    });
  }
}

async function syncScripts(sessionId: string, scripts: Script[]) {
  await ensureLoaded();
  const ws = await getWorkspace();
  const session = ws.sessions.find((s) => s.id === sessionId);
  const series = ws.series.find((s) => s.id === session?.seriesId);
  for (const job of [...jobs.values()]) {
    if (job.sessionId !== sessionId) continue;
    const script = scripts.find((s) => s.id === job.scriptId);
    await followScriptNow(job, script, videoLevel(session, series, job.scriptId), ws.assets);
  }
}

async function followScriptNow(
  job: VideoJob,
  script: Script | undefined,
  level: string,
  all: readonly Asset[],
) {
  const key = jobKey(job);
  const { abort, step } = freeSettle(job, script, level);
  if (abort) stagings.get(key)?.abort();
  try {
    if (step === "remove") await removeJob(key);
    if (step === "level") {
      const atLevel = planAtLevel(job, level);
      const next = atLevel && (await update(key, (j) => (j === job ? withSpeech(atLevel) : j)));
      if (next?.live) await writeJsonAtomic(join(jobDir(next), "live-plan.json"), next.live);
    }
    if (step === "product" && script) {
      const followed = followProduct(job, script, productOf(all), cutoutsOf(all));
      if (followed.kind !== "patched") {
        console.log(`[video] product change leaves the staging outdated (${followed.why})`);
        return;
      }
      const next = await update(key, (j) => (j === job ? withSpeech(followed.job) : j));
      if (!next?.plan) return;
      await writeJsonAtomic(join(jobDir(next), "plan.json"), next.plan);
      if (next.live) await writeJsonAtomic(join(jobDir(next), "live-plan.json"), next.live);
      await followScriptNow(next, script, level, all);
    }
  } catch (error) {
    console.warn("[video] could not follow the script:", (error as Error).message);
  }
}

const productOf = (all: readonly Asset[]) => (id: string) => {
  const a = all.find((x) => x.id === id && x.kind === "product");
  return a ? { id: a.id, name: a.name } : null;
};

const cutoutsOf = (all: readonly Asset[]) => (id: string) => {
  const a = all.find((x) => x.id === id);
  return a ? cutoutsToMake(a) : 0;
};

async function plannedBasis(job: VideoJob): Promise<RestageBasis | undefined> {
  const { plan, live, productIds } = job;
  if (!plan || !live || plan.source !== "ai" || !productIds) return undefined;
  try {
    const saved = JSON.parse(
      await readFile(join(jobDir(job), "shot-list.json"), "utf8"),
    ) as ShotList;
    const list: ShotList = { ...saved, shots: plan };
    if (!listFitsPlan(list, live.plan)) return undefined;
    return { lines: job.lines, productIds, level: mediaLevel(job.level).id, list };
  } catch {
    return undefined;
  }
}

async function restageBasis(job: VideoJob, script: Script): Promise<RestageBasis | undefined> {
  const basis = job.plan ? await plannedBasis(job) : job.restageFrom;
  if (!basis || basis.productIds.join("|") !== script.productIds.join("|")) return undefined;
  const edit = classifyScriptEdit(basis.lines, spokenLines(script.lines));
  if (edit.kind === "full") {
    console.log(`[video] script edit stages again in full (${edit.why})`);
    return undefined;
  }
  return basis;
}

export async function followScript(sessionId: string, scriptId: string): Promise<void> {
  await ensureLoaded();
  const job = jobs.get(keyOf(sessionId, scriptId));
  if (!job) return;
  const { ws, find, levelOf } = await boardNow(sessionId);
  await followScriptNow(job, find(scriptId), levelOf(scriptId), ws.assets);
}

export async function followLevel(sessionId: string): Promise<void> {
  await syncScripts(sessionId, (await getBoard(sessionId)).scripts);
}

export async function videoStarted(sessionId: string, scriptId: string): Promise<boolean> {
  await ensureLoaded();
  const job = jobs.get(keyOf(sessionId, scriptId));
  return Boolean(job && !unstarted(job));
}

export async function changesInPlace(
  sessionId: string,
  scriptId: string,
  sent: boolean,
): Promise<boolean> {
  await ensureLoaded();
  return editsInPlace(sent, jobs.get(keyOf(sessionId, scriptId)));
}

export async function runAll(sessionId: string): Promise<null> {
  await ensureLoaded();
  const ws = await getWorkspace();
  const session = ws.sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error("Không tìm thấy phiên này");
  const { board, levelOf, find } = await boardNow(sessionId);
  const available = await availabilityIn(session.seriesId);
  for (const scriptId of committedIds(session, board.scripts)) {
    const key = keyOf(sessionId, scriptId);
    const script = find(scriptId);
    const toMake = (job: VideoJob | undefined) =>
      Boolean(script && readyToMake(job, script, levelOf(scriptId)));
    if (!toMake(jobs.get(key))) continue;
    await update(key, (job) =>
      toMake(job) ? runThrough(spendingStarts(available(job), nowIso()), nowIso()) : job,
    );
  }
  return null;
}

const jobOf = async (sessionId: string, scriptId: string) => {
  await ensureLoaded();
  const job = jobs.get(keyOf(sessionId, scriptId));
  if (!job) throw new Error("Kịch bản này chưa có video");
  return job;
};

export async function priceFix(sessionId: string, scriptId: string, changes: FixChange[]) {
  const job = await jobOf(sessionId, scriptId);
  return {
    priceUsd: fixPriceUsd(job, changes, nowIso()),
    ...fixScope(job, changes, nowIso()),
    rev: job.rev ?? 0,
  };
}

export async function fix(
  sessionId: string,
  scriptId: string,
  changes: FixChange[],
  rev?: number,
  version?: string,
): Promise<null> {
  const job = await jobOf(sessionId, scriptId);
  await committedOrThrow(sessionId, scriptId);
  if (rev !== undefined && rev !== (job.rev ?? 0)) {
    throw new Error("Video đã thay đổi sau đề xuất này");
  }
  const run = (j: VideoJob) =>
    applyFix(version ? focusVersion(j, version, nowIso()) : j, changes, nowIso());
  run(job);
  await update(keyOf(sessionId, scriptId), run);
  return null;
}

export async function restore(
  sessionId: string,
  scriptId: string,
  version?: string,
): Promise<null> {
  const job = await jobOf(sessionId, scriptId);
  const run = (j: VideoJob) =>
    restorePrevious(version ? focusVersion(j, version, nowIso()) : j, nowIso());
  run(job);
  await update(keyOf(sessionId, scriptId), run);
  return null;
}

export async function version(
  sessionId: string,
  scriptId: string,
  action: "start" | "use" | "delete" | "focus",
  version: string,
): Promise<null> {
  const job = await jobOf(sessionId, scriptId);
  const key = keyOf(sessionId, scriptId);
  if (action === "start") await committedOrThrow(sessionId, scriptId);
  if (action === "delete") {
    const { files } = deleteVersion(job, version, nowIso());
    await update(key, (j) => deleteVersion(j, version, nowIso()).job);
    for (const file of files) await rm(join(jobDir(job), file), { force: true });
    return null;
  }
  const run = (j: VideoJob) =>
    action === "start"
      ? startVersion(j, version, nowIso())
      : action === "use"
        ? chooseVersion(j, version, nowIso())
        : focusVersion(j, version, nowIso());
  run(job);
  await update(key, run);
  return null;
}

export async function jobFor(sessionId: string, scriptId: string): Promise<VideoJob | null> {
  await ensureLoaded();
  return jobs.get(keyOf(sessionId, scriptId)) ?? null;
}

export async function stop(sessionId: string, scriptId: string): Promise<null> {
  await ensureLoaded();
  const key = keyOf(sessionId, scriptId);
  await update(key, (job) => stopJob(job, nowIso()));
  void withdrawAll(key, { cancel: falCancelUnlessStarted });
  return null;
}

type WithdrawOutcome = (job: VideoJob, request: SentRequest, outcome: CancelOutcome) => unknown;

const currentJob = (key: string) => jobs.get(key) ?? abandoned.get(key);

function cancelSent(job: VideoJob, step: JobStep, cancel: Canceller): Promise<CancelOutcome> {
  const nothingSent = Promise.resolve<CancelOutcome>("removed");
  if ("frame" in step) {
    const frame = job.frames.find((f) => f.id === step.frame);
    return frame ? cancelFrame(frame, cancel) : nothingSent;
  }
  if ("shot" in step) {
    const shot = job.shots.find((s) => s.index === step.shot);
    return shot ? cancelShot(job, shot, cancel) : nothingSent;
  }
  if ("segment" in step) {
    const segment = job.segments?.find((s) => s.id === step.segment);
    return segment ? cancelSegment(segment, cancel) : nothingSent;
  }
  const sound = job.sounds?.find((s) => s.id === step.sound);
  return sound ? soundMaker(job).cancel(sound, cancel) : nothingSent;
}

interface Withdrawal {
  cancel: Canceller;
  onOutcome?: WithdrawOutcome;
}

function withdraw(key: string, step: JobStep, { cancel, onOutcome }: Withdrawal): Promise<void> {
  return occupyWhenFree(`${key}|${stepKey(step)}`, async () => {
    const job = currentJob(key);
    const request = job && !makingVideo(job) ? sentRequestOf(job, step) : null;
    if (!job || !request) return;
    const outcome = await cancelSent(job, step, cancel);
    if (outcome === "removed") {
      await update(key, (j) => requestWithdrawn(j, step, request.requestId));
    }
    await onOutcome?.(job, request, outcome);
  });
}

async function withdrawAll(key: string, withdrawal: Withdrawal): Promise<void> {
  const job = currentJob(key);
  const results = await Promise.allSettled(
    (job ? stepsOut(job) : []).map((step) => withdraw(key, step, withdrawal)),
  );
  for (const result of results) {
    if (result.status === "rejected") console.warn("[video] withdraw:", result.reason);
  }
}

async function logAbandoned(job: VideoJob, request: SentRequest, outcome: CancelOutcome) {
  if (!mayStillBeBilled(outcome)) return;
  await logUsage({
    provider: "fal",
    purpose: "video-abandoned",
    requestId: request.requestId,
    cost: request.usd,
    costIsEstimate: true,
    abandoned: true,
    sessionId: job.sessionId,
    scriptId: job.scriptId,
  });
}

const ABANDON_WAIT_MS = 4000;

export async function retryShot(sessionId: string, scriptId: string, shot: number): Promise<null> {
  await ensureLoaded();
  await committedOrThrow(sessionId, scriptId);
  await update(keyOf(sessionId, scriptId), (job) => retryShotState(job, shot, nowIso()));
  return null;
}

export async function setTempo(sessionId: string, scriptId: string, tempo: unknown): Promise<null> {
  await ensureLoaded();
  const chosen = tempoOf(tempo);
  await update(keyOf(sessionId, scriptId), ({ tempo: _old, ...job }) =>
    chosen === 1 ? job : { ...job, tempo: chosen },
  );
  return null;
}

export async function abandonSessions(sessionIds: readonly string[]): Promise<void> {
  await ensureLoaded();
  const keys = [...jobs]
    .filter(([, job]) => sessionIds.includes(job.sessionId))
    .map(([key]) => key);
  for (const key of keys) {
    stagings.get(key)?.abort();
    await update(key, (job) => stopJob(job, nowIso()));
  }
  const withdrawals = keys.map((key) =>
    withdrawAll(key, { cancel: falCancel, onOutcome: logAbandoned }),
  );
  const deadline = Date.now() + ABANDON_WAIT_MS;
  await settledWithin(ABANDON_WAIT_MS, withdrawals);
  for (const key of keys) {
    const job = jobs.get(key);
    if (job) abandoned.set(key, job);
    jobs.delete(key);
  }
  await settledWithin(
    Math.max(0, deadline - Date.now()),
    keys.map((key) => writes.get(key)),
  );
  for (const key of keys) writes.delete(key);
  noticeMaking();
  void Promise.allSettled(withdrawals).then(() => {
    for (const key of keys) abandoned.delete(key);
  });
}

export async function saveFinal(sessionId: string, scriptId: string): Promise<string | null> {
  const working = jobs.get(keyOf(sessionId, scriptId));
  const job = working && chosenView(working);
  if (!job?.final) throw new Error("Video chưa xong");
  const safe = (job.title || "video")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .trim()
    .slice(0, 80);
  const options: Electron.SaveDialogOptions = {
    title: "Tải video xuống",
    defaultPath: `${safe || "video"}.mp4`,
    filters: [{ name: "Video", extensions: ["mp4"] }],
  };
  const win = BrowserWindow.getFocusedWindow();
  const result = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return null;
  const destination = result.filePath;
  const source = join(jobDir(job), job.final);
  const tempo = tempoOf(job.tempo);
  if (tempo === 1) await copyFile(source, destination);
  else
    await renderedAtTempo(source, tempo, dirname(destination), (rendered) =>
      rename(rendered, destination),
    );
  try {
    const inputs = await frameInputs(job);
    await saveLook(job, jobDir(job), await assets(), inputs?.place);
  } catch (error) {
    console.error("[video] could not save the series look", error);
  }
  await keepMaterial(job);
  return result.filePath;
}

async function renderedAtTempo(
  source: string,
  tempo: Tempo,
  folder: string,
  place: (rendered: string) => Promise<void>,
): Promise<void> {
  const rendered = join(folder, `.${randomUUID()}.mp4.tmp`);
  try {
    await atTempo(source, tempo, rendered);
    await place(rendered);
  } finally {
    await rm(rendered, { force: true });
  }
}

async function deliverWithoutOverwriting(
  source: string,
  tempo: Tempo,
  folder: string,
  base: string,
  taken: Set<string>,
): Promise<void> {
  if (tempo === 1) {
    await placeWithoutOverwriting(folder, base, taken, (target) =>
      copyFile(source, target, constants.COPYFILE_EXCL),
    );
    return;
  }
  await renderedAtTempo(source, tempo, folder, (rendered) =>
    placeWithoutOverwriting(folder, base, taken, (target) => link(rendered, target)),
  );
}

async function placeWithoutOverwriting(
  folder: string,
  base: string,
  taken: Set<string>,
  place: (target: string) => Promise<void>,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const name = freeFileName(base, taken);
    taken.add(sameFileName(name));
    try {
      await place(join(folder, name));
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error(`No free file name for ${base}`);
}

const keepMaterial = (job: VideoJob) =>
  markVideoKept(job).catch((error) => console.error("[material] could not mark kept", error));

async function keepLook(working: VideoJob): Promise<void> {
  const job = chosenView(working);
  try {
    const inputs = await frameInputs(job);
    await saveLook(job, jobDir(job), await assets(), inputs?.place);
  } catch (error) {
    console.error("[video] could not save the series look", error);
  }
}

export async function saveFinals(
  sessionId: string,
  picks: ExportPick[],
): Promise<{ folder: string; failed: ExportPick[] } | null> {
  if (!Array.isArray(picks)) throw new Error("Chưa chọn video");
  await ensureLoaded();
  const board = await getBoard(sessionId);
  const own = new Map(
    [...jobs.values()].filter((j) => j.sessionId === sessionId).map((j) => [j.scriptId, j]),
  );
  const { files, unknown } = exportPlan(exportableVideos(board.scripts, own), picks);
  if (!files.length) throw new Error(unknown.length ? "Video chưa xong" : "Chưa chọn video");
  const options: Electron.OpenDialogOptions = {
    title: "Chọn thư mục lưu video",
    buttonLabel: "Lưu vào đây",
    properties: ["openDirectory", "createDirectory"],
  };
  const win = BrowserWindow.getFocusedWindow();
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  const folder = result.filePaths[0];
  if (result.canceled || !folder) return null;
  const taken = new Set((await readdir(folder)).map(sameFileName));
  const failed: ExportPick[] = [...unknown];
  const lookFrom = new Set<string>();
  for (const file of files) {
    const job = own.get(file.scriptId) as VideoJob;
    try {
      await deliverWithoutOverwriting(
        join(jobDir(job), file.final),
        tempoOf(job.tempo),
        folder,
        file.base,
        taken,
      );
      if (file.inUse) lookFrom.add(file.scriptId);
    } catch (error) {
      console.error(`[video] could not save video #${file.number}`, error);
      failed.push({ scriptId: file.scriptId, version: file.version });
    }
  }
  for (const scriptId of lookFrom) await keepLook(own.get(scriptId) as VideoJob);
  for (const scriptId of lookFrom) await keepMaterial(own.get(scriptId) as VideoJob);
  return { folder, failed };
}

const POLL_MS = { live: 5000, fixture: 1000 };

function pump() {
  if (!loaded || !accepting) return;
  const all = [...jobs.values()];

  const next = pickNext(all);
  if (next && next.status === "waiting") {
    void update(jobKey(next), (job) =>
      job.status === "waiting" ? { ...job, status: "running", phaseStartedAt: nowIso() } : job,
    );
    return;
  }

  const pollEvery = POLL_MS[providerMode()];
  for (const job of all) {
    const key = jobKey(job);
    if (waitingForNetwork(job, Date.now())) continue;
    for (const action of nextActions(job, busyFor(key))) {
      const busyKey = `${key}|${actionKey(action)}`;
      if (
        action.kind === "poll-shot" ||
        action.kind === "poll-frame" ||
        action.kind === "poll-sound" ||
        action.kind === "poll-segment"
      ) {
        if (Date.now() - (lastPoll.get(busyKey) ?? 0) < pollEvery) continue;
        lastPoll.set(busyKey, Date.now());
      }
      void occupy(busyKey, () => perform(key, action)).catch((error) =>
        console.error("[video]", action.kind, error),
      );
    }
  }
}

function occupy<T>(busyKey: string, work: () => Promise<T>): Promise<T> {
  busy.add(busyKey);
  const running = work().finally(() => {
    busy.delete(busyKey);
    if (inProgress.get(busyKey) === settled) inProgress.delete(busyKey);
    schedule();
  });
  const settled = running.then(
    () => undefined,
    () => undefined,
  );
  inProgress.set(busyKey, settled);
  return running;
}

async function occupyWhenFree<T>(busyKey: string, work: () => Promise<T>): Promise<T> {
  for (let current = inProgress.get(busyKey); current; current = inProgress.get(busyKey)) {
    await current;
  }
  return occupy(busyKey, work);
}

function busyFor(key: string): Set<string> {
  const prefix = `${key}|`;
  return new Set([...busy].filter((b) => b.startsWith(prefix)).map((b) => b.slice(prefix.length)));
}

async function perform(key: string, action: JobAction): Promise<void> {
  const job = jobs.get(key);
  if (!job) return;
  switch (action.kind) {
    case "plan":
      return runPlan(key, job, new AbortController().signal);
    case "voice":
      return runVoice(key, job);
    case "frame":
      return runFrame(key, job, action.frame);
    case "poll-frame":
      return runPollFrame(key, job, action.frame);
    case "submit-shot":
      return runSubmitShot(key, job, action.index);
    case "poll-shot":
      return runPollShot(key, job, action.index);
    case "submit-sound":
      return runSubmitSound(key, job, action.sound);
    case "poll-sound":
      return runPollSound(key, job, action.sound);
    case "submit-segment":
      return runSubmitSegment(key, job, action.segment);
    case "poll-segment":
      return runPollSegment(key, job, action.segment);
    case "assemble":
      return runAssemble(key, job);
  }
}

const fail = (key: string, error: unknown) =>
  update(key, (job) => ({ ...job, status: "failed", error: (error as Error).message }));

async function offline(key: string, error: unknown): Promise<boolean> {
  if (!isNetworkError(error)) return false;
  const message = error instanceof Error ? error.message : String(error);
  const cause = (error as { cause?: { code?: string } })?.cause?.code;
  console.warn(`[video] offline, will retry: ${message}${cause ? ` (${cause})` : ""}`);
  await update(key, (j) => wentOffline(j, message, Date.now()));
  return true;
}

async function online(key: string) {
  if (jobs.get(key)?.offline) await update(key, backOnline);
}

async function assets(): Promise<Asset[]> {
  return (await getWorkspace()).assets;
}

const seriesStaged = (job: VideoJob) => () =>
  [...jobs.values()].filter(
    (j) => j.seriesId === job.seriesId && j.plan && jobKey(j) !== jobKey(job),
  );

async function runPlan(key: string, job: VideoJob, signal: AbortSignal) {
  const startedAt = Date.now();
  let releaseScene: () => void = () => undefined;
  try {
    await mkdir(jobDir(job), { recursive: true });
    const { level } = await batchNow(job);
    const { material, release } = await stagingMaterial(job, level, seriesStaged(job), signal);
    releaseScene = release;
    let shown = "";
    const onSteps = (steps: string[]) => {
      const now = steps.join("\n");
      if (now === shown) return;
      shown = now;
      void update(key, (j) => (j.plan ? j : { ...j, planningSteps: steps }));
    };
    const { plan, live } = await directJob(
      { ...job, level },
      jobDir(job),
      onSteps,
      signal,
      material,
    );
    const script = (await getBoard(job.sessionId)).scripts.find((s) => s.id === job.scriptId);
    if (signal.aborted || (job.planning && stagingOutdated(job, script))) {
      console.log(`[video] ${job.scriptId}: staging dropped, the script changed`);
      return;
    }
    await writeJsonAtomic(join(jobDir(job), "plan.json"), plan);
    if (live) await writeJsonAtomic(join(jobDir(job), "live-plan.json"), live);
    measured("plan", (Date.now() - startedAt) / 1000);
    const all = await assets();
    const available = await availabilityIn(job.seriesId);
    const withCutouts = (j: VideoJob): VideoJob => ({
      ...j,
      frames: j.frames.map((f) => {
        const product = f.kind === "product" && all.find((a) => a.id === f.productId);
        return product ? { ...f, cutouts: cutoutsToMake(product) } : f;
      }),
    });
    await update(key, (j) => {
      if (j.plan || j.createdAt !== job.createdAt) return j;
      const { planningSteps: _, restageFrom: __, rewordedFrom: from, ...rest } = j;
      const applied = live ? applyLivePlan(rest, live) : applyPlan(rest, plan);
      const planned = from ? { ...applied, reworded: reworded(from, applied.shots) } : applied;
      const model = modelLocked(j) ? j.model : mediaLevel(level).speaker;
      const staging = available(
        withSpeech({
          ...withCutouts(planned),
          stagedDirection: job.direction ?? [],
          level,
          model,
          resolution: live
            ? mediaLevel(level).output
            : fitResolution(model, mediaLevel(level).output),
          ...(live && !j.reviewed ? { pause: true } : {}),
          phaseStartedAt: nowIso(),
        }),
      );
      return staging.status === "idle" ? staging : withFirstPass(staging, nowIso());
    });
  } catch (error) {
    if (signal.aborted || error instanceof StagingStopped) return;
    await fail(key, error);
  } finally {
    releaseScene();
  }
}

async function runVoice(key: string, job: VideoJob) {
  if (isNative(job)) return runSpeechTimeline(key, job);
  const dir = jobDir(job);
  const startedAt = Date.now();
  try {
    await assertFfmpegBeforeAnyPaidStep();
    await mkdir(dir, { recursive: true });
    let current = job;
    let timing: Awaited<ReturnType<typeof generateVoice>>["timing"];
    if (!current.dialogue || !current.lineSpans) {
      const dialogue = revFile(current, "dialogue", "mp3");
      const result = await generateVoice(current, await assets(), join(dir, dialogue));
      await online(key);
      timing = result.timing;
      const saved = await update(key, (j) => ({
        ...charged(
          j,
          "voice",
          STEP.voice,
          { usd: result.costUsd, billed: false },
          result.requestId,
        ),
        dialogue,
        dialogueSec: result.seconds,
        voiceCostUsd: result.costUsd,
        voiceChars: result.chars,
        lineSpans: result.spans,
      }));
      if (!saved) return;
      current = saved;
      measured("voice", (Date.now() - startedAt) / 1000);
    } else {
      timing = await savedTiming(
        join(dir, `${current.dialogue}.timing.json`),
        current.lines.length,
      );
    }
    await placeShots(key, current, timing);
  } catch (error) {
    if (await offline(key, error)) return;
    await fail(key, error);
  }
}

async function placeShots(
  key: string,
  current: VideoJob,
  timing: Awaited<ReturnType<typeof generateVoice>>["timing"],
  speech?: SpeechTimeline,
) {
  const dir = jobDir(current);
  const total = current.dialogueSec ?? 0;
  const planned = current.shots.map((s) => ({ line: s.lineIndex, text: s.text, hold: s.hold }));
  const spoken = shotTimes(planned, current.lineSpans ?? [], total, timing);
  const { times } = withHolds(spoken, planned);
  const inputs: ShotInput[] = [];
  for (const [i, shot] of current.shots.entries()) {
    const time = times[i] as { start: number; end: number };
    if (!madeByProvider(shot)) {
      const piece = shot.speech && speech?.pieces.find((p) => p.segment === shot.speech);
      const words = spoken[i] as { start: number; end: number };
      inputs.push(piece ? { ...time, cutFrom: cutFrom(piece, words.start) } : time);
      continue;
    }
    const audio = revFile(current, `audio-${String(i + 1).padStart(2, "0")}`, "mp3");
    if (shot.kind === "listener") {
      await silence(Math.max(MIN_SHOT_SEC, time.end - time.start), join(dir, audio));
    } else {
      const words = spoken[i] as { start: number; end: number };
      await cutLine(
        join(dir, current.dialogue as string),
        words,
        join(dir, audio),
        Math.max(MIN_SHOT_SEC, words.end - words.start + (shot.hold ?? 0)),
      );
    }
    inputs.push({ ...time, audio, audioSec: await probeSeconds(join(dir, audio)) });
  }
  await update(key, (j) => ({
    ...withJobSounds(withShotAudio(j, inputs)),
    phaseStartedAt: nowIso(),
  }));
}

async function runSpeechTimeline(key: string, job: VideoJob) {
  const dir = jobDir(job);
  try {
    await assertFfmpegBeforeAnyPaidStep();
    const segments = job.segments ?? [];
    const heard = segments.flatMap((s) =>
      s.clip && s.clipSec && s.speech
        ? [{ id: s.id, line: s.line, text: s.text, clipSec: s.clipSec, speech: s.speech }]
        : [],
    );
    if (!segments.length || heard.length !== segments.length) throw new Error("Thiếu lời nói");
    const timeline = speechTimeline(heard, job.lines.length);
    let current = job;
    if (!current.dialogue) {
      const dialogue = revFile(current, "dialogue", "mp3");
      const work = join(dir, "speech-work");
      await rm(work, { recursive: true, force: true });
      await mkdir(work, { recursive: true });
      const clipOf = (id: string) => segments.find((s) => s.id === id)?.clip as string;
      await joinSpeech(
        timeline.pieces.map((p) => ({
          clip: join(dir, clipOf(p.segment)),
          from: p.from,
          to: p.to,
        })),
        work,
        join(dir, dialogue),
      );
      await rm(work, { recursive: true, force: true }).catch(() => undefined);
      const saved = await update(key, (j) => ({
        ...j,
        dialogue,
        dialogueSec: timeline.dialogueSec,
        lineSpans: timeline.lineSpans,
      }));
      if (!saved) return;
      current = saved;
    }
    await placeShots(key, current, timeline.timing, timeline);
  } catch (error) {
    await fail(key, error);
  }
}

async function savedTiming(path: string, lineCount: number) {
  try {
    const saved = JSON.parse(await readFile(path, "utf8"));
    const segments = (saved.voiceSegments ?? []) as {
      dialogueInputIndex: number;
      characterStartIndex: number;
      characterEndIndex: number;
    }[];
    if (!saved.alignment?.characters?.length) return undefined;
    const lineChars = [];
    for (let i = 0; i < lineCount; i++) {
      const mine = segments.filter((s) => s.dialogueInputIndex === i);
      if (!mine.length) return undefined;
      lineChars.push({
        start: Math.min(...mine.map((s) => s.characterStartIndex)),
        end: Math.max(...mine.map((s) => s.characterEndIndex)),
      });
    }
    return { alignment: saved.alignment, lineChars };
  } catch {
    return undefined;
  }
}

async function frameInputs(job: VideoJob): Promise<FrameInputs | null> {
  const ws = await getWorkspace();
  const series = ws.series.find((s) => s.id === job.seriesId);
  const place = series?.environmentIds
    .map((id) => ws.assets.find((a) => a.id === id))
    .find((a): a is Asset => Boolean(a?.images.length));
  if (!place || !job.plan) return null;
  const wide = job.frames.find((f) => f.kind === "wide");
  const cast = new Map(ws.assets.filter((a) => a.kind === "character").map((a) => [a.id, a]));
  const look = await readLook(job.seriesId);
  const lookPaths = new Map<string, string>();
  for (const seat of job.plan.seats) {
    const character = cast.get(seat.characterId);
    const file = character && lookStill(look, seat, character, place);
    if (file) lookPaths.set(seat.characterId, lookPath(job.seriesId, file));
  }
  return {
    plan: job.plan,
    place,
    cast,
    widePath: wide?.file ? join(jobDir(job), wide.file) : undefined,
    lookPaths,
    productNames: ws.assets.filter((a) => a.kind === "product").map((a) => a.name),
  };
}

const patchFrameOf = (key: string, frameId: string) => (patch: Partial<JobFrame>) =>
  update(key, (j) => ({
    ...j,
    frames: j.frames.map((f) => (f.id === frameId ? { ...f, ...patch } : f)),
  }));

async function markSending(key: string, step: JobStep): Promise<VideoJob | null> {
  return update(key, (j) => withSending(j, step, randomUUID()));
}

async function sendMarked(key: string, job: VideoJob, frameId: string, inputs: FrameInputs) {
  const marked = (await markSending(key, { frame: frameId }))?.frames.find((f) => f.id === frameId);
  if (!marked) return;
  const sent = await sendFrame(job, marked, inputs);
  await patchFrameOf(key, frameId)({ ...sent, submittedAt: nowIso(), sending: undefined });
}

const frameFile = (job: VideoJob, frame: JobFrame) =>
  revFile(job, `still-${frame.id.replace(/[^a-z0-9-]+/gi, "-")}`, "png");

async function runFrame(key: string, job: VideoJob, frameId: string) {
  const frame = job.frames.find((f) => f.id === frameId);
  if (!frame) return;
  const patchFrame = patchFrameOf(key, frameId);
  const dir = jobDir(job);
  const running = () => jobs.get(key)?.status === "running";
  try {
    if (isNative(job)) await assertFfmpegBeforeAnyPaidStep();
    await mkdir(dir, { recursive: true });
    const all = await assets();
    if (frame.kind === "product") {
      const product = all.find((a) => a.id === frame.productId);
      const photo = product?.images[0];
      if (!product || !photo) throw new Error("Sản phẩm chưa có ảnh");
      const inputs = isGenerated(job, frame) ? await frameInputs(job) : null;
      if (inputs?.widePath) {
        let cutout = frame.cutout;
        if (!cutout) {
          const made = await productCutout(product, dir, running).catch((error): CutoutResult => {
            if (isNetworkError(error) || error instanceof CutoutStopped) throw error;
            console.warn("[video] product cut-out failed:", (error as Error).message);
            const paid = error instanceof CutoutTimedOut ? error.paid : [];
            return { file: null, inUse: null, paid };
          });
          cutout = made.file ?? undefined;
          await update(key, (j) => cutoutRecorded(j, frameId, made));
        }
        if (cutout) {
          if (jobs.get(key)?.status !== "running") return;
          await sendMarked(key, job, frameId, inputs);
          await online(key);
          return;
        }
      }
      const file = frameFile(job, frame);
      await productStill(
        join(assetDir(product.id), photo.file),
        join(dir, file),
        outputSize(job.resolution),
      );
      await patchFrame({ file, source: "photo" });
      return;
    }
    const inputs = job.useEnvironment ? await frameInputs(job) : null;
    if (!inputs) {
      const character = all.find((a) => a.id === frame.characterId);
      if (!character) throw new Error("Không tìm thấy nhân vật");
      const file = await coverFrame(character, dir);
      await patchFrame({ file, source: "cover" });
      return;
    }
    if (await takenFromMaterial(key, job, frame)) return;
    const kept = frame.kind === "character" && inputs.lookPaths?.get(frame.characterId ?? "");
    if (kept && !frame.note && !planned(job, frame)) {
      const file = frameFile(job, frame);
      await copyFile(kept, join(dir, file));
      await patchFrame({ file, source: "look" });
      return;
    }
    if (jobs.get(key)?.status !== "running") return;
    await sendMarked(key, job, frameId, inputs);
    await online(key);
  } catch (error) {
    if (error instanceof CutoutStopped) return;
    if (providerBusy(error)) {
      await update(key, (j) => stepThrew(j, { frame: frameId }, error, Date.now()));
      return;
    }
    if (isNetworkError(error)) {
      await offline(key, error);
      return;
    }
    await frameFailed(key, frameId, (error as Error).message);
  }
}

const planned = plannedFrame;

const mayTakeFromMaterial = (job: VideoJob, frame: JobFrame) =>
  planned(job, frame) && Boolean(frame.material) && !frame.fresh && !frame.note;

async function takenFromMaterial(key: string, job: VideoJob, frame: JobFrame): Promise<boolean> {
  const item = mayTakeFromMaterial(job, frame)
    ? await storedPicture(job.seriesId, frame.material as string)
    : undefined;
  const patchFrame = patchFrameOf(key, frame.id);
  if (!item) {
    if (frame.materialFile) await patchFrame({ materialFile: undefined });
    return false;
  }
  const file = frameFile(job, frame);
  await placeMaterialFile(job.seriesId, item, join(jobDir(job), file));
  await patchFrame({ file, source: "material", materialFile: undefined });
  await recordUse(job.seriesId, item.id, job, nowIso());
  return true;
}

const mayReplayClip = (job: VideoJob, shot: JobShot, frame: JobFrame) =>
  Boolean(job.live) &&
  shot.route === "motion" &&
  !shot.fallback &&
  frame.source === "material" &&
  Boolean(frame.material) &&
  !frame.fresh;

const shotClipFile = (job: VideoJob, index: number) =>
  revFile(job, `shot-${String(index + 1).padStart(2, "0")}`, "mp4");

const doneShot = (job: VideoJob, index: number, made: Partial<JobShot>): VideoJob => {
  const done = {
    ...job,
    shots: job.shots.map((s) =>
      s.index === index ? { ...s, ...made, state: "done" as const } : s,
    ),
  };
  return jobPhase(done) === "assemble"
    ? { ...done, phaseStartedAt: nowIso(), assembleProgress: 0 }
    : done;
};

async function replayedFromMaterial(
  key: string,
  job: VideoJob,
  shot: JobShot,
  frame: JobFrame,
): Promise<boolean> {
  const item =
    mayReplayClip(job, shot, frame) && shot.end !== undefined && shot.start !== undefined
      ? await storedClip(job, frame.material as string, {
          seconds: shot.end - shot.start,
          motion: plannedMotion(job, shot),
        })
      : undefined;
  if (!item) {
    if (shot.materialClip) {
      await update(key, (j) => ({
        ...j,
        shots: j.shots.map((s) => (s.index === shot.index ? withoutMaterialClip(s) : s)),
      }));
    }
    return false;
  }
  const clip = shotClipFile(job, shot.index);
  await placeMaterialFile(job.seriesId, item, join(jobDir(job), clip));
  const clipSec = await probeSeconds(join(jobDir(job), clip));
  await update(key, (j) =>
    doneShot(j, shot.index, { clip, clipSec, reused: item.id, materialClip: undefined }),
  );
  await recordUse(job.seriesId, item.id, job, nowIso());
  return true;
}

function withoutMaterialClip(shot: JobShot): JobShot {
  const { materialClip: _, ...rest } = shot;
  return rest;
}

function cutoutRecorded(job: VideoJob, frameId: string, made: CutoutResult): VideoJob {
  const step = STEP.cutout(frameId);
  const paid = made.paid.reduce((j, c) => charged(j, "cutout", step, c, c.requestId), job);
  const inUse = made.inUse
    ? { cutoutCostUsd: made.inUse.usd, cutoutBilled: made.inUse.billed }
    : {};
  return {
    ...paid,
    frames: paid.frames.map((f) => {
      if (f.id !== frameId) return f;
      return made.file ? { ...f, cutout: made.file, ...inUse } : { ...f, noCutout: true };
    }),
  };
}

async function liveFiles(job: VideoJob): Promise<LiveFiles> {
  const ws = await getWorkspace();
  const series = ws.series.find((s) => s.id === job.seriesId);
  const place = series?.environmentIds
    .map((id) => ws.assets.find((a) => a.id === id))
    .find((a): a is Asset => Boolean(a?.images.length));
  const cast = castOf(job.lines)
    .map((id) => ws.assets.find((a) => a.id === id))
    .filter((a): a is Asset => Boolean(a));
  return { place, cast, dir: jobDir(job) };
}

async function sendFrame(
  job: VideoJob,
  frame: JobFrame,
  inputs: FrameInputs,
): Promise<{ requestId: string; endpoint?: string }> {
  if (planned(job, frame)) return submitLiveFrame(job, frame, await liveFiles(job));
  return { requestId: await submitFrame(job, frame, inputs) };
}

async function frameFailed(key: string, frameId: string, message: string) {
  const next = await update(key, (j) => stepReportedFailure(j, { frame: frameId }, message));
  const frame = next?.frames.find((f) => f.id === frameId);
  if (frame?.fallback && !frame.retried)
    console.warn(`[video] keyframe ${frame.keyframe} falls back:`, message);
}

async function fixtureStill(job: VideoJob, frame: JobFrame): Promise<string | undefined> {
  const all = await assets();
  if (frame.kind === "character") {
    const character = all.find((a) => a.id === frame.characterId);
    const cover = character?.images[0];
    return character && cover ? join(assetDir(character.id), cover.file) : undefined;
  }
  const inputs = await frameInputs(job);
  const image = inputs?.place.images[frame.kind === "wide" ? 0 : 1] ?? inputs?.place.images[0];
  return inputs && image ? join(assetDir(inputs.place.id), image.file) : undefined;
}

async function runPollFrame(key: string, job: VideoJob, frameId: string) {
  const frame = job.frames.find((f) => f.id === frameId);
  if (!frame?.requestId) return;
  let url = frame.resultUrl;
  if (!url) {
    if (requestOverdue("still", frame.submittedAt, Date.now())) {
      const outcome = await cancelFrame(frame);
      await update(key, (j) =>
        chargedIfStillBilled(
          outcome,
          j,
          "still",
          STEP.frame(frameId),
          frameUsd(j, frame),
          frame.requestId,
        ),
      );
      await frameFailed(key, frameId, timedOutMessage("still"));
      return;
    }
    let result: StepPoll;
    try {
      result = await (frame.endpoint ? pollLiveFrame(job, frame) : pollFrame(job, frame));
    } catch (error) {
      await pollThrew(key, { frame: frameId }, error);
      return;
    }
    await online(key);
    if (result.state === "pending") return;
    if (result.state === "failed") {
      await frameFailed(key, frameId, result.message);
      return;
    }
    url = result.url;
    const { cost } = result;
    await update(key, (j) => ({
      ...charged(j, "still", STEP.frame(frameId), cost, frame.requestId),
      frames: j.frames.map((f) =>
        f.id === frameId ? { ...f, resultUrl: url, costUsd: cost.usd, costBilled: cost.billed } : f,
      ),
    }));
    measured("frame", (Date.now() - Date.parse(frame.submittedAt ?? nowIso())) / 1000);
  }
  const plate =
    frame.kind === "product"
      ? revFile(job, `plate-${frame.id.replace(/[^a-z0-9-]+/gi, "-")}`, "png")
      : undefined;
  const file = frameFile(job, frame);
  const path = join(jobDir(job), plate ?? file);
  let problem: string | null;
  try {
    await download(url, path, { framePath: await fixtureStill(job, frame) });
    await online(key);
    problem = job.plan ? await checkStill(frame, path, job.plan, job.sessionId) : null;
    if (problem && !frame.redone && jobs.get(key)?.status === "running") {
      const rejected = problem;
      await update(key, (j) => ({
        ...j,
        frames: j.frames.map((f) => (f.id === frameId ? stillToDrawAgain(f, rejected) : f)),
      }));
      return;
    }
    if (plate) {
      await productStillOn(
        path,
        join(jobDir(job), frame.cutout as string),
        join(jobDir(job), file),
        outputSize(job.resolution),
      );
    }
  } catch (error) {
    if (await offline(key, error)) return;
    await frameFailed(key, frameId, resultFailure(error));
    return;
  }
  await update(key, (j) => {
    const done = {
      ...j,
      frames: j.frames.map((f) =>
        f.id === frameId
          ? {
              ...f,
              file,
              ...(plate ? { plate } : {}),
              source: "generated" as const,
              ...(problem ? { check: problem } : {}),
            }
          : f,
      ),
    };
    return jobPhase(done) === "shots" ? { ...done, phaseStartedAt: nowIso() } : done;
  });
}

async function pollThrew(key: string, step: JobStep, error: unknown) {
  if (await offline(key, error)) return;
  console.warn("[video] poll:", error);
  await update(key, (j) => stepReportedFailure(j, step, (error as Error).message || String(error)));
}

function resultFailure(error: unknown): string {
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number") return downloadFailedMessage(status);
  return unreadableResultMessage((error as Error).message || String(error));
}

async function batchNow(
  job: VideoJob,
): Promise<{ model: string; resolution: string; level: string }> {
  const ws = await getWorkspace();
  const session = ws.sessions.find((s) => s.id === job.sessionId);
  const series = ws.series.find((s) => s.id === job.seriesId);
  const level = videoLevel(session, series, job.scriptId);
  return { model: mediaLevel(level).speaker, resolution: mediaLevel(level).output, level };
}

async function saveModelAndSizeBeforeFirstSend(key: string, job: VideoJob) {
  if (modelLocked(job)) return job;
  const batch = await batchNow(job);
  return update(key, (j) => (modelLocked(j) ? j : { ...followBatch(j, batch), modelLocked: true }));
}

function stillQueuedToSend(key: string, index: number) {
  const latest = jobs.get(key);
  return latest?.status === "running" && latest.shots[index]?.state === "queued";
}

async function runSubmitShot(key: string, initial: VideoJob, index: number) {
  const job = await saveModelAndSizeBeforeFirstSend(key, initial);
  if (!job) return;
  const shot = job.shots[index];
  if (!shot || shot.end === undefined || shot.start === undefined) return;
  const dir = jobDir(job);
  const frame = frameFor(job, shot);
  try {
    if (!frame?.file) throw new Error("Thiếu khung hình");
    if (!stillQueuedToSend(key, index)) return;
    if (await replayedFromMaterial(key, job, shot, frame)) return;
    if (!madeByProvider(shot)) {
      const clip = revFile(job, `shot-${String(index + 1).padStart(2, "0")}`, "mp4");
      const spoken = shot.speech && job.segments?.find((g) => g.id === shot.speech)?.clip;
      if (shot.speech) {
        if (!spoken) throw new Error("Thiếu lời nói");
        await speechShotClip(
          join(dir, spoken),
          shot.cutFrom ?? 0,
          frameCount(shot.start, shot.end),
          join(dir, clip),
          outputSize(job.resolution),
        );
      } else if (frame.plate && frame.cutout) {
        await productClip(
          join(dir, frame.plate),
          join(dir, frame.cutout),
          frameCount(shot.start, shot.end),
          join(dir, clip),
          outputSize(job.resolution),
        );
      } else {
        await stillClip(
          join(dir, frame.file),
          frameCount(shot.start, shot.end),
          join(dir, clip),
          outputSize(job.resolution),
        );
      }
      const clipSec = await probeSeconds(join(dir, clip));
      await update(key, (j) => {
        const done = {
          ...j,
          shots: j.shots.map((s) =>
            s.index === index ? { ...s, state: "done" as const, clip, clipSec } : s,
          ),
        };
        return jobPhase(done) === "assemble"
          ? { ...done, phaseStartedAt: nowIso(), assembleProgress: 0 }
          : done;
      });
      return;
    }
    const marked = (await markSending(key, { shot: index }))?.shots[index];
    if (!marked) return;
    if (job.live && shot.route && !shot.fallback) {
      const sent = await submitLiveShot(
        job,
        marked,
        join(dir, frame.file),
        shot.audio ? join(dir, shot.audio) : undefined,
        dir,
      );
      await update(key, (j) => ({
        ...j,
        shots: j.shots.map((s) =>
          s.index === index
            ? { ...s, state: "rendering", ...sent, submittedAt: nowIso(), sending: undefined }
            : s,
        ),
      }));
      await online(key);
      return;
    }
    if (!shot.audio) throw new Error("Thiếu âm thanh");
    let still = join(dir, frame.file);
    if (shot.framing === "close" && !shot.keyframe) {
      const closer = join(dir, `close-${frame.file}`);
      await cropCloser(still, closer);
      still = closer;
    }
    const model = shotModel(job, shot);
    let audio = join(dir, shot.audio);
    if (model.minSec && (shot.audioSec ?? 0) < model.minSec) {
      const padded = join(dir, `min${model.minSec}-${shot.audio}`);
      await padAudio(audio, model.minSec, padded);
      audio = padded;
    }
    const requestId = await submitShot(job, marked, model, still, audio);
    await update(key, (j) => ({
      ...j,
      shots: j.shots.map((s) =>
        s.index === index
          ? {
              ...s,
              state: "rendering",
              model: model.id,
              requestId,
              submittedAt: nowIso(),
              sending: undefined,
            }
          : s,
      ),
    }));
    await online(key);
  } catch (error) {
    if (isNetworkError(error) && !providerBusy(error)) await offline(key, error);
    else await update(key, (j) => stepThrew(j, { shot: index }, error, Date.now()));
  }
}

async function runPollShot(key: string, job: VideoJob, index: number) {
  const shot = job.shots[index];
  if (!shot?.requestId) return;
  const dir = jobDir(job);
  let url = shot.resultUrl;
  if (!url) {
    if (requestOverdue("clip", shot.submittedAt, Date.now())) {
      const outcome = await cancelShot(job, shot);
      await update(key, (j) =>
        stepReportedFailure(
          chargedIfStillBilled(
            outcome,
            j,
            shotChargeKind(shot),
            STEP.shot(index),
            shotEstimateUsd(j, shot),
            shot.requestId,
          ),
          { shot: index },
          timedOutMessage("clip"),
        ),
      );
      return;
    }
    let result: StepPoll;
    try {
      result = await (shot.endpoint ? pollLiveShot(job, shot) : pollShot(job, shot));
    } catch (error) {
      await pollThrew(key, { shot: index }, error);
      return;
    }
    await online(key);
    if (result.state === "pending") return;
    if (result.state === "failed") {
      await update(key, (j) => stepReportedFailure(j, { shot: index }, result.message));
      return;
    }
    url = result.url;
    const { cost } = result;
    await update(key, (j) => ({
      ...charged(j, shotChargeKind(shot), STEP.shot(index), cost, shot.requestId),
      shots: j.shots.map((s) =>
        s.index === index
          ? { ...s, resultUrl: url, costUsd: cost.usd, costBilled: cost.billed }
          : s,
      ),
    }));
    measured("shot", (Date.now() - Date.parse(shot.submittedAt ?? nowIso())) / 1000);
  }
  const clip = revFile(job, `shot-${String(index + 1).padStart(2, "0")}`, "mp4");
  let clipSec: number;
  try {
    await download(url, join(dir, clip), {
      audioPath: shot.audio ? join(dir, shot.audio) : undefined,
      size: outputSize(job.resolution),
    });
    await online(key);
    clipSec = await probeSeconds(join(dir, clip));
  } catch (error) {
    if (await offline(key, error)) return;
    await update(key, (j) => stepReportedFailure(j, { shot: index }, resultFailure(error)));
    return;
  }
  if (await clipRejected(key, job, shot, url, clip)) return;
  await update(key, (j) => {
    const done = {
      ...j,
      shots: j.shots.map((s) =>
        s.index === index ? { ...s, state: "done" as const, clip, clipSec } : s,
      ),
    };
    return jobPhase(done) === "assemble"
      ? { ...done, phaseStartedAt: nowIso(), assembleProgress: 0 }
      : done;
  });
}

async function clipRejected(
  key: string,
  job: VideoJob,
  shot: JobShot,
  url: string,
  clip: string,
): Promise<boolean> {
  const frame = frameFor(job, shot);
  if (!frame?.file) return false;
  const dir = jobDir(job);
  const added = await clipAddedLettering({
    clipPath: join(dir, clip),
    stillPath: join(dir, frame.file),
    shot,
    sessionId: job.sessionId,
  });
  if (!added) return false;
  const number = String(shot.index + 1).padStart(2, "0");
  const setAside = revFile(job, `shot-${number}-rejected-${(shot.rejectedClips ?? 0) + 1}`, "mp4");
  await rename(join(dir, clip), join(dir, setAside));
  const next = await update(key, (j) => rejectClip(j, shot.index, url));
  const now = next?.shots[shot.index];
  const speaker = next && now ? speakerForNextClip(next, now) : null;
  console.log(
    `[video] shot ${shot.index + 1}: clip set aside as ${setAside} (${added}); now ${now?.state}${speaker ? ` on ${speaker}` : ""}, redos ${now?.autoRedos ?? 0} for the shot, ${next?.autoRedos ?? 0} for the video`,
  );
  return true;
}

const patchSegmentOf = (key: string, id: string) => (patch: Partial<JobSegment>) =>
  update(key, (j) => ({
    ...j,
    segments: j.segments?.map((s) => (s.id === id ? { ...s, ...patch } : s)),
  }));

const TOO_LONG_TO_SAY = "Câu thoại dài quá mức tạo được";

async function runSubmitSegment(key: string, initial: VideoJob, id: string) {
  const job = await saveModelAndSizeBeforeFirstSend(key, initial);
  if (!job) return;
  const segment = job.segments?.find((s) => s.id === id);
  const frame = job.frames.find((f) => f.id === segment?.frame);
  if (segment?.state !== "queued" || segment.requestId || !frame?.file) return;
  if (jobs.get(key)?.status !== "running") return;
  try {
    await assertFfmpegBeforeAnyPaidStep();
    const model = segmentModel(levelSpeech(job), segment);
    const seconds = segmentAskedSec(levelSpeech(job), segment);
    if (!model || !seconds) {
      await update(key, (j) => stepReportedFailure(j, { segment: id }, TOO_LONG_TO_SAY));
      return;
    }
    const character = (await assets()).find((a) => a.id === segment.characterId);
    const prompt = segmentPrompt(job, segment, character);
    const marked = (await markSending(key, { segment: id }))?.segments?.find((s) => s.id === id);
    if (!marked) return;
    const requestId = await submitSegment({
      job,
      segment: marked,
      model,
      seconds,
      stillPath: join(jobDir(job), frame.file),
      prompt,
    });
    await patchSegmentOf(
      key,
      id,
    )({
      state: "rendering",
      model: model.id,
      seconds,
      requestId,
      submittedAt: nowIso(),
      sending: undefined,
    });
    await online(key);
  } catch (error) {
    if (isNetworkError(error) && !providerBusy(error)) await offline(key, error);
    else await update(key, (j) => stepThrew(j, { segment: id }, error, Date.now()));
  }
}

const NO_SPEECH_HEARD = "Không nghe thấy lời nói trong cảnh quay";

async function runPollSegment(key: string, job: VideoJob, id: string) {
  const segment = job.segments?.find((s) => s.id === id);
  if (!segment?.requestId) return;
  const dir = jobDir(job);
  let url = segment.resultUrl;
  if (!url) {
    if (requestOverdue("clip", segment.submittedAt, Date.now())) {
      const outcome = await cancelSegment(segment);
      await update(key, (j) =>
        stepReportedFailure(
          chargedIfStillBilled(
            outcome,
            j,
            "speech",
            segmentStep(id),
            segmentEstimateUsd(levelSpeech(j), segment),
            segment.requestId,
          ),
          { segment: id },
          timedOutMessage("clip"),
        ),
      );
      return;
    }
    let result: StepPoll;
    try {
      result = await pollSegment(job, segment);
    } catch (error) {
      await pollThrew(key, { segment: id }, error);
      return;
    }
    await online(key);
    if (result.state === "pending") return;
    if (result.state === "failed") {
      await update(key, (j) => stepReportedFailure(j, { segment: id }, result.message));
      return;
    }
    url = result.url;
    const { cost } = result;
    await update(key, (j) => ({
      ...charged(j, "speech", segmentStep(id), cost, segment.requestId),
      segments: j.segments?.map((s) =>
        s.id === id ? { ...s, resultUrl: url, costUsd: cost.usd, costBilled: cost.billed } : s,
      ),
    }));
    measured("shot", (Date.now() - Date.parse(segment.submittedAt ?? nowIso())) / 1000);
  }
  const frame = job.frames.find((f) => f.id === segment.frame);
  const clip = revFile(job, `speech-${id}`, "mp4");
  const attempt = (segment.rejectedClips ?? 0) + (segment.cutOffs ?? 0) + 1;
  let clipSec: number;
  try {
    if (!frame?.file) throw new Error("Thiếu khung hình");
    await downloadSegment({
      url,
      job,
      segment,
      stillPath: join(dir, frame.file),
      out: join(dir, clip),
    });
    await online(key);
    clipSec = await probeSeconds(join(dir, clip));
  } catch (error) {
    if (await offline(key, error)) return;
    await update(key, (j) => stepReportedFailure(j, { segment: id }, resultFailure(error)));
    return;
  }
  const added = await clipAddedLettering({
    clipPath: join(dir, clip),
    stillPath: join(dir, frame.file),
    shot: { index: segmentAnchor(segment), rejectedClips: segment.rejectedClips },
    sessionId: job.sessionId,
  });
  if (added) {
    const setAside = revFile(job, `speech-${id}-rejected-${attempt}`, "mp4");
    await rename(join(dir, clip), join(dir, setAside));
    const next = await update(key, (j) => rejectSegmentClip(j, id, url));
    const now = next?.segments?.find((s) => s.id === id);
    console.log(
      `[video] speech ${id}: clip set aside as ${setAside} (${added}); now ${now?.state}`,
    );
    return;
  }
  let speech: Awaited<ReturnType<typeof heardSpeech>>;
  try {
    speech = await heardSpeech(join(dir, clip), clipSec);
  } catch (error) {
    await update(key, (j) => stepReportedFailure(j, { segment: id }, resultFailure(error)));
    return;
  }
  if (!speech) {
    await update(key, (j) => stepReportedFailure(j, { segment: id }, NO_SPEECH_HEARD));
    return;
  }
  const cutOff = speechCutOff(speech, clipSec);
  if (cutOff) {
    const setAside = revFile(job, `speech-${id}-cut-${attempt}`, "mp4");
    await rename(join(dir, clip), join(dir, setAside));
    console.log(`[video] speech ${id}: speech runs to the end, asked again longer`);
  }
  await update(key, (j) => {
    const heard = segmentHeard(j, id, url, { clip, clipSec, speech, cutOff });
    return jobPhase(heard) === "voice" ? { ...heard, phaseStartedAt: nowIso() } : heard;
  });
}

const patchSoundOf = (key: string, id: string) => (patch: Partial<JobSound>) =>
  update(key, (j) => ({
    ...j,
    sounds: j.sounds?.map((s) => (s.id === id ? { ...s, ...patch } : s)),
  }));

async function soundFailed(key: string, id: string, message: string) {
  const next = await update(key, (j) => stepReportedFailure(j, { sound: id }, message));
  const sound = next?.sounds?.find((s) => s.id === id);
  console.warn(
    `[video] sound ${id} failed (${message}); ${sound?.dropped ? "the video goes without it" : "one more try"}`,
  );
}

async function runSubmitSound(key: string, job: VideoJob, id: string) {
  const sound = job.sounds?.find((s) => s.id === id);
  if (!sound || !soundToSend(sound) || jobs.get(key)?.status !== "running") return;
  const marked = (await markSending(key, { sound: id }))?.sounds?.find((s) => s.id === id);
  if (!marked) return;
  try {
    const { requestId } = await soundMaker(job).submit(job, marked);
    await patchSoundOf(key, id)({ requestId, submittedAt: nowIso(), sending: undefined });
  } catch (error) {
    await soundFailed(key, id, (error as Error).message || String(error));
  }
}

async function runPollSound(key: string, job: VideoJob, id: string) {
  const sound = job.sounds?.find((s) => s.id === id);
  if (!sound?.requestId || sound.file || sound.dropped) return;
  const maker = soundMaker(job);
  const overdue = requestOverdue("sound", sound.submittedAt, Date.now());
  let url = sound.resultUrl;
  if (!url) {
    if (overdue) {
      const outcome = await maker.cancel(sound);
      await update(key, (j) =>
        chargedIfStillBilled(
          outcome,
          j,
          "sound",
          STEP.sound(id),
          asksUsd(jobSoundSource(j), [sound]),
          sound.requestId,
        ),
      );
      await soundFailed(key, id, timedOutMessage("sound"));
      return;
    }
    let result: StepPoll;
    try {
      result = await maker.poll(job, sound);
    } catch (error) {
      if (isNetworkError(error)) return;
      await soundFailed(key, id, (error as Error).message || String(error));
      return;
    }
    if (result.state === "pending") return;
    if (result.state === "failed") {
      await soundFailed(key, id, result.message);
      return;
    }
    url = result.url;
    const { cost } = result;
    await update(key, (j) => ({
      ...charged(j, "sound", STEP.sound(id), cost, sound.requestId),
      sounds: j.sounds?.map((s) =>
        s.id === id ? { ...s, resultUrl: url, costUsd: cost.usd, costBilled: cost.billed } : s,
      ),
    }));
  }
  const file = revFile(job, `sound-${id.replace(/[^a-z0-9-]+/gi, "-")}`, "mp3");
  try {
    await maker.download(url, sound, join(jobDir(job), file));
    const fileSec = await probeSeconds(join(jobDir(job), file));
    await patchSoundOf(key, id)({ file, fileSec, error: undefined });
  } catch (error) {
    if (isNetworkError(error) && !overdue) return;
    await soundFailed(key, id, resultFailure(error));
  }
}

async function soundLayers(job: VideoJob, shots: JobShot[], totalSec: number) {
  const dir = jobDir(job);
  const layers = job.sounds?.length
    ? jobSoundSource(job).layers(jobSoundCues(job), job.sounds)
    : [];
  const mixed = [];
  for (const placed of placeLayers(layers, totalSec)) {
    const { layer } = placed;
    const clip = layer.kind === "clip" ? shots.find((s) => s.index === layer.shot)?.clip : null;
    const path = layer.kind === "file" ? join(dir, layer.file) : clip ? join(dir, clip) : null;
    if (!path) continue;
    const measuredLufs = await integratedLufs(path).catch(() => Number.NEGATIVE_INFINITY);
    if (audible(measuredLufs)) mixed.push({ path, mix: { placed, measuredLufs } });
  }
  return mixed;
}

async function runAssemble(key: string, job: VideoJob) {
  const dir = jobDir(job);
  const work = join(dir, "assembly");
  const startedAt = Date.now();
  let lastShare = -1;
  const progress = (share: number) => {
    if (share - lastShare < 0.04 && share < 1) return;
    lastShare = share;
    void update(key, (j) => (j.final ? j : { ...j, assembleProgress: share }));
  };
  try {
    await assertFfmpegBeforeAnyPaidStep();
    await rm(work, { recursive: true, force: true });
    await mkdir(work, { recursive: true });
    const shots = [...job.shots].sort((a, b) => a.index - b.index);
    const exact: string[] = [];
    for (const [i, shot] of shots.entries()) {
      const out = join(work, `clip-${String(i + 1).padStart(2, "0")}.mp4`);
      await exactClip(
        join(dir, shot.clip as string),
        frameCount(shot.start ?? 0, shot.end ?? 0),
        out,
        outputSize(job.resolution),
      );
      exact.push(out);
      progress(((i + 1) / shots.length) * 0.5);
    }
    const inserts = holdInserts(
      shots.map((s) => ({ line: s.lineIndex, hold: s.hold, end: s.end })),
    );
    const offsets = lineOffsets(job.lines.length, inserts);
    const total =
      job.dialogueSec !== undefined ? job.dialogueSec + holdsSec(shots) : (shots.at(-1)?.end ?? 0);
    let dialogue = join(dir, job.dialogue as string);
    if (inserts.length) {
      const held = join(work, "dialogue-held.mp3");
      await insertSilence(dialogue, job.dialogueSec ?? 0, inserts, held);
      dialogue = held;
    }
    const assFile = join(work, "subtitles.ass");
    const saved = await savedTiming(join(dir, `${job.dialogue}.timing.json`), job.lines.length);
    const timing = saved && heldTiming(saved, offsets);
    const spans = job.lines.map((_, i) => {
      const mine = shots.filter((s) => s.lineIndex === i);
      if (job.lineSpans?.[i]) return heldSpans([job.lineSpans[i]], [offsets[i] ?? 0])[0];
      if (!mine.length) return undefined;
      return {
        start: Math.min(...mine.map((s) => s.start ?? 0)),
        end: Math.max(...mine.map((s) => s.end ?? 0)),
      };
    });
    const cues = wordCues(job.lines, spans, timing);
    await writeFile(assFile, buildAss(cues, outputSize(job.resolution)), "utf8");
    const soundtrack = join(work, "soundtrack.wav");
    const voiceOnly = { voice: dialogue, layers: [], totalSec: total, out: soundtrack };
    const layers = await soundLayers(job, shots, total).catch((error) => {
      console.warn("[video] sounds left out:", (error as Error).message);
      return [];
    });
    await mixSoundtrack({ ...voiceOnly, layers }).catch((error) => {
      if (!layers.length) throw error;
      console.warn("[video] sounds left out of the mix:", (error as Error).message);
      return mixSoundtrack(voiceOnly);
    });
    const tmp = join(work, "final.mp4");
    await assembleOverDialogue(
      exact,
      soundtrack,
      assFile,
      join(work, "clips.txt"),
      tmp,
      total,
      (share) => progress(0.5 + share * 0.5),
    );
    const final = revFile(job, "final", "mp4");
    await rename(tmp, join(dir, final));
    const finalSec = await probeSeconds(join(dir, final));
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
    measured("assemble", (Date.now() - startedAt) / 1000);
    await update(key, (j) => ({
      ...j,
      final,
      finalSec,
      cutRev: j.rev ?? 0,
      assembleProgress: undefined,
    }));
  } catch (error) {
    await fail(key, error);
  }
}
