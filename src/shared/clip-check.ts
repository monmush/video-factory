import { withMishaps } from "./mishaps";
import { type JobSegment, wantedSec } from "./speech";
import { type JobShot, shotModel, type VideoJob, videoModelOf } from "./video-job";
import { speechModelToTry } from "./video-models";

export const MAX_AUTO_REDOS_PER_SHOT = 2;
export const MAX_AUTO_REDOS_PER_VIDEO = 4;
const CHECK_ATTEMPTS = 2;

export const CLIP_NOT_USABLE = "Cảnh quay chưa đạt";

export async function addedLettering(ask: () => Promise<string | null>): Promise<string | null> {
  for (let attempt = 1; attempt <= CHECK_ATTEMPTS; attempt++) {
    try {
      return await ask();
    } catch (error) {
      console.warn(`[video] clip check attempt ${attempt} failed:`, (error as Error).message);
    }
  }
  return null;
}

export function readClipAnswer(answer: unknown): string | null {
  const added = (answer as { added?: unknown } | null)?.added;
  if (added === null) return null;
  if (typeof added !== "string") throw new Error("The clip check answer has no verdict.");
  const seen = added.trim();
  return seen && !/^(none|null|no)$/i.test(seen) ? seen : null;
}

export const clipFrameTimes = (seconds: number): number[] => {
  const end = Math.max(0, seconds - 0.3);
  return [Math.min(0.2, seconds * 0.05), seconds / 2, end];
};

const mayRedoAutomatically = (job: VideoJob, shot: JobShot) =>
  (shot.autoRedos ?? 0) < MAX_AUTO_REDOS_PER_SHOT &&
  (job.autoRedos ?? 0) < MAX_AUTO_REDOS_PER_VIDEO;

const stillMaking = (job: VideoJob) => job.status === "running" || job.status === "waiting";

export function rejectClip(
  job: VideoJob,
  index: number,
  resultUrl: string,
  at = new Date().toISOString(),
): VideoJob {
  const sent = job.shots.find((s) => s.index === index);
  if (sent?.state !== "rendering" || sent.resultUrl !== resultUrl) return job;
  const redo = mayRedoAutomatically(job, sent);
  const discarded: JobShot = {
    ...withMishaps(sent, ["lettering"], at, shotModel(job)),
    requestId: undefined,
    submittedAt: undefined,
    sending: undefined,
    resultUrl: undefined,
    busyAnswers: undefined,
    endpoint: undefined,
    costUsd: undefined,
    costBilled: undefined,
    rejectedClips: (sent.rejectedClips ?? 0) + 1,
  };
  const next: JobShot = redo
    ? {
        ...discarded,
        state: stillMaking(job) ? "queued" : "stopped",
        autoRedos: (sent.autoRedos ?? 0) + 1,
        error: undefined,
      }
    : { ...discarded, state: "failed", error: CLIP_NOT_USABLE };
  return {
    ...job,
    shots: job.shots.map((s) => (s.index === index ? next : s)),
    ...(redo ? { autoRedos: (job.autoRedos ?? 0) + 1 } : {}),
  };
}

const mayRedoSegment = (job: VideoJob, seg: JobSegment) =>
  (seg.autoRedos ?? 0) < MAX_AUTO_REDOS_PER_SHOT && (job.autoRedos ?? 0) < MAX_AUTO_REDOS_PER_VIDEO;

export function rejectSegmentClip(
  job: VideoJob,
  id: string,
  resultUrl: string,
  at = new Date().toISOString(),
): VideoJob {
  const sent = job.segments?.find((s) => s.id === id);
  if (sent?.state !== "rendering" || sent.resultUrl !== resultUrl) return job;
  const rejectedModels = [
    ...new Set([...(sent.rejectedModels ?? []), ...(sent.model ? [sent.model] : [])]),
  ];
  const judged: JobSegment = {
    ...withMishaps(sent, ["lettering"], at, sent.model),
    rejectedModels,
  };
  const modelLeft =
    speechModelToTry(videoModelOf(job).id, rejectedModels, wantedSec(judged)) !== null;
  const redo = mayRedoSegment(job, sent) && modelLeft;
  const discarded: JobSegment = {
    ...judged,
    requestId: undefined,
    submittedAt: undefined,
    sending: undefined,
    resultUrl: undefined,
    busyAnswers: undefined,
    model: undefined,
    seconds: undefined,
    costUsd: undefined,
    costBilled: undefined,
    rejectedClips: (sent.rejectedClips ?? 0) + 1,
  };
  const next: JobSegment = redo
    ? {
        ...discarded,
        state: stillMaking(job) ? "queued" : "stopped",
        autoRedos: (sent.autoRedos ?? 0) + 1,
        error: undefined,
      }
    : { ...discarded, state: "failed", error: CLIP_NOT_USABLE };
  return {
    ...job,
    segments: job.segments?.map((s) => (s.id === id ? next : s)),
    ...(redo ? { autoRedos: (job.autoRedos ?? 0) + 1 } : {}),
  };
}
