import { boardOrder } from "./board";
import type { Script, Session } from "./ipc";
import { committedIds, finishedScripts } from "./ready-check";
import { needsStaging, stageable, stagingStatus } from "./staging-status";
import type { VideoJob } from "./video-job";
import { chosenView } from "./video-takes";

export const hasVideo = (job: VideoJob | null | undefined) =>
  Boolean(job && (job.status === "done" || chosenView(job).final));

export function jobNeedsYou(job: VideoJob | null | undefined): boolean {
  if (!job) return true;
  if (job.status === "idle") return !job.planning;
  return job.status === "review" || job.status === "stopped" || job.status === "failed";
}

export interface SessionSteps {
  scripts: number;
  scriptsDone: boolean;
  stageable: boolean;
  toStage: number;
  unstarted: number;
  staged: number;
  staging: number;
  sent: number;
  done: number;
  waiting: number;
  running: number;
}

export function sessionSteps(
  session: Session,
  scripts: Script[],
  jobs: ReadonlyMap<string, VideoJob> | null,
  levelOf: (scriptId: string) => string,
): SessionSteps {
  const committed = committedIds(session, scripts);
  const finished = finishedScripts(scripts);
  const sent = finished.filter((s) => committed.includes(s.id));
  const sentJobs = jobs ? sent.map((s) => jobs.get(s.id)) : [];
  const done = sentJobs.filter(hasVideo).length;
  const waiting = sentJobs.filter((j) => !hasVideo(j) && jobNeedsYou(j)).length;
  const onBoard = boardOrder(scripts).filter((s) => s.status !== "failed");
  const statuses = jobs
    ? finished.filter(stageable).map((s) => stagingStatus(jobs.get(s.id), s, levelOf(s.id)))
    : [];
  const unstarted = statuses.filter((status) => status !== "started");
  const toStage = unstarted.filter(needsStaging).length;
  const writing = onBoard.some((s) => s.status === "writing");
  return {
    scripts: onBoard.length,
    scriptsDone: Boolean(jobs) && onBoard.length > 0 && !writing && toStage === 0,
    stageable: finished.some(stageable),
    toStage,
    unstarted: unstarted.length,
    staged: unstarted.filter((status) => status === "ready").length,
    staging: unstarted.filter((status) => status === "staging").length,
    sent: sent.length,
    done,
    waiting,
    running: jobs ? sent.length - done - waiting : 0,
  };
}
