import { imageModel } from "../image-models";
import { ROUTE_LABEL, type Route } from "../live-plan";
import { stagedWithoutPlace } from "../series-place";
import { asksUsd, type JobSound, type SoundAsk, soundInFlight, soundToSend } from "../sound";
import {
  frameFor,
  isGenerated,
  type JobFrame,
  type JobShot,
  jobSoundCues,
  jobSoundSource,
  liveSeconds,
  madeByProvider,
  modelsOf,
  type VideoJob,
  videoModelOf,
} from "../video-job";
import { motionSec, motionUsd } from "../video-models";
import { STEP } from "./charges";
import { SPEAKING_SCENES } from "./group-names";
import { COST_PARTS } from "./parts";
import { CUTOUT_USD, VOICE_SAMPLE_USD } from "./rates";
import { voiceFilesToMake, voicesToMakeUsd } from "./voice-cost";

export const shotEstimateUsd = (job: Pick<VideoJob, "models" | "pace">, shot: JobShot): number =>
  madeByProvider(shot) ? motionUsd(videoModelOf(job), liveSeconds(job, shot)) : 0;

export const frameUsd = (job: Pick<VideoJob, "models">): number =>
  imageModel(modelsOf(job).image).fallbackUsd;

export const takenFromMaterial = (frame: JobFrame) =>
  Boolean(frame.materialFile) && !frame.fresh && !frame.file;

export const replaysMaterialClip = (job: VideoJob, shot: JobShot) =>
  Boolean(shot.materialClip) && shot.state !== "done" && !frameFor(job, shot)?.fresh;

const shotToMakeUsd = (job: VideoJob, shot: JobShot) =>
  replaysMaterialClip(job, shot) ? 0 : shotEstimateUsd(job, shot);

const framesToMake = (job: VideoJob) =>
  job.frames.filter((f) => !f.file && !takenFromMaterial(f) && isGenerated(job, f));

const frameCutoutsUsd = (f: JobFrame) => (f.cutouts ?? 0) * CUTOUT_USD;

const cutoutsToMakeUsd = (job: VideoJob) =>
  job.frames
    .filter((f) => f.kind === "product" && !f.file && !f.cutout && isGenerated(job, f))
    .reduce((n, f) => n + frameCutoutsUsd(f), 0);

const plannedOrMadeSounds = (job: VideoJob): (SoundAsk | JobSound)[] =>
  job.sounds ?? (job.dialogue ? [] : jobSoundSource(job).asks(jobSoundCues(job)));

const isJobSound = (s: SoundAsk | JobSound): s is JobSound => "attempts" in s;

const soundsToMakeUsd = (job: VideoJob) =>
  asksUsd(
    jobSoundSource(job),
    plannedOrMadeSounds(job).filter((s) => !isJobSound(s) || soundToSend(s)),
  );

const soundsInFlightUsd = (job: VideoJob) =>
  asksUsd(
    jobSoundSource(job),
    (job.sounds ?? []).filter((s) => soundInFlight(s) && !s.resultUrl),
  );

const stillsToMakeUsd = (job: VideoJob) =>
  framesToMake(job).filter((f) => !f.requestId).length * frameUsd(job) + cutoutsToMakeUsd(job);

export function inFlightUsd(job: VideoJob): number {
  return (
    job.shots
      .filter((s) => s.state === "rendering" && !s.resultUrl)
      .reduce((n, s) => n + shotEstimateUsd(job, s), 0) +
    framesToMake(job).filter((f) => f.requestId && !f.resultUrl).length * frameUsd(job) +
    soundsInFlightUsd(job) +
    COST_PARTS.reduce((n, p) => n + p.inFlightUsd(job), 0)
  );
}

export function costToFinishUsd(job: VideoJob): number | null {
  if (!job.plan) return null;
  const shots = job.shots
    .filter((s) => s.state !== "done" && s.state !== "rendering")
    .reduce((n, s) => n + shotToMakeUsd(job, s), 0);
  return (
    stillsToMakeUsd(job) +
    shots +
    soundsToMakeUsd(job) +
    COST_PARTS.reduce((n, p) => n + p.toMakeUsd(job), 0)
  );
}

export const costToPreviewUsd = (job: VideoJob): number | null =>
  job.plan ? stillsToMakeUsd(job) + voicesToMakeUsd(job) : null;

export const stagedToMake = (job: VideoJob | null | undefined): job is VideoJob =>
  Boolean(job?.plan && !job.planning && !stagedWithoutPlace(job));

export function batchToMake(jobs: readonly (VideoJob | null | undefined)[]): {
  count: number;
  usd: number;
} {
  const staged = jobs.filter(stagedToMake);
  const voiceFiles = staged.flatMap(voiceFilesToMake);
  const sharedVoicesUsd = (voiceFiles.length - new Set(voiceFiles).size) * VOICE_SAMPLE_USD;
  return {
    count: staged.length,
    usd: staged.reduce((n, j) => n + (costToFinishUsd(j) ?? 0), 0) - sharedVoicesUsd,
  };
}

export function stillToPayUsd(job: VideoJob): number | null {
  const finish = costToFinishUsd(job);
  return finish === null ? null : inFlightUsd(job) + finish;
}

export interface StepEstimate {
  key: string;
  group: string;
  label: string;
  quantity: string;
  usd: number | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

const madeWithoutCharge = (made: boolean, costUsd: number | null | undefined) =>
  made && costUsd === undefined;

const OLD_VOICE = "Giọng đọc";

const oldVoiceStep = (job: VideoJob): StepEstimate[] =>
  job.voiceCostUsd === undefined
    ? []
    : [
        {
          key: STEP.voice,
          group: OLD_VOICE,
          label: OLD_VOICE,
          quantity: "",
          usd: job.voiceCostUsd,
        },
      ];

function frameSteps(job: VideoJob): StepEstimate[] {
  return job.frames.flatMap((f): StepEstimate[] => {
    const planned = Boolean(job.live && f.keyframe && !f.fallback);
    const generated = isGenerated(job, f);
    const free =
      !generated || takenFromMaterial(f) || madeWithoutCharge(Boolean(f.file), f.costUsd);
    const label =
      f.kind === "product" && !planned ? "Ảnh sản phẩm" : `Khung hình ${f.keyframe ?? f.id}`;
    const still: StepEstimate = {
      key: STEP.frame(f.id),
      group: label === "Ảnh sản phẩm" ? label : "Khung hình",
      label,
      quantity: generated ? "1 ảnh" : "",
      usd: free ? 0 : frameUsd(job),
    };
    const cutouts =
      f.kind === "product" && generated && (f.cutouts || f.cutoutCostUsd !== undefined);
    if (!cutouts) return [still];
    return [
      {
        key: STEP.cutout(f.id),
        group: "Tách nền sản phẩm",
        label: "Tách nền sản phẩm",
        quantity: "",
        usd: madeWithoutCharge(Boolean(f.cutout), f.cutoutCostUsd) ? 0 : frameCutoutsUsd(f),
      },
      still,
    ];
  });
}

const shotQuantity = (job: VideoJob, shot: JobShot): string =>
  madeByProvider(shot) ? `${motionSec(videoModelOf(job), liveSeconds(job, shot))} giây` : "";

const ROUTE_GROUP: Record<Route, string> = { ...ROUTE_LABEL, "lip-sync": SPEAKING_SCENES };

function shotSteps(job: VideoJob): StepEstimate[] {
  return job.shots.map((shot) => {
    const route = shot.route ?? (madeByProvider(shot) ? "lip-sync" : "still-move");
    const shown = shot.fallback && route === "motion" ? "still-move" : route;
    return {
      key: STEP.shot(shot.index),
      group: ROUTE_GROUP[shown],
      label: `Cảnh ${shot.index + 1} · ${ROUTE_LABEL[shown]}`,
      quantity: shotQuantity(job, shot),
      usd: madeWithoutCharge(shot.state === "done", shot.costUsd) ? 0 : shotToMakeUsd(job, shot),
    };
  });
}

function soundSteps(job: VideoJob): StepEstimate[] {
  const source = jobSoundSource(job);
  return plannedOrMadeSounds(job).flatMap((s): StepEstimate[] => {
    const made = isJobSound(s) ? s : null;
    if (made?.dropped && made.costUsd === undefined) return [];
    const ambience = s.role === "ambience";
    return [
      {
        key: STEP.sound(s.id),
        group: ambience ? "Âm thanh nền" : "Tiếng động",
        label: ambience ? "Âm thanh nền" : `Cảnh ${(s.shot ?? 0) + 1} · Tiếng động`,
        quantity: `${round1(s.seconds)} giây`,
        usd: madeWithoutCharge(Boolean(made?.file), made?.costUsd) ? 0 : asksUsd(source, [s]),
      },
    ];
  });
}

export const stepEstimates = (job: VideoJob): StepEstimate[] => [
  ...oldVoiceStep(job),
  ...frameSteps(job),
  ...COST_PARTS.flatMap((p) => p.steps(job)),
  ...shotSteps(job),
  ...soundSteps(job),
];

export const unknownPriceSteps = (job: VideoJob) =>
  stepEstimates(job).filter((s) => s.usd === null).length;

export interface FirstPass {
  at: string;
  usd: number;
  unknownSteps: number;
  groups: Record<string, number | null>;
  steps: Record<string, number | null>;
}

export function firstPassOf(job: VideoJob, at: string): FirstPass {
  const steps = stepEstimates(job);
  const groups: Record<string, number | null> = {};
  for (const s of steps) {
    const sum = groups[s.group];
    groups[s.group] = sum === null || s.usd === null ? null : (sum ?? 0) + s.usd;
  }
  return {
    at,
    usd: steps.reduce((n, s) => n + (s.usd ?? 0), 0),
    unknownSteps: steps.filter((s) => s.usd === null).length,
    groups,
    steps: Object.fromEntries(steps.map((s) => [s.key, s.usd])),
  };
}

export const withFirstPass = (job: VideoJob, at: string): VideoJob =>
  job.plan && !job.firstPass ? { ...job, firstPass: firstPassOf(job, at) } : job;
