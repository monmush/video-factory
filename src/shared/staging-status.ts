import { stagedToMake } from "./cost/estimate";
import { productChanged, sameDirection, sameSpokenLines } from "./direction";
import { failedUnpaid, videoUntouched } from "./edit-in-place";
import type { Script } from "./ipc";
import { mediaLevel } from "./media-level";
import { spokenLines, type VideoJob } from "./video-job";
import { planAtLevel } from "./video-takes";

export type OutdatedReason = "words" | "product" | "quality" | "wishes";

export const OUTDATED_TEXT: Record<OutdatedReason, string> = {
  words: "Kịch bản đã đổi",
  product: "Sản phẩm đã đổi",
  quality: "Chất lượng đã đổi",
  wishes: "Có ý chưa áp dụng",
};

export type StagingStatus = "none" | "staging" | "ready" | "outdated" | "failed" | "started";

type StagedScript = Pick<Script, "lines" | "productIds">;
type BoardScript = StagedScript & Pick<Script, "status">;

const otherLevel = (job: VideoJob, level: string) =>
  mediaLevel(job.level).id !== mediaLevel(level).id;

export function outdatedReasons(
  job: VideoJob | null | undefined,
  script: StagedScript,
  level: string,
): OutdatedReason[] {
  if (!job?.plan || !videoUntouched(job)) return [];
  const reasons: OutdatedReason[] = [];
  if (!sameSpokenLines(job.lines, script.lines)) reasons.push("words");
  if (productChanged(job, script)) reasons.push("product");
  if (otherLevel(job, level) && !planAtLevel(job, level)) reasons.push("quality");
  if (job.stagedDirection && !sameDirection(job.stagedDirection, job.direction)) {
    reasons.push("wishes");
  }
  return reasons;
}

export const stageable = (script: BoardScript) =>
  script.status === "ready" && spokenLines(script.lines).length > 0;

export function stagingStatus(
  job: VideoJob | null | undefined,
  script: BoardScript,
  level: string,
): StagingStatus {
  if (job && !videoUntouched(job)) return "started";
  if (!job || !stageable(script)) return "none";
  if (job.planning) return "staging";
  if (failedUnpaid(job)) return "failed";
  if (!job.plan) return "none";
  return outdatedReasons(job, script, level).length ? "outdated" : "ready";
}

export const readyToMake = (
  job: VideoJob | null | undefined,
  script: StagedScript,
  level: string,
): job is VideoJob => stagedToMake(job) && outdatedReasons(job, script, level).length === 0;

export const stagingOutdated = (
  staged: Pick<VideoJob, "lines">,
  script: (Pick<Script, "lines"> & { deletedAt?: string | null }) | undefined,
) => !script || Boolean(script.deletedAt) || !sameSpokenLines(staged.lines, script.lines);

export type FreeSettle = "remove" | "level" | "product" | "keep";

export function freeSettle(
  job: VideoJob,
  script: (BoardScript & Pick<Script, "deletedAt">) | undefined,
  level: string,
): { abort: boolean; step: FreeSettle } {
  const abort = Boolean(job.planning && stagingOutdated(job, script));
  if (!videoUntouched(job)) return { abort, step: "keep" };
  if (!script || script.deletedAt) return { abort, step: "remove" };
  if (script.status !== "ready" || !job.plan) return { abort, step: "keep" };
  if (productChanged(job, script)) return { abort, step: "product" };
  const sameWords = sameSpokenLines(job.lines, script.lines);
  if (sameWords && otherLevel(job, level) && planAtLevel(job, level)) {
    return { abort, step: "level" };
  }
  return { abort, step: "keep" };
}
