import { spentUsd } from "./cost/charges";
import type { VideoJob } from "./video-job";

type JobState = Pick<VideoJob, "status" | "planning" | "dialogue" | "plan" | "charges">;

export const unstarted = (job: JobState) =>
  job.status === "idle" && !job.planning && !job.dialogue && spentUsd(job) === 0;

export const failedUnpaid = (job: JobState) =>
  job.status === "failed" && !job.plan && !job.dialogue && spentUsd(job) === 0;

export const videoUntouched = (job: JobState) =>
  unstarted({ ...job, planning: false }) || failedUnpaid(job);

export const editsInPlace = (sent: boolean, job: JobState | null | undefined) =>
  !sent || !job || videoUntouched(job);
