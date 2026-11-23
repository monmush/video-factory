import { liveAvoidingRejectedSpeakers, speakerToTry } from "./speaker-switch";
import { type JobSegment, wantedSec } from "./speech";
import { speechModelToTry } from "./speech-models";
import {
  billedSeconds,
  type JobShot,
  levelSpeech,
  madeByProvider,
  type VideoJob,
} from "./video-job";
import { modelForClip, videoModel } from "./video-models";

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

const onPlannedRoute = (job: VideoJob, shot: JobShot) =>
  Boolean(job.live && shot.route && !shot.fallback);

function plannedSpeaker(job: VideoJob, shot: JobShot): string | null {
  if (!madeByProvider(shot)) return null;
  if (!onPlannedRoute(job, shot)) return modelForClip(job.model, billedSeconds(shot)).endpoint;
  const route = job.live?.plan.routes[shot.index];
  return route?.route === "lip-sync" ? route.endpoint : null;
}

function speakerUsed(job: VideoJob, shot: JobShot): string | null {
  const planned = plannedSpeaker(job, shot);
  if (!planned) return null;
  if (onPlannedRoute(job, shot)) return shot.endpoint ?? planned;
  return shot.model ? videoModel(shot.model).endpoint : planned;
}

export function speakerForNextClip(job: VideoJob, shot: JobShot): string | null {
  const planned = plannedSpeaker(job, shot);
  return planned && speakerToTry(planned, shot.rejectedSpeakers ?? [], billedSeconds(shot));
}

const speakerLeftToTry = (job: VideoJob, shot: JobShot) =>
  !plannedSpeaker(job, shot) || speakerForNextClip(job, shot) !== null;

function withSpeakerRejected(job: VideoJob, index: number, speaker: string): VideoJob {
  const shots = job.shots.map((s) =>
    s.index === index
      ? { ...s, rejectedSpeakers: [...new Set([...(s.rejectedSpeakers ?? []), speaker])] }
      : s,
  );
  const next = { ...job, shots };
  const shot = shots.find((s) => s.index === index);
  if (!next.live || !shot || !onPlannedRoute(next, shot)) return next;
  return {
    ...next,
    live: liveAvoidingRejectedSpeakers(next.live, index, {
      kind: shot.kind,
      ambient: job.plan?.seats.find((s) => s.characterId === shot.characterId)?.ambient,
      rejectedSpeakers: shot.rejectedSpeakers,
      seconds: billedSeconds(shot),
    }),
  };
}

export function withUnrecordedSpeakerRejections(job: VideoJob): VideoJob {
  return job.shots.reduce((j, shot) => {
    const rejectedBeforeSpeakersWereRecorded =
      !shot.rejectedSpeakers &&
      (shot.rejectedClips ?? 0) > 0 &&
      shot.state === "failed" &&
      shot.error === CLIP_NOT_USABLE;
    const speaker = rejectedBeforeSpeakersWereRecorded ? speakerUsed(j, shot) : null;
    return speaker ? withSpeakerRejected(j, shot.index, speaker) : j;
  }, job);
}

export function rejectClip(job: VideoJob, index: number, resultUrl: string): VideoJob {
  const sent = job.shots.find((s) => s.index === index);
  if (sent?.state !== "rendering" || sent.resultUrl !== resultUrl) return job;
  const speaker = speakerUsed(job, sent);
  const judged = speaker ? withSpeakerRejected(job, index, speaker) : job;
  const shot = judged.shots.find((s) => s.index === index) as JobShot;
  const redo = mayRedoAutomatically(job, sent) && speakerLeftToTry(judged, shot);
  const discarded: JobShot = {
    ...shot,
    requestId: undefined,
    submittedAt: undefined,
    sending: undefined,
    resultUrl: undefined,
    busyAnswers: undefined,
    endpoint: undefined,
    costUsd: undefined,
    costBilled: undefined,
    rejectedClips: (shot.rejectedClips ?? 0) + 1,
  };
  const next: JobShot = redo
    ? {
        ...discarded,
        state: stillMaking(job) ? "queued" : "stopped",
        autoRedos: (shot.autoRedos ?? 0) + 1,
        error: undefined,
      }
    : { ...discarded, state: "failed", error: CLIP_NOT_USABLE };
  return {
    ...judged,
    shots: judged.shots.map((s) => (s.index === index ? next : s)),
    ...(redo ? { autoRedos: (job.autoRedos ?? 0) + 1 } : {}),
  };
}

const mayRedoSegment = (job: VideoJob, seg: JobSegment) =>
  (seg.autoRedos ?? 0) < MAX_AUTO_REDOS_PER_SHOT && (job.autoRedos ?? 0) < MAX_AUTO_REDOS_PER_VIDEO;

export function rejectSegmentClip(job: VideoJob, id: string, resultUrl: string): VideoJob {
  const sent = job.segments?.find((s) => s.id === id);
  if (sent?.state !== "rendering" || sent.resultUrl !== resultUrl) return job;
  const rejectedModels = [
    ...new Set([...(sent.rejectedModels ?? []), ...(sent.model ? [sent.model] : [])]),
  ];
  const judged: JobSegment = { ...sent, rejectedModels };
  const modelLeft = speechModelToTry(levelSpeech(job), rejectedModels, wantedSec(judged)) !== null;
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
