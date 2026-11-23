import type { JobCut, VideoJob } from "../video-job";
import type { PaidItem } from "./charges";
import type { StepEstimate } from "./estimate";
import { speechCost } from "./speech-cost";

export interface CostPart {
  replacesVoiceTrack: (job: Pick<VideoJob, "voiceMode">) => boolean;
  inUse: (cut: JobCut) => PaidItem[];
  steps: (job: VideoJob) => StepEstimate[];
  toMakeUsd: (job: VideoJob) => number;
  inFlightUsd: (job: VideoJob) => number;
  stepLabel: (step: string) => string | null;
}

export const COST_PARTS: readonly CostPart[] = [speechCost];
