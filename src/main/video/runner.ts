import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BrowserWindow, dialog } from "electron";
import { batchMediaLevel, outputSize } from "../../shared/batch-settings";
import {
  anchoredDirection,
  type DirectionEntry,
  jobStale,
  setDirection,
} from "../../shared/direction";
import type { Asset, Script } from "../../shared/ipc";
import { mediaLevel } from "../../shared/media-level";
import { isNetworkError, providerBusy } from "../../shared/net-error";
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
import {
  castOf,
  heldSpans,
  heldTiming,
  holdInserts,
  lineOffsets,
  shotTimes,
  withHolds,
} from "../../shared/shot-plan";
import { buildAss, wordCues } from "../../shared/subtitles";
import {
  applyFix,
  type FixChange,
  fixPriceUsd,
  fixScope,
  restorePrevious,
} from "../../shared/video-fix";
import {
  actionKey,
  addUsd,
  applyLivePlan,
  applyPlan,
  backOnline,
  followBatch,
  frameFor,
  holdsSec,
  isGenerated,
  type JobAction,
  type JobFrame,
  type JobStep,
  jobPhase,
  MIN_SHOT_SEC,
  madeByProvider,
  migrateJob,
  modelLocked,
  newJob,
  nextActions,
  nextAverage,
  pickNext,
  plannedFrame,
  resumeJob,
  resumesOnStart,
  retryNetworkNow,
  retryShot as retryShotState,
  revFile,
  runThrough,
  type StepAverages,
  settle,
  shotModel,
  spentUsd,
  spokenLines,
  stepReportedFailure,
  stepThrew,
  stopJob,
  type VideoJob,
  waitingForNetwork,
  wentOffline,
  withShotAudio,
} from "../../shared/video-job";
import { DEFAULT_VIDEO_MODEL, fitResolution } from "../../shared/video-models";
import { chooseTake, chosenView, deleteTake, focusTake, startTake } from "../../shared/video-takes";
import { getBoard, onBoardChanged } from "../board";
import { assetDir } from "../media";
import { dataFile, mediaDir, removeStaleTmp, writeJsonAtomic } from "../paths";
import { providerMode } from "../providers";
import { getWorkspace } from "../store";
import { textAiIsOwn } from "../text-ai";
import { openFalRequests } from "../usage";
import { checkStill } from "./checks";
import { directJob } from "./director";
import {
  assembleOverDialogue,
  assertFfmpeg,
  cropCloser,
  cutLine,
  exactClip,
  frameCount,
  insertSilence,
  padAudio,
  probeSeconds,
  productStill,
  silence,
  stillClip,
} from "./ffmpeg";
import { lookPath, lookStill, readLook, saveLook } from "./look";
import { CutoutStopped, productClip, productCutout, productStillOn } from "./product-shot";
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

// Runs video jobs in the main process (docs/VIDEO_GENERATION_DECISIONS.md).
// Each job's state is job.json in its folder, written atomically after every
// change, so navigating away, quitting or crashing never loses a paid result:
// on start, unfinished jobs continue, saved request ids are polled and files
// on disk are reused. One video runs at a time; every shot of it that has
// what it needs is sent to fal at once (fal queues what is over the account's
// limit), local shots one at a time. Progress goes to the renderer as "video:job".

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
let timer: NodeJS.Timeout | null = null;
let loaded: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// Step averages for the time estimate, per provider mode.
// ---------------------------------------------------------------------------

const DEFAULT_AVERAGES: Record<"live" | "fixture", StepAverages> = {
  live: { plan: 70, voice: 25, frame: 45, shot: 150, assemble: 20 },
  fixture: { plan: 3, voice: 4, frame: 4, shot: 8, assemble: 5 },
};
let averages: Record<"live" | "fixture", StepAverages> | null = null;

async function loadAverages() {
  try {
    const saved = JSON.parse(await readFile(dataFile(AVERAGES_FILE), "utf8"));
    // Per mode, so steps added later keep their default.
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

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

function emit(job: VideoJob) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("video:job", { job, averages: currentAverages() });
  }
}

/** Applies a change to the latest copy, settles it, saves it and tells the renderer. */
async function update(key: string, change: (job: VideoJob) => VideoJob): Promise<VideoJob | null> {
  const current = jobs.get(key);
  if (!current) return null; // Session deleted meanwhile.
  const next = settle({ ...change(current), updatedAt: nowIso() });
  jobs.set(key, next);
  await save(key, next);
  emit(next);
  schedule();
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
  // Paid requests fal accepted whose ids never reached job.json (closed mid-send).
  const open = await openFalRequests();
  for (const session of ws.sessions) {
    const dir = join(mediaDir(session.seriesId, session.id), "videos");
    const names = await readdir(dir).catch(() => [] as string[]);
    for (const name of names) {
      const folder = join(dir, name);
      // Leftovers of writes cut off by a quit or crash; job.json itself is never partial.
      await removeStaleTmp(folder);
      let raw: string;
      try {
        raw = await readFile(join(folder, JOB_FILE), "utf8");
      } catch {
        continue; // Not a job folder.
      }
      try {
        let job = migrateJob(JSON.parse(raw));
        // A plan interrupted by a restart is made again when asked.
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
}

function ensureLoaded() {
  loaded ??= loadAll();
  return loaded;
}

/** On app start: continue unfinished jobs, never starting ones that were not started. */
export async function startRunner(): Promise<void> {
  await ensureLoaded();
  const resumed = [...jobs.values()].filter(resumesOnStart);
  if (resumed.length) console.log(`[video] resuming ${resumed.length} job(s)`);
  timer ??= setInterval(pump, TICK_MS);
  unwatchBoard ??= onBoardChanged((sessionId, board) => {
    void syncScripts(sessionId, board.scripts);
  });
  schedule();
}

let unwatchBoard: (() => void) | null = null;

export function stopRunner() {
  if (timer) clearInterval(timer);
  timer = null;
  unwatchBoard?.();
  unwatchBoard = null;
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    pump();
  }, 50);
}

// ---------------------------------------------------------------------------
// Operator actions
// ---------------------------------------------------------------------------

export async function jobsFor(sessionId: string): Promise<VideoJob[]> {
  await ensureLoaded();
  // Scripts written before staging was automatic get theirs when the session opens.
  if (!autoTimers.has(sessionId)) scheduleAutoPlan(sessionId);
  return [...jobs.values()].filter((j) => j.sessionId === sessionId);
}

/** What each script said when it was last planned by itself: a plan that failed is not tried in a loop. */
const autoTried = new Map<string, string>();
const autoTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** A burst of edits is planned once, after it. */
const AUTO_PLAN_DELAY_MS = 3000;

function scheduleAutoPlan(sessionId: string) {
  clearTimeout(autoTimers.get(sessionId));
  autoTimers.set(
    sessionId,
    setTimeout(() => {
      autoTimers.delete(sessionId);
      void autoPlan(sessionId).catch((error) =>
        console.warn("[video] automatic staging:", (error as Error).message),
      );
    }, AUTO_PLAN_DELAY_MS),
  );
}

/**
 * Every written script gets its staging without being asked, approved or not
 * (free: the user's own AI, whose own limit caps how many at once). "Lên dàn
 * dựng" stays as the way to try again after a failure.
 */
async function autoPlan(sessionId: string) {
  if (!textAiIsOwn()) return;
  await ensureLoaded();
  const board = await getBoard(sessionId);
  for (const script of board.scripts) {
    if (script.deletedAt || script.status !== "ready") continue;
    const spoken = spokenLines(script.lines);
    if (!spoken.length) continue;
    const key = keyOf(sessionId, script.id);
    const job = jobs.get(key);
    if (job && (job.plan || !unstarted(job))) continue;
    // A job made again (plan dropped: script or level changed) is staged again.
    const said = JSON.stringify([
      spoken.map((l) => [l.characterId, l.text]),
      script.productIds,
      job?.createdAt ?? null,
    ]);
    if (autoTried.get(key) === said) continue;
    autoTried.set(key, said);
    void planOnly(sessionId, script.id).catch((error) =>
      console.warn("[video] automatic staging:", (error as Error).message),
    );
  }
}

async function createJob(
  sessionId: string,
  scriptId: string,
  test = false,
  /**
   * "idle": made only to be planned; it waits for its hold. Only such a job
   * may exist for a script not committed yet (planning is free), once written.
   */
  status?: "idle",
  /** The operator's direction, kept when the job is made again. */
  direction?: DirectionEntry[],
  replaces: (current: VideoJob | undefined) => boolean = (current) => !current,
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
  const job = newJob({
    sessionId,
    seriesId: session.seriesId,
    scriptId,
    title: script.title,
    lines: script.lines,
    useEnvironment,
    // Experiment branch: the user chooses a Media level, not a model. Without a
    // live plan the fixed pipeline uses the default speaking model.
    model: DEFAULT_VIDEO_MODEL,
    resolution: fitResolution(
      DEFAULT_VIDEO_MODEL,
      mediaLevel(batchMediaLevel(session, series).id).output,
    ),
    now: nowIso(),
  });
  if (job.lines.length === 0) throw new Error("Kịch bản không có lời thoại");
  // Follows the batch until it is planned (src/main/video/runner.ts, runPlan).
  job.level = batchMediaLevel(session, series).id;
  if (status) job.status = status;
  job.productIds = [...script.productIds];
  if (direction?.length) job.direction = direction;
  // A video made on its own while its series has none yet is the test video:
  // it stops once after the cheap steps (docs/VIDEO_REVIEW_DECISIONS.md).
  // The pause ends for good once a video of the series has been kept (downloaded).
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

const freeToReplace = (current: VideoJob | undefined) => !current || unstarted(current);

const ignoreInUse = (error: unknown) => {
  if (!(error instanceof JobInUse)) throw error;
};

/** Jobs for newly committed scripts; scripts that already have one are left alone. */
export async function enqueue(sessionId: string, scriptIds: string[]): Promise<void> {
  await ensureLoaded();
  const fresh = scriptIds.filter((id) => !jobs.has(keyOf(sessionId, id)));
  for (const scriptId of fresh) {
    await createJob(sessionId, scriptId, fresh.length === 1).catch(ignoreInUse);
  }
  schedule();
}

/** Starts a committed script without a job, or continues a stopped or failed one. */
export async function start(sessionId: string, scriptId: string): Promise<null> {
  await ensureLoaded();
  await committedOrThrow(sessionId, scriptId);
  const key = keyOf(sessionId, scriptId);
  const current = jobs.get(key);
  if (current?.planning) throw new Error("Đang lên dàn dựng");
  // Waiting for the connection: try again now instead.
  if (current?.offline && (current.status === "running" || current.status === "waiting")) {
    await update(key, (job) => retryNetworkNow(job, Date.now()));
    return null;
  }
  if (!current) await createJob(sessionId, scriptId, true).catch(ignoreInUse);
  await update(key, (job) => resumeJob(job, nowIso()));
  return null;
}

/**
 * Experiment branch: the plan now, before any hold, so it is shown with its
 * prices. Free (the user's own AI); runs beside the queue, never in it. The
 * video then waits, idle, for its hold.
 */
export async function planOnly(sessionId: string, scriptId: string): Promise<null> {
  await ensureLoaded();
  const key = keyOf(sessionId, scriptId);
  const had = jobs.get(key);
  if (!had || failedUnpaid(had)) {
    await createJob(sessionId, scriptId, true, "idle", had?.direction, (current) =>
      Boolean(!current || failedUnpaid(current)),
    ).catch(ignoreInUse);
  }
  const job = jobs.get(key);
  if (!job || job.plan || job.planning || job.status !== "idle") return null;
  const planning = await update(key, (j) => ({ ...j, planning: true }));
  if (!planning) return null;
  try {
    await runPlan(key, planning);
  } finally {
    await update(key, (j) => {
      const { planning: _, planningSteps: __, ...rest } = j;
      return rest;
    });
  }
  // The script may have changed while it was planned: that plan does not fit.
  await syncScripts(sessionId, (await getBoard(sessionId)).scripts);
  return null;
}

const failedUnpaid = (job: VideoJob) =>
  job.status === "failed" && !job.plan && !job.dialogue && spentUsd(job) === 0;

/**
 * Plans newly committed scripts that have none yet, in the background (free:
 * the user's own AI; the text AI's own limit caps how many at once).
 */
export function planCommitted(sessionId: string, scriptIds: string[]): void {
  if (!textAiIsOwn()) return;
  for (const scriptId of scriptIds) {
    void planOnly(sessionId, scriptId).catch((error) =>
      console.warn("[video] planning after approval:", (error as Error).message),
    );
  }
}

/**
 * The operator's wish for how a moment (`words`, a shot's exact words) or the
 * whole video is filmed. Saved on the job; while nothing is spent, the plan is
 * made again with it in the background (free, about a minute).
 */
export async function direct(
  sessionId: string,
  scriptId: string,
  change: { words?: string; want: string; at?: string },
): Promise<null> {
  await ensureLoaded();
  const key = keyOf(sessionId, scriptId);
  const current = jobs.get(key);
  if (current?.planning) throw new Error("Đang lên dàn dựng");
  if (current && !unstarted(current)) throw new Error("Video đã bắt đầu tạo");
  const direction = setDirection(current?.direction, change, nowIso());
  await createJob(sessionId, scriptId, true, "idle", direction, freeToReplace);
  void planOnly(sessionId, scriptId).catch((error) =>
    console.warn("[video] planning after a direction:", (error as Error).message),
  );
  return null;
}

/** Planned (or not yet) but nothing made or sent: the plan can be thrown away for free. */
const unstarted = (job: VideoJob) =>
  job.status === "idle" && !job.planning && !job.dialogue && spentUsd(job) === 0;

/**
 * The plan no longer fits the script (its product changed) or the batch (its
 * Media level changed): the video goes back to "Lên kế hoạch", with the
 * script's lines as they are now. Refused once anything was made.
 */
export async function dropPlan(sessionId: string, scriptId: string): Promise<null> {
  await ensureLoaded();
  const job = jobs.get(keyOf(sessionId, scriptId));
  if (!job) return null;
  if (!unstarted(job)) throw new Error("Video đã bắt đầu tạo");
  const script = (await getBoard(sessionId)).scripts.find((s) => s.id === scriptId);
  await createJob(
    sessionId,
    scriptId,
    true,
    "idle",
    anchoredDirection(job.direction, script?.lines ?? []),
    freeToReplace,
  );
  autoTried.delete(keyOf(sessionId, scriptId));
  scheduleAutoPlan(sessionId);
  return null;
}

/** Spending needs a committed script (src/shared/ready-check.ts). */
async function committedOrThrow(sessionId: string, scriptId: string) {
  const ws = await getWorkspace();
  const session = ws.sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error("Không tìm thấy phiên này");
  assertCommitted(session, (await getBoard(sessionId)).scripts, scriptId);
}

/** A job nothing was spent on goes, with its folder. */
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

/**
 * After every board change: a video nothing was spent on follows its script.
 * Its script deleted, the job goes; its lines or products changed, the plan is
 * dropped and made again by itself, and only the wishes whose words are
 * still said are kept. It follows the batch's Media level the same way: a plan
 * made at another level is staged again at the level as it is now.
 */
async function syncScripts(sessionId: string, scripts: Script[]) {
  await ensureLoaded();
  const ws = await getWorkspace();
  const session = ws.sessions.find((s) => s.id === sessionId);
  const level = batchMediaLevel(
    session,
    ws.series.find((s) => s.id === session?.seriesId),
  ).id;
  const all = ws.assets;
  for (const job of [...jobs.values()]) {
    if (job.sessionId !== sessionId) continue;
    const script = scripts.find((s) => s.id === job.scriptId);
    await followScriptNow(job, script, level, all);
  }
  // Staging follows the script: a dropped plan, or a new script, is planned again.
  scheduleAutoPlan(sessionId);
}

/**
 * One unpaid video following its script. A product change on a planned video
 * whose words are unchanged (or changed only by the product's name) is
 * followed in code, with no new staging (src/shared/product-follow.ts);
 * anything else drops the plan, to be staged again. `force`: compare products
 * even on a job that did not record them (older jobs).
 */
async function followScriptNow(
  job: VideoJob,
  script: Script | undefined,
  level: string,
  all: readonly Asset[],
  force = false,
) {
  if (!unstarted(job)) return;
  const key = jobKey(job);
  try {
    if (!script || script.deletedAt) {
      await removeJob(key);
      return;
    }
    if (script.status !== "ready") return;
    const otherLevel = Boolean(job.plan && mediaLevel(job.level).id !== level);
    if (!otherLevel && !jobStale(job, script) && !(force && !job.productIds)) return;
    if (!otherLevel && job.plan) {
      const product = (id: string) => {
        const a = all.find((x) => x.id === id && x.kind === "product");
        return a ? { id: a.id, name: a.name } : null;
      };
      const cutouts = (id: string) => {
        const a = all.find((x) => x.id === id);
        return a ? cutoutsToMake(a) : 0;
      };
      const followed = followProduct(job, script, product, cutouts);
      if (followed.kind === "patched") {
        const next = await update(key, (j) => (j === job ? followed.job : j));
        if (next?.plan) {
          await writeJsonAtomic(join(jobDir(next), "plan.json"), next.plan);
          if (next.live) await writeJsonAtomic(join(jobDir(next), "live-plan.json"), next.live);
        }
        return;
      }
      // A product change that could not be followed in code: staged again, said in the log.
      if (job.productIds?.[0] !== script.productIds[0]) {
        console.log(`[video] product change staged again (${followed.why})`);
      }
    }
    // An older job with nothing planned has nothing to follow.
    if (!otherLevel && !jobStale(job, script) && !job.plan) return;
    const direction = anchoredDirection(job.direction, script.lines);
    // A script that can no longer be planned (no spoken line left) has no video.
    await createJob(job.sessionId, job.scriptId, true, "idle", direction, freeToReplace).catch(
      (error) => (error instanceof JobInUse ? undefined : removeJob(key)),
    );
  } catch (error) {
    console.warn("[video] could not follow the script:", (error as Error).message);
  }
}

/**
 * After a product change (or its undo) on the card or by the chat: the video
 * follows it now. While its staging runs, it follows when that lands
 * (`planOnly` syncs after every plan).
 */
export async function followScript(sessionId: string, scriptId: string): Promise<void> {
  await ensureLoaded();
  const job = jobs.get(keyOf(sessionId, scriptId));
  if (!job) {
    scheduleAutoPlan(sessionId);
    return;
  }
  const ws = await getWorkspace();
  const session = ws.sessions.find((s) => s.id === sessionId);
  const level = batchMediaLevel(
    session,
    ws.series.find((s) => s.id === session?.seriesId),
  ).id;
  const script = (await getBoard(sessionId)).scripts.find((s) => s.id === scriptId);
  await followScriptNow(job, script, level, ws.assets, true);
  scheduleAutoPlan(sessionId);
}

/**
 * The batch's (or its series') Media level changed: videos nothing was paid
 * for are staged again at the new level; the others keep theirs.
 */
export async function followLevel(sessionId: string): Promise<void> {
  await syncScripts(sessionId, (await getBoard(sessionId)).scripts);
}

/** Whether a script's video has started (anything made or spent, or a plan being made); false with no job. */
export async function videoStarted(sessionId: string, scriptId: string): Promise<boolean> {
  await ensureLoaded();
  const job = jobs.get(keyOf(sessionId, scriptId));
  return Boolean(job && !unstarted(job));
}

/**
 * Whether anything of a script's video was made, sent or spent; false with no
 * job, and false while only its staging is being made (that is free and
 * follows the script when it lands).
 */
export async function videoMade(sessionId: string, scriptId: string): Promise<boolean> {
  await ensureLoaded();
  const job = jobs.get(keyOf(sessionId, scriptId));
  return Boolean(job && !unstarted({ ...job, planning: false }));
}

/** "Lập lại": the plan made again at the batch's Media level as it is now (free, the user's AI). */
export async function replan(sessionId: string, scriptId: string): Promise<null> {
  await dropPlan(sessionId, scriptId);
  return planOnly(sessionId, scriptId);
}

/**
 * "Make everything" on the Video tab: every committed script of the session
 * runs to the end, with no stop at "Nghe và xem cảnh chính". New ones are never
 * test videos; finished videos are left alone.
 */
export async function runAll(sessionId: string): Promise<null> {
  await ensureLoaded();
  const ws = await getWorkspace();
  const session = ws.sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error("Không tìm thấy phiên này");
  const board = await getBoard(sessionId);
  for (const scriptId of committedIds(session, board.scripts)) {
    const key = keyOf(sessionId, scriptId);
    if (!jobs.has(key)) await createJob(sessionId, scriptId).catch(ignoreInUse);
    await update(key, (job) => runThrough(job, nowIso()));
  }
  return null;
}

const jobOf = async (sessionId: string, scriptId: string) => {
  await ensureLoaded();
  const job = jobs.get(keyOf(sessionId, scriptId));
  if (!job) throw new Error("Kịch bản này chưa có video");
  return job;
};

/** What a fix would make again and cost, without changing anything. */
export async function priceFix(sessionId: string, scriptId: string, changes: FixChange[]) {
  const job = await jobOf(sessionId, scriptId);
  return {
    priceUsd: fixPriceUsd(job, changes, nowIso()),
    ...fixScope(job, changes, nowIso()),
    rev: job.rev ?? 0,
  };
}

/**
 * Fixes a video in place: only what the changes touch is made again. `rev`
 * guards a proposal made for an earlier state of the video.
 */
export async function fix(
  sessionId: string,
  scriptId: string,
  changes: FixChange[],
  rev?: number,
  /** The take to fix (worked on first); default the one being worked on. */
  take?: string,
): Promise<null> {
  const job = await jobOf(sessionId, scriptId);
  await committedOrThrow(sessionId, scriptId);
  if (rev !== undefined && rev !== (job.rev ?? 0)) {
    throw new Error("Video đã thay đổi sau đề xuất này");
  }
  const run = (j: VideoJob) => applyFix(take ? focusTake(j, take, nowIso()) : j, changes, nowIso());
  // Throws before anything is saved when a change cannot be made.
  run(job);
  await update(keyOf(sessionId, scriptId), run);
  return null;
}

/** Back to the cut before the last fix (and forth again): free. */
export async function restore(sessionId: string, scriptId: string, take?: string): Promise<null> {
  const job = await jobOf(sessionId, scriptId);
  const run = (j: VideoJob) => restorePrevious(take ? focusTake(j, take, nowIso()) : j, nowIso());
  run(job);
  await update(keyOf(sessionId, scriptId), run);
  return null;
}

/**
 * Takes with another model: start one (it queues like any video), make one
 * "the video", delete one (its own files go, its cost stays), or work on one.
 */
export async function take(
  sessionId: string,
  scriptId: string,
  action: "start" | "use" | "delete" | "focus",
  model: string,
): Promise<null> {
  const job = await jobOf(sessionId, scriptId);
  const key = keyOf(sessionId, scriptId);
  if (action === "start") await committedOrThrow(sessionId, scriptId);
  if (action === "delete") {
    const { files } = deleteTake(job, model, nowIso());
    await update(key, (j) => deleteTake(j, model, nowIso()).job);
    for (const file of files) await rm(join(jobDir(job), file), { force: true });
    return null;
  }
  const run = (j: VideoJob) =>
    action === "start"
      ? startTake(j, model, nowIso())
      : action === "use"
        ? chooseTake(j, model, nowIso())
        : focusTake(j, model, nowIso());
  // Throws before anything is saved when the action cannot be done.
  run(job);
  await update(key, run);
  return null;
}

/** A job as the chat sees it. */
export async function jobFor(sessionId: string, scriptId: string): Promise<VideoJob | null> {
  await ensureLoaded();
  return jobs.get(keyOf(sessionId, scriptId)) ?? null;
}

export async function stop(sessionId: string, scriptId: string): Promise<null> {
  await ensureLoaded();
  await update(keyOf(sessionId, scriptId), (job) => stopJob(job, nowIso()));
  return null;
}

export async function retryShot(sessionId: string, scriptId: string, shot: number): Promise<null> {
  await ensureLoaded();
  await committedOrThrow(sessionId, scriptId);
  await update(keyOf(sessionId, scriptId), (job) => retryShotState(job, shot, nowIso()));
  return null;
}

/** The session is gone: forget its jobs (results already paid for stay with the provider). */
export function forgetSession(sessionId: string) {
  for (const [key, job] of jobs) if (job.sessionId === sessionId) jobs.delete(key);
}

export async function saveFinal(sessionId: string, scriptId: string): Promise<string | null> {
  const working = jobs.get(keyOf(sessionId, scriptId));
  // "The video" is the chosen take, which may be parked.
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
  await copyFile(join(jobDir(job), job.final), result.filePath);
  // Keeping a video teaches the series its look; never a reason to fail the download.
  try {
    const inputs = await frameInputs(job);
    await saveLook(job, jobDir(job), await assets(), inputs?.place);
  } catch (error) {
    console.error("[video] could not save the series look", error);
  }
  return result.filePath;
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

const POLL_MS = { live: 5000, fixture: 1000 };

function pump() {
  if (!loaded) return;
  const all = [...jobs.values()];

  // One video at a time: promote the next waiting job when nothing runs.
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
    // No connection: nothing starts before the next try.
    if (waitingForNetwork(job, Date.now())) continue;
    for (const action of nextActions(job, busyFor(key))) {
      const busyKey = `${key}|${actionKey(action)}`;
      if (action.kind === "poll-shot" || action.kind === "poll-frame") {
        if (Date.now() - (lastPoll.get(busyKey) ?? 0) < pollEvery) continue;
        lastPoll.set(busyKey, Date.now());
      }
      busy.add(busyKey);
      perform(key, action)
        .catch((error) => console.error("[video]", action.kind, error))
        .finally(() => {
          busy.delete(busyKey);
          schedule();
        });
    }
  }
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
      return runPlan(key, job);
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
    case "assemble":
      return runAssemble(key, job);
  }
}

const fail = (key: string, error: unknown) =>
  update(key, (job) => ({ ...job, status: "failed", error: (error as Error).message }));

/**
 * Network trouble (src/shared/net-error.ts): the step is left as it was, so
 * nothing counts as a failed attempt and saved request ids are kept; the job
 * tries again after a pause. Returns false for any other error.
 */
async function offline(key: string, error: unknown): Promise<boolean> {
  if (!isNetworkError(error)) return false;
  const message = error instanceof Error ? error.message : String(error);
  const cause = (error as { cause?: { code?: string } })?.cause?.code;
  console.warn(`[video] offline, will retry: ${message}${cause ? ` (${cause})` : ""}`);
  await update(key, (j) => wentOffline(j, message, Date.now()));
  return true;
}

/** A step reached the provider: the connection is back. */
async function online(key: string) {
  if (jobs.get(key)?.offline) await update(key, backOnline);
}

async function assets(): Promise<Asset[]> {
  return (await getWorkspace()).assets;
}

/** Directing pass: free (the user's own AI), before anything is paid for. */
async function runPlan(key: string, job: VideoJob) {
  const startedAt = Date.now();
  try {
    await mkdir(jobDir(job), { recursive: true });
    // The Media level is fixed here: the plan is made for it.
    const { level } = await batchNow(job);
    // What the director is doing, on the card; only when a line is added.
    let shown = "";
    const onSteps = (steps: string[]) => {
      const now = steps.join("\n");
      if (now === shown) return;
      shown = now;
      void update(key, (j) => (j.plan ? j : { ...j, planningSteps: steps }));
    };
    const { plan, live } = await directJob({ ...job, level }, jobDir(job), onSteps);
    await writeJsonAtomic(join(jobDir(job), "plan.json"), plan);
    if (live) await writeJsonAtomic(join(jobDir(job), "live-plan.json"), live);
    measured("plan", (Date.now() - startedAt) / 1000);
    const all = await assets();
    // Cut-outs a product shot may still need, for the price shown until it is made.
    const withCutouts = (j: VideoJob): VideoJob => ({
      ...j,
      frames: j.frames.map((f) => {
        const product = f.kind === "product" && all.find((a) => a.id === f.productId);
        return product ? { ...f, cutouts: cutoutsToMake(product) } : f;
      }),
    });
    await update(key, (j) => {
      if (j.plan) return j;
      const { planningSteps: _, ...rest } = j;
      const planned = live ? applyLivePlan(rest, live) : applyPlan(rest, plan);
      return {
        ...withCutouts(planned),
        level,
        // A live plan is made at its level's size; the fixed pipeline at what its model makes.
        resolution: live
          ? mediaLevel(level).output
          : fitResolution(j.model, mediaLevel(level).output),
        // Experiment branch: every planned video stops after voice and keyframes,
        // the cheap checkpoint, unless it was started to run through.
        ...(live && !j.reviewed ? { pause: true } : {}),
        phaseStartedAt: nowIso(),
      };
    });
  } catch (error) {
    await fail(key, error);
  }
}

async function runVoice(key: string, job: VideoJob) {
  const dir = jobDir(job);
  const startedAt = Date.now();
  try {
    // Free check first: no paid voice if the cuts cannot be made afterwards.
    await assertFfmpeg();
    await mkdir(dir, { recursive: true });
    let current = job;
    let timing: Awaited<ReturnType<typeof generateVoice>>["timing"];
    if (!current.dialogue || !current.lineSpans) {
      const dialogue = revFile(current, "dialogue", "mp3");
      const result = await generateVoice(current, await assets(), join(dir, dialogue));
      await online(key);
      timing = result.timing;
      const saved = await update(key, (j) => ({
        ...j,
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
    const total = current.dialogueSec ?? 0;
    const planned = current.shots.map((s) => ({ line: s.lineIndex, text: s.text, hold: s.hold }));
    // On the dialogue's own timeline, then with each hold's silence added after its line.
    const spoken = shotTimes(planned, current.lineSpans ?? [], total, timing);
    const { times } = withHolds(spoken, planned);
    const inputs: { start: number; end: number; audio?: string; audioSec?: number }[] = [];
    for (const [i, shot] of current.shots.entries()) {
      const time = times[i] as { start: number; end: number };
      if (!madeByProvider(shot)) {
        inputs.push(time);
        continue;
      }
      // The provider needs audio: the shot's own stretch of dialogue, or silence for a listener.
      // A hold is silence after the words, so the person stays alive through it.
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
    await update(key, (j) => ({ ...withShotAudio(j, inputs), phaseStartedAt: nowIso() }));
  } catch (error) {
    if (await offline(key, error)) return;
    await fail(key, error);
  }
}

/** The provider's character timing saved beside the dialogue, for cuts after a restart. */
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

/** Plan, place and cast for a job's generated stills. */
async function frameInputs(job: VideoJob): Promise<FrameInputs | null> {
  const ws = await getWorkspace();
  const series = ws.series.find((s) => s.id === job.seriesId);
  const place = series?.environmentIds
    .map((id) => ws.assets.find((a) => a.id === id))
    .find((a): a is Asset => Boolean(a?.images.length));
  if (!place || !job.plan) return null;
  const wide = job.frames.find((f) => f.kind === "wide");
  const cast = new Map(ws.assets.filter((a) => a.kind === "character").map((a) => [a.id, a]));
  // Stills kept from an earlier video of the series, where they still apply.
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

/**
 * Saves a fresh "being sent" mark on a still or shot before anything is paid.
 * The request's record carries the same mark, so a restart attaches the
 * request instead of paying again (src/shared/request-reconcile.ts). Null when
 * the job is gone.
 */
async function markSending(key: string, step: JobStep): Promise<VideoJob | null> {
  return update(key, (j) => withSending(j, step, randomUUID()));
}

/** Sends a still marked as being sent; the request id replaces the mark. */
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
    await mkdir(dir, { recursive: true });
    const all = await assets();
    // Products are never generated: their cut-out goes on a generated plate
    // of the spot; without a place or a usable cut-out, their own photo (free).
    if (frame.kind === "product") {
      const product = all.find((a) => a.id === frame.productId);
      const photo = product?.images[0];
      if (!product || !photo) throw new Error("Sản phẩm chưa có ảnh");
      const inputs = isGenerated(job, frame) ? await frameInputs(job) : null;
      if (inputs?.widePath) {
        let cutout = frame.cutout;
        if (!cutout) {
          // Never a reason to fail the video: without a cut-out the photo is used.
          const made = await productCutout(product, dir, running).catch((error) => {
            if (isNetworkError(error) || error instanceof CutoutStopped) throw error;
            console.warn("[video] product cut-out failed:", (error as Error).message);
            return null;
          });
          if (made) {
            cutout = made.file;
            await patchFrame({ cutout, costUsd: addUsd(frame.costUsd, made.costUsd) });
          } else {
            await patchFrame({ noCutout: true });
          }
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
      // No place: the character's cover photo (free).
      const character = all.find((a) => a.id === frame.characterId);
      if (!character) throw new Error("Không tìm thấy nhân vật");
      const file = await coverFrame(character, dir);
      await patchFrame({ file, source: "cover" });
      return;
    }
    // The series' kept look: reused as it is, unless the operator asked for a correction.
    // A planned keyframe is never replaced by it: its framing is the plan's.
    const kept = frame.kind === "character" && inputs.lookPaths?.get(frame.characterId ?? "");
    if (kept && !frame.note && !planned(job, frame)) {
      const file = frameFile(job, frame);
      await copyFile(kept, join(dir, file));
      await patchFrame({ file, source: "look" });
      return;
    }
    // Stopped meanwhile: send nothing new.
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

/** The place and the cast, in the director's order, for a live plan's placeholders. */
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

/** Sends a still: a planned keyframe by the plan's endpoint and input, else the fixed request. */
async function sendFrame(
  job: VideoJob,
  frame: JobFrame,
  inputs: FrameInputs,
): Promise<{ requestId: string; endpoint?: string }> {
  if (planned(job, frame)) return submitLiveFrame(job, frame, await liveFiles(job));
  return { requestId: await submitFrame(job, frame, inputs) };
}

/** The provider said a still failed: an attempt (falls back after two, for a planned keyframe). */
async function frameFailed(key: string, frameId: string, message: string) {
  const next = await update(key, (j) => stepReportedFailure(j, { frame: frameId }, message));
  const frame = next?.frames.find((f) => f.id === frameId);
  if (frame?.fallback && !frame.retried)
    console.warn(`[video] keyframe ${frame.keyframe} falls back:`, message);
}

/** What fixture mode shows for a still: the place for scenes, the cover for people. */
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
  const patchFrame = patchFrameOf(key, frameId);
  let url = frame.resultUrl;
  if (!url) {
    if (requestOverdue("still", frame.submittedAt, Date.now())) {
      await cancelFrame(frame);
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
    await patchFrame({ resultUrl: url, costUsd: addUsd(frame.costUsd, result.costUsd) });
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
      await patchFrame({
        redone: true,
        check: problem,
        requestId: undefined,
        resultUrl: undefined,
        submittedAt: undefined,
      });
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

/**
 * The batch's settings as they are now. Experiment branch: its Media level;
 * the fixed pipeline's model is the default, at the level's size.
 */
async function batchNow(
  job: VideoJob,
): Promise<{ model: string; resolution: string; level: string }> {
  const ws = await getWorkspace();
  const session = ws.sessions.find((s) => s.id === job.sessionId);
  const series = ws.series.find((s) => s.id === job.seriesId);
  const level = batchMediaLevel(session, series).id;
  return { model: DEFAULT_VIDEO_MODEL, resolution: mediaLevel(level).output, level };
}

async function runSubmitShot(key: string, initial: VideoJob, index: number) {
  let job = initial;
  if (!modelLocked(job)) {
    // First shot: the video stops following its batch. The model and size
    // are saved before anything is sent, so a restart polls the right endpoint.
    const batch = await batchNow(job);
    const locked = await update(key, (j) =>
      modelLocked(j) ? j : { ...followBatch(j, batch), modelLocked: true },
    );
    if (!locked) return;
    job = locked;
  }
  const shot = job.shots[index];
  if (!shot || shot.end === undefined || shot.start === undefined) return;
  const dir = jobDir(job);
  const frame = frameFor(job, shot);
  try {
    if (!frame?.file) throw new Error("Thiếu khung hình");
    // Stopped since this was scheduled: never send.
    const latest = jobs.get(key);
    if (latest?.status !== "running" || latest.shots[index]?.state !== "queued") return;
    if (!madeByProvider(shot)) {
      // Wide and detail: the still with a slow push-in, made here for free.
      const clip = revFile(job, `shot-${String(index + 1).padStart(2, "0")}`, "mp4");
      if (frame.plate && frame.cutout) {
        // Product on its plate: two layers moving at different rates, never a video model.
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
    // Marked as being sent before anything is paid (survives a restart).
    const marked = (await markSending(key, { shot: index }))?.shots[index];
    if (!marked) return;
    if (job.live && shot.route && !shot.fallback) {
      // Planned: the plan's endpoint and input, recorded with the request.
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
    // A planned keyframe already has its framing: never cropped.
    if (shot.framing === "close" && !shot.keyframe) {
      // Closer framing: cropped from the same still, so nothing new is generated.
      const closer = join(dir, `close-${frame.file}`);
      await cropCloser(still, closer);
      still = closer;
    }
    // The model is fixed here and recorded with the request: polling (also
    // after a restart) asks the same endpoint, so nothing is paid twice.
    const model = shotModel(job, shot);
    let audio = join(dir, shot.audio);
    if (model.minSec && (shot.audioSec ?? 0) < model.minSec) {
      // Too short for this model: padded with silence, trimmed again in assembly.
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
    // No connection: not an attempt; sent once it is back. Refused at
    // submission (nothing charged): counts as a failed attempt.
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
      await cancelShot(job, shot);
      await update(key, (j) => stepReportedFailure(j, { shot: index }, timedOutMessage("clip")));
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
    const costUsd = result.costUsd;
    await update(key, (j) => ({
      ...j,
      shots: j.shots.map((s) =>
        s.index === index ? { ...s, resultUrl: url, costUsd: addUsd(s.costUsd, costUsd) } : s,
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
    await assertFfmpeg();
    await rm(work, { recursive: true, force: true });
    await mkdir(work, { recursive: true });
    const shots = [...job.shots].sort((a, b) => a.index - b.index);
    const exact: string[] = [];
    // Each clip cut to its exact place on the timeline; the voice is laid under the whole video.
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
    // Holds: silence inserted into the dialogue after their lines, locally.
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
    // Words timed from the voice's saved character timing, else spread over each line.
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
    // Sized from the video's own size, so the words keep their place at any resolution.
    await writeFile(assFile, buildAss(cues, outputSize(job.resolution)), "utf8");
    const tmp = join(work, "final.mp4");
    await assembleOverDialogue(
      exact,
      dialogue,
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
