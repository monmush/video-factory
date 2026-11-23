import { type JobSegment, segmentAskedSec, segmentEstimateUsd } from "../speech";
import { isNative, type JobCut, levelSpeech, type VideoJob } from "../video-job";
import type { PaidItem } from "./charges";
import type { StepEstimate } from "./estimate";
import type { CostPart } from "./parts";

const SEGMENT_STEP = "segment:";

export const segmentStep = (id: string) => `${SEGMENT_STEP}${id}`;

const SPEECH = "Lời nói";

const segmentUsd = (job: VideoJob, s: JobSegment) => segmentEstimateUsd(levelSpeech(job), s) ?? 0;

const reusedOrFree = (s: JobSegment) => s.state === "done" && s.costUsd === undefined;

function inUse(cut: JobCut): PaidItem[] {
  return (cut.segments ?? []).flatMap((s): PaidItem[] =>
    s.costUsd === undefined
      ? []
      : [
          {
            step: segmentStep(s.id),
            kind: "speech",
            usd: s.costUsd,
            billed: Boolean(s.costBilled),
            ...(s.requestId ? { requestId: s.requestId } : {}),
          },
        ],
  );
}

function steps(job: VideoJob): StepEstimate[] {
  return (job.segments ?? []).map((s, k) => {
    const asked = segmentAskedSec(levelSpeech(job), s);
    return {
      key: segmentStep(s.id),
      group: SPEECH,
      label: `Đoạn ${k + 1} · ${SPEECH}`,
      quantity: asked ? `${asked} giây` : "",
      usd: reusedOrFree(s) ? 0 : segmentEstimateUsd(levelSpeech(job), s),
    };
  });
}

const toMakeUsd = (job: VideoJob) =>
  (job.segments ?? [])
    .filter((s) => s.state !== "done" && s.state !== "rendering")
    .reduce((n, s) => n + segmentUsd(job, s), 0);

const inFlightUsd = (job: VideoJob) =>
  (job.segments ?? [])
    .filter((s) => s.state === "rendering" && !s.resultUrl)
    .reduce((n, s) => n + segmentUsd(job, s), 0);

function stepLabel(step: string): string | null {
  if (!step.startsWith(SEGMENT_STEP)) return null;
  const line = /^line-(\d+)-/.exec(step.slice(SEGMENT_STEP.length))?.[1];
  return line ? `${SPEECH} câu ${line}` : SPEECH;
}

export const speechCost: CostPart = {
  replacesVoiceTrack: isNative,
  inUse,
  steps,
  toMakeUsd,
  inFlightUsd,
  stepLabel,
};
