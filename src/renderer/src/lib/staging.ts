import type { Script } from "@shared/ipc";
import { hasPlace } from "@shared/series-place";
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

export function useHasPlace(sessionId: string): boolean {
  const { sessions, series, assets } = useWorkspace();
  const session = sessions.find((s) => s.id === sessionId);
  return hasPlace(
    series.find((s) => s.id === session?.seriesId),
    assets,
  );
}

export interface ScriptStaging {
  status: StagingStatus;
  reasons: OutdatedReason[];
  canStage: boolean;
}

export function stagingOf(job: Parameters<typeof stagingStatus>[0], script: Script): ScriptStaging {
  const status = stagingStatus(job, script);
  return {
    status,
    reasons: outdatedReasons(job, script),
    canStage: stageable(script) && needsStaging(status),
  };
}

export function useStaging(sessionId: string, script: Script): ScriptStaging {
  const jobs = useVideoJobs(sessionId);
  if (!jobs) return { status: "none", reasons: [], canStage: false };
  return stagingOf(jobs.jobs.get(script.id), script);
}

export const STAGE_LABEL: Partial<Record<StagingStatus, string>> = {
  none: "Dàn dựng",
  outdated: "Cập nhật dàn dựng",
  failed: "Thử lại dàn dựng",
};
