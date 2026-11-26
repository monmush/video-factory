import { stagedToMake } from "./cost/estimate";
import { productChanged, sameDirection, sameSpokenLines } from "./direction";
import { failedUnpaid, videoUntouched } from "./edit-in-place";
import type { Script } from "./ipc";
import { stagedWithoutPlace } from "./series-place";
import { spokenLines, type VideoJob } from "./video-job";

export type OutdatedReason = "words" | "product" | "wishes";

export const OUTDATED_TEXT: Record<OutdatedReason, string> = {
  words: "Kịch bản đã đổi",
  product: "Sản phẩm đã đổi",
  wishes: "Có ý chưa áp dụng",
};

export type StagingStatus = "none" | "staging" | "ready" | "outdated" | "failed" | "started";

type StagedScript = Pick<Script, "lines" | "productIds">;
type BoardScript = StagedScript & Pick<Script, "status">;

export const wishesChanged = (
  job: Pick<VideoJob, "stagedDirection">,
  direction: VideoJob["direction"],
) => Boolean(job.stagedDirection && !sameDirection(job.stagedDirection, direction));

export function outdatedReasons(
  job: VideoJob | null | undefined,
  script: StagedScript,
): OutdatedReason[] {
  if (!job?.plan || !videoUntouched(job) || stagedWithoutPlace(job)) return [];
  const reasons: OutdatedReason[] = [];
  if (!sameSpokenLines(job.lines, script.lines)) reasons.push("words");
  if (productChanged(job, script)) reasons.push("product");
  if (wishesChanged(job, job.direction)) reasons.push("wishes");
  return reasons;
}

const ASKABLE: readonly StagingStatus[] = ["none", "outdated", "failed"];

export const needsStaging = (status: StagingStatus) => ASKABLE.includes(status);

export const stageable = (script: BoardScript) =>
  script.status === "ready" && spokenLines(script.lines).length > 0;

export function stagingStatus(
  job: VideoJob | null | undefined,
  script: BoardScript,
): StagingStatus {
  if (job && !videoUntouched(job)) return "started";
  if (!job || !stageable(script)) return "none";
  if (job.planning) return "staging";
  if (failedUnpaid(job)) return "failed";
  if (!job.plan || stagedWithoutPlace(job)) return "none";
  return outdatedReasons(job, script).length ? "outdated" : "ready";
}

export const readyToMake = (
  job: VideoJob | null | undefined,
  script: StagedScript,
): job is VideoJob => stagedToMake(job) && outdatedReasons(job, script).length === 0;

export const stagingOutdated = (
  staged: Pick<VideoJob, "lines">,
  script: (Pick<Script, "lines"> & { deletedAt?: string | null }) | undefined,
) => !script || Boolean(script.deletedAt) || !sameSpokenLines(staged.lines, script.lines);

export type FreeSettle = "remove" | "product" | "keep";

export function freeSettle(
  job: VideoJob,
  script: (BoardScript & Pick<Script, "deletedAt">) | undefined,
): { abort: boolean; step: FreeSettle } {
  const abort = Boolean(job.planning && stagingOutdated(job, script));
  if (!videoUntouched(job)) return { abort, step: "keep" };
  if (!script || script.deletedAt) return { abort, step: "remove" };
  if (script.status !== "ready" || !job.plan) return { abort, step: "keep" };
  if (productChanged(job, script)) return { abort, step: "product" };
  return { abort, step: "keep" };
}
