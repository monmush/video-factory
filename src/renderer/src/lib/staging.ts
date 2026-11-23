import { videoLevel } from "@shared/batch-settings";
import type { Script } from "@shared/ipc";
import type { MediaLevelId } from "@shared/media-level";
import {
  needsStaging,
  type OutdatedReason,
  outdatedReasons,
  type StagingStatus,
  stageable,
  stagingStatus,
} from "@shared/staging-status";
import { useVideoJobs } from "./video-jobs";
import { useWorkspace } from "./workspace";

export function useVideoLevel(sessionId: string): (scriptId: string) => MediaLevelId {
  const { sessions, series } = useWorkspace();
  const session = sessions.find((s) => s.id === sessionId);
  const own = series.find((s) => s.id === session?.seriesId);
  return (scriptId) => videoLevel(session, own, scriptId);
}

export interface ScriptStaging {
  status: StagingStatus;
  reasons: OutdatedReason[];
  canStage: boolean;
}

export function stagingOf(
  job: Parameters<typeof stagingStatus>[0],
  script: Script,
  level: string,
): ScriptStaging {
  const status = stagingStatus(job, script, level);
  return {
    status,
    reasons: outdatedReasons(job, script, level),
    canStage: stageable(script) && needsStaging(status),
  };
}

export function useStaging(sessionId: string, script: Script): ScriptStaging {
  const jobs = useVideoJobs(sessionId);
  const levelOf = useVideoLevel(sessionId);
  if (!jobs) return { status: "none", reasons: [], canStage: false };
  return stagingOf(jobs.jobs.get(script.id), script, levelOf(script.id));
}

export const STAGE_LABEL: Partial<Record<StagingStatus, string>> = {
  none: "Dàn dựng",
  outdated: "Cập nhật dàn dựng",
  failed: "Thử lại dàn dựng",
};
