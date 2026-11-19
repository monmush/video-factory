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
  assertFfmpegBeforeAnyPaidStep,
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
}

async function update(key: string, change: (job: VideoJob) => VideoJob): Promise<VideoJob | null> {
  const current = jobs.get(key);
  if (!current) return null;
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
        let job = migrateJob(JSON.parse(raw));
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
  if (!autoTimers.has(sessionId)) scheduleAutoPlan(sessionId);
  return [...jobs.values()].filter((j) => j.sessionId === sessionId);
}

const autoTried = new Map<string, string>();
const autoTimers = new Map<string, ReturnType<typeof setTimeout>>();
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
  status?: "idle",
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
    model: DEFAULT_VIDEO_MODEL,
    resolution: fitResolution(
      DEFAULT_VIDEO_MODEL,
      mediaLevel(batchMediaLevel(session, series).id).output,
    ),
    now: nowIso(),
  });
  if (job.lines.length === 0) throw new Error("Kịch bản không có lời thoại");
  job.level = batchMediaLevel(session, series).id;
  if (status) job.status = status;
  job.productIds = [...script.productIds];
  if (direction?.length) job.direction = direction;
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

export async function enqueue(sessionId: string, scriptIds: string[]): Promise<void> {
  await ensureLoaded();
  const fresh = scriptIds.filter((id) => !jobs.has(keyOf(sessionId, id)));
  for (const scriptId of fresh) {
    await createJob(sessionId, scriptId, fresh.length === 1).catch(ignoreInUse);
  }
  schedule();
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
  if (!current) await createJob(sessionId, scriptId, true).catch(ignoreInUse);
  await update(key, (job) => resumeJob(job, nowIso()));
  return null;
}

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
  await syncScripts(sessionId, (await getBoard(sessionId)).scripts);
  return null;
}

const failedUnpaid = (job: VideoJob) =>
  job.status === "failed" && !job.plan && !job.dialogue && spentUsd(job) === 0;

export function planCommitted(sessionId: string, scriptIds: string[]): void {
  if (!textAiIsOwn()) return;
  for (const scriptId of scriptIds) {
    void planOnly(sessionId, scriptId).catch((error) =>
      console.warn("[video] planning after approval:", (error as Error).message),
    );
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
  if (current?.planning) throw new Error("Đang lên dàn dựng");
  if (current && !unstarted(current)) throw new Error("Video đã bắt đầu tạo");
  const direction = setDirection(current?.direction, change, nowIso());
  await createJob(sessionId, scriptId, true, "idle", direction, freeToReplace);
  void planOnly(sessionId, scriptId).catch((error) =>
    console.warn("[video] planning after a direction:", (error as Error).message),
  );
  return null;
}

const unstarted = (job: VideoJob) =>
  job.status === "idle" && !job.planning && !job.dialogue && spentUsd(job) === 0;

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
  scheduleAutoPlan(sessionId);
}

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
      if (job.productIds?.[0] !== script.productIds[0]) {
        console.log(`[video] product change staged again (${followed.why})`);
      }
    }
    if (!otherLevel && !jobStale(job, script) && !job.plan) return;
    const direction = anchoredDirection(job.direction, script.lines);
    await createJob(job.sessionId, job.scriptId, true, "idle", direction, freeToReplace).catch(
      (error) => (error instanceof JobInUse ? undefined : removeJob(key)),
    );
  } catch (error) {
    console.warn("[video] could not follow the script:", (error as Error).message);
  }
}

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

export async function followLevel(sessionId: string): Promise<void> {
  await syncScripts(sessionId, (await getBoard(sessionId)).scripts);
}

export async function videoStarted(sessionId: string, scriptId: string): Promise<boolean> {
  await ensureLoaded();
  const job = jobs.get(keyOf(sessionId, scriptId));
  return Boolean(job && !unstarted(job));
}

export async function videoMade(sessionId: string, scriptId: string): Promise<boolean> {
  await ensureLoaded();
  const job = jobs.get(keyOf(sessionId, scriptId));
  return Boolean(job && !unstarted({ ...job, planning: false }));
}

export async function replan(sessionId: string, scriptId: string): Promise<null> {
  await dropPlan(sessionId, scriptId);
  return planOnly(sessionId, scriptId);
}

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
  take?: string,
): Promise<null> {
  const job = await jobOf(sessionId, scriptId);
  await committedOrThrow(sessionId, scriptId);
  if (rev !== undefined && rev !== (job.rev ?? 0)) {
    throw new Error("Video đã thay đổi sau đề xuất này");
  }
  const run = (j: VideoJob) => applyFix(take ? focusTake(j, take, nowIso()) : j, changes, nowIso());
  run(job);
  await update(keyOf(sessionId, scriptId), run);
  return null;
}

export async function restore(sessionId: string, scriptId: string, take?: string): Promise<null> {
  const job = await jobOf(sessionId, scriptId);
  const run = (j: VideoJob) => restorePrevious(take ? focusTake(j, take, nowIso()) : j, nowIso());
  run(job);
  await update(keyOf(sessionId, scriptId), run);
  return null;
}

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
  await update(keyOf(sessionId, scriptId), (job) => stopJob(job, nowIso()));
  return null;
}

export async function retryShot(sessionId: string, scriptId: string, shot: number): Promise<null> {
  await ensureLoaded();
  await committedOrThrow(sessionId, scriptId);
  await update(keyOf(sessionId, scriptId), (job) => retryShotState(job, shot, nowIso()));
  return null;
}

export function forgetSession(sessionId: string) {
  for (const [key, job] of jobs) if (job.sessionId === sessionId) jobs.delete(key);
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
  await copyFile(join(jobDir(job), job.final), result.filePath);
  try {
    const inputs = await frameInputs(job);
    await saveLook(job, jobDir(job), await assets(), inputs?.place);
  } catch (error) {
    console.error("[video] could not save the series look", error);
  }
  return result.filePath;
}

const POLL_MS = { live: 5000, fixture: 1000 };

function pump() {
  if (!loaded) return;
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

async function runPlan(key: string, job: VideoJob) {
  const startedAt = Date.now();
  try {
    await mkdir(jobDir(job), { recursive: true });
    const { level } = await batchNow(job);
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
        resolution: live
          ? mediaLevel(level).output
          : fitResolution(j.model, mediaLevel(level).output),
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
    const spoken = shotTimes(planned, current.lineSpans ?? [], total, timing);
    const { times } = withHolds(spoken, planned);
    const inputs: { start: number; end: number; audio?: string; audioSec?: number }[] = [];
    for (const [i, shot] of current.shots.entries()) {
      const time = times[i] as { start: number; end: number };
      if (!madeByProvider(shot)) {
        inputs.push(time);
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
    await update(key, (j) => ({ ...withShotAudio(j, inputs), phaseStartedAt: nowIso() }));
  } catch (error) {
    if (await offline(key, error)) return;
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
      const character = all.find((a) => a.id === frame.characterId);
      if (!character) throw new Error("Không tìm thấy nhân vật");
      const file = await coverFrame(character, dir);
      await patchFrame({ file, source: "cover" });
      return;
    }
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

async function batchNow(
  job: VideoJob,
): Promise<{ model: string; resolution: string; level: string }> {
  const ws = await getWorkspace();
  const session = ws.sessions.find((s) => s.id === job.sessionId);
  const series = ws.series.find((s) => s.id === job.seriesId);
  const level = batchMediaLevel(session, series).id;
  return { model: DEFAULT_VIDEO_MODEL, resolution: mediaLevel(level).output, level };
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
    if (!madeByProvider(shot)) {
      const clip = revFile(job, `shot-${String(index + 1).padStart(2, "0")}`, "mp4");
      if (frame.plate && frame.cutout) {
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
