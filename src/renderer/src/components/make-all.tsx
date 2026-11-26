import { boardOrder } from "@shared/board";
import {
  batchToMake,
  costToFinishUsd,
  costToPreviewUsd,
  unknownPriceSteps,
} from "@shared/cost/estimate";
import { estimateText } from "@shared/cost/table";
import type { Script } from "@shared/ipc";
import { committedIds, finishedScripts } from "@shared/ready-check";
import { readyToMake } from "@shared/staging-status";
import { followSeriesModels, stopsForPreview, type VideoJob } from "@shared/video-job";
import { api } from "@/lib/api";
import { useBoard } from "@/lib/board";
import { stagingOf } from "@/lib/staging";
import { useAction } from "@/lib/use-action";
import { useVideoJobs } from "@/lib/video-jobs";
import { useWorkspace } from "@/lib/workspace";
import { useMakeVideos } from "./ready-check";
import { ButtonPrice, HoldButton } from "./ui/hold-button";

export function sentVideosBatchAlsoFinishes(
  sent: Script[],
  jobs: ReadonlyMap<string, VideoJob>,
): Script[] {
  return sent.filter((s) => {
    const job = jobs.get(s.id);
    if (!job) return true;
    if (job.status === "running" || job.status === "waiting") return job.pause && !job.reviewed;
    return job.status !== "done";
  });
}

export function priceOfThisHold(job: VideoJob): string {
  const usd = (stopsForPreview(job) ? costToPreviewUsd(job) : costToFinishUsd(job)) ?? 0;
  return `${estimateText(usd)}${unknownPriceSteps(job) ? " +?" : ""}`;
}

export function useBatch(sessionId: string) {
  const board = useBoard(sessionId);
  const session = useWorkspace().sessions.find((s) => s.id === sessionId);
  const state = useVideoJobs(sessionId);
  const make = useMakeVideos({ sessionId });
  if (!board || !session || !state) return null;
  const order = boardOrder(board.scripts);
  const committed = committedIds(session, board.scripts);
  const finished = finishedScripts(board.scripts);
  const sent = finished.filter((s) => committed.includes(s.id));
  const jobOf = (scriptId: string) => {
    const job = state.jobs.get(scriptId);
    return job && followSeriesModels(job, make.models);
  };
  const staged = (s: Script) => readyToMake(jobOf(s.id), s);
  const stagingOfScript = (s: Script) => stagingOf(jobOf(s.id), s);
  const sum = (list: Script[]) => batchToMake(list.map((s) => jobOf(s.id))).usd;
  const stalled = sentVideosBatchAlsoFinishes(sent, state.jobs);
  return {
    session,
    order,
    committed,
    finished,
    sent,
    stalled,
    jobOf,
    staged,
    stagingOfScript,
    sum,
    make,
  };
}

export type Batch = NonNullable<ReturnType<typeof useBatch>>;

export function MakeAll({ sessionId, batch }: { sessionId: string; batch: Batch }) {
  const all = useAction();
  const { stalled, staged, sum } = batch;
  const ready = stalled.filter(staged);
  if (stalled.length <= 1 || ready.length === 0) return null;
  const holdAll = () => all.run(() => api.invoke("video:make-all", { sessionId, scriptIds: [] }));
  return (
    <>
      {all.error && <span className="text-xs text-destructive-foreground">{all.error}</span>}
      <HoldButton onHold={holdAll}>
        Giữ để tạo hết {ready.length} video
        <ButtonPrice>{estimateText(sum(ready))}</ButtonPrice>
      </HoldButton>
    </>
  );
}
