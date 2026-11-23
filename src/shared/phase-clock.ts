import { jobPhase, type TimedPhase, type VideoJob } from "./video-job";

type PhaseSec = Partial<Record<TimedPhase, number>>;

function runningGapSec(job: VideoJob, nowMs: number): number {
  if (job.status !== "running" || !job.clockAt) return 0;
  const gap = (nowMs - Date.parse(job.clockAt)) / 1000;
  return Number.isFinite(gap) && gap >= 0 ? gap : 0;
}

function withGap(job: VideoJob, nowMs: number): PhaseSec | undefined {
  const gap = runningGapSec(job, nowMs);
  const phase = jobPhase(job);
  if (!gap || phase === "done") return job.phaseSec;
  return { ...job.phaseSec, [phase]: (job.phaseSec?.[phase] ?? 0) + gap };
}

export function clocked(before: VideoJob | null, after: VideoJob, nowMs: number): VideoJob {
  const phaseSec = before ? withGap(before, nowMs) : after.phaseSec;
  const { clockAt: _, phaseSec: __, ...rest } = after;
  return {
    ...rest,
    ...(phaseSec ? { phaseSec } : {}),
    ...(after.status === "running" ? { clockAt: new Date(nowMs).toISOString() } : {}),
  };
}

export function restartedClock(job: VideoJob, nowMs: number): VideoJob {
  const { clockAt: _, ...rest } = job;
  return job.status === "running" ? { ...rest, clockAt: new Date(nowMs).toISOString() } : rest;
}

export const phaseSecNow = (job: VideoJob, nowMs: number): PhaseSec => withGap(job, nowMs) ?? {};

export const totalSec = (phaseSec: PhaseSec): number =>
  Object.values(phaseSec).reduce((n, s) => n + (s ?? 0), 0);

export const timed = (job: VideoJob) => Boolean(job.phaseSec || job.clockAt);
