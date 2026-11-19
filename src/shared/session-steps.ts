import { boardOrder } from "./board";
import type { Script, Session } from "./ipc";
import { committedIds, finishedScripts } from "./ready-check";
import type { VideoJob } from "./video-job";

export function jobNeedsYou(job: VideoJob | null | undefined): boolean {
  if (!job) return true;
  if (job.status === "idle") return !job.planning;
  return job.status === "review" || job.status === "stopped" || job.status === "failed";
}

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
  scripts: number;
  scriptsDone: boolean;
  toSend: number;
  sent: number;
  done: number;
  waiting: number;
  running: number;
}

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
