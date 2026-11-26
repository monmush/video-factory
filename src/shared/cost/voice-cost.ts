import type { JobCut, VideoJob } from "../video-job";
import type { JobVoice } from "../voice-step";
import type { PaidItem } from "./charges";
import type { StepEstimate } from "./estimate";
import type { CostPart } from "./parts";
import { VOICE_SAMPLE_USD } from "./rates";

export const CHARACTER_VOICES = "Giọng nhân vật";

const VOICE_STEP = "voice:";

export const voiceStep = (characterId: string) => `${VOICE_STEP}${characterId}`;

const listed = (v: JobVoice) => Boolean(v.toMake) || v.costUsd !== undefined;

const madeElsewhere = (v: JobVoice) => v.ready && v.costUsd === undefined;

const inUse = (cut: JobCut): PaidItem[] =>
  (cut.voices ?? []).flatMap((v): PaidItem[] =>
    v.costUsd === undefined
      ? []
      : [
          {
            step: voiceStep(v.characterId),
            kind: "voice",
            usd: v.costUsd,
            billed: Boolean(v.costBilled),
            ...(v.requestId ? { requestId: v.requestId } : {}),
          },
        ],
  );

const steps = (job: VideoJob): StepEstimate[] =>
  (job.voices ?? []).filter(listed).map((v) => ({
    key: voiceStep(v.characterId),
    group: CHARACTER_VOICES,
    label: CHARACTER_VOICES,
    quantity: "1 giọng",
    usd: madeElsewhere(v) ? 0 : VOICE_SAMPLE_USD,
  }));

export const voicesToMakeUsd = (job: Pick<VideoJob, "voices">) =>
  (job.voices ?? []).filter((v) => !v.ready && !v.requestId).length * VOICE_SAMPLE_USD;

const inFlightUsd = (job: VideoJob) =>
  (job.voices ?? []).filter((v) => !v.ready && v.requestId && !v.resultUrl).length *
  VOICE_SAMPLE_USD;

export const voiceFilesToMake = (job: Pick<VideoJob, "voices">) =>
  (job.voices ?? []).filter((v) => !v.ready && !v.requestId).map((v) => v.file);

const stepLabel = (step: string) => (step.startsWith(VOICE_STEP) ? CHARACTER_VOICES : null);

export const voiceCost: CostPart = {
  inUse,
  steps,
  toMakeUsd: voicesToMakeUsd,
  inFlightUsd,
  stepLabel,
};
