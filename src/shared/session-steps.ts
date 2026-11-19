import { boardOrder } from "./board";
import type { Script, Session } from "./ipc";
import { committedIds, finishedScripts } from "./ready-check";
import type { VideoJob } from "./video-job";

// The session header's two steps, "Kịch bản" then "Video": their counts and
// marks, and what the corner offers next. Pure, so the header and tests share
// one answer.

/**
 * A sent video waiting on the operator: not started, at "Nghe và xem cảnh chính",
 * stopped or failed. A job being planned is not waiting.
 */
export function jobNeedsYou(job: VideoJob | null | undefined): boolean {
  if (!job) return true;
  if (job.status === "idle") return !job.planning;
  return job.status === "review" || job.status === "stopped" || job.status === "failed";
}

/**
 * A written script's Dàn dựng (docs/SCRIPT_BOARD_DECISIONS.md): a new script
 * is done once its words and its staging both exist, and the staging follows
 * by itself. "staging": being made or about to be; "failed": it stopped and
 * waits for "Lên dàn dựng"; "ready": it exists; "none": nothing to stage
 * (still written, no voiced line) or the video is being made, which its own
 * status says.
 */
export type StagingState = "none" | "staging" | "failed" | "ready";

export function stagingState(
  script: Pick<Script, "status" | "lines">,
  job: Pick<VideoJob, "status" | "plan" | "planning"> | null | undefined,
): StagingState {
  if (script.status !== "ready") return "none";
  if (!script.lines.some((l) => l.characterId && l.text.trim())) return "none";
  if (job?.planning) return "staging";
  if (job?.plan) return "ready";
  if (!job || job.status === "idle") return "staging";
  return job.status === "failed" ? "failed" : "none";
}

export interface SessionSteps {
  /** Scripts on the board that are not failed (cards still being written count). */
  scripts: number;
  /** Every finished script has been sent to video (and there is at least one). */
  scriptsDone: boolean;
  /** Finished scripts not yet sent. */
  toSend: number;
  /** Scripts sent to video. */
  sent: number;
  /** Sent scripts whose video is finished. */
  done: number;
  /** Sent scripts waiting on the operator (`jobNeedsYou`). */
  waiting: number;
  /** Sent scripts being made, planned or queued. */
  running: number;
}

/** `jobs` is null while the session's jobs are loading: nothing counts as done or waiting yet. */
export function sessionSteps(
  session: Session,
  scripts: Script[],
  jobs: ReadonlyMap<string, VideoJob> | null,
): SessionSteps {
  const committed = committedIds(session, scripts);
  const finished = finishedScripts(scripts);
  const sent = finished.filter((s) => committed.includes(s.id));
  const sentJobs = jobs ? sent.map((s) => jobs.get(s.id)) : [];
  const done = sentJobs.filter((j) => j?.status === "done").length;
  const waiting = sentJobs.filter(jobNeedsYou).length;
  return {
    scripts: boardOrder(scripts).filter((s) => s.status !== "failed").length,
    scriptsDone: finished.length > 0 && sent.length === finished.length,
    toSend: finished.length - sent.length,
    sent: sent.length,
    done,
    waiting,
    running: jobs ? sent.length - done - waiting : 0,
  };
}
