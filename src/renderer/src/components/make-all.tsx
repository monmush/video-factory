import { boardOrder } from "@shared/board";
import {
  batchToMake,
  costToFinishUsd,
  costToPreviewUsd,
  unknownPriceSteps,
} from "@shared/cost/estimate";
import { estimateText } from "@shared/cost/table";
import type { Script } from "@shared/ipc";
import { mediaLevel } from "@shared/media-level";
import { committedIds, finishedScripts } from "@shared/ready-check";
import { readyToMake } from "@shared/staging-status";
import { stopsForPreview, type VideoJob } from "@shared/video-job";
import { planAtLevel } from "@shared/video-takes";
import { api } from "@/lib/api";
import { useBoard, useBoardView } from "@/lib/board";
import { stagingOf } from "@/lib/staging";
import { useAction } from "@/lib/use-action";
import { useVideoJobs } from "@/lib/video-jobs";
import { useWorkspace } from "@/lib/workspace";
import { makeLabel, ReadyCheckDialog, useMakeVideos } from "./ready-check";
import { Button } from "./ui/button";
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
  const unsent = finished.filter((s) => !committed.includes(s.id));
  const jobOf = (scriptId: string) => state.jobs.get(scriptId);
  const atLevel = (scriptId: string): VideoJob | undefined => {
    const job = jobOf(scriptId);
    if (!job?.plan || job.planning || job.status !== "idle") return job;
    const level = make.levelOf(scriptId);
    return level === mediaLevel(job.level).id ? job : (planAtLevel(job, level) ?? job);
  };
  const staged = (s: Script) => readyToMake(jobOf(s.id), s, make.levelOf(s.id));
  const stagingOfScript = (s: Script) => stagingOf(jobOf(s.id), s, make.levelOf(s.id));
  const sum = (list: Script[]) => batchToMake(list.map((s) => atLevel(s.id))).usd;
  const stalled = sentVideosBatchAlsoFinishes(sent, state.jobs);
  return {
    session,
    order,
    committed,
    finished,
    sent,
    unsent,
    stalled,
    jobOf,
    staged,
    stagingOfScript,
    priceOf: (scriptId: string) => batchToMake([atLevel(scriptId)]).usd,
    sum,
    make,
    batchMakesOnlyThisVideo: unsent.length <= 1 && stalled.length === 0,
  };
}

export type Batch = NonNullable<ReturnType<typeof useBatch>>;

export function MakeAll({
  sessionId,
  batch,
  withUnsent,
  test,
  onStarted,
}: {
  sessionId: string;
  batch: Batch;
  withUnsent: boolean;
  test?: Script | null;
  onStarted?: () => void | Promise<void>;
}) {
  const all = useAction();
  const [, setView] = useBoardView(sessionId);
  const { make, order, committed, stalled, staged, stagingOfScript, sum } = batch;
  const rest = withUnsent ? batch.unsent : [];
  const restIds = rest.map((s) => s.id);
  const stagedRest = rest.filter(staged);
  const stagedStalled = stalled.filter(staged);
  const count = stagedRest.length + stagedStalled.length;
  const showAll = rest.length + stalled.length > 1 || rest.length === 1;
  const isStaging = (s: Script) => stagingOfScript(s).status === "staging";

  const label = (hold: boolean) => {
    const verb = hold ? "Giữ để tạo" : "Tạo";
    if (stagedStalled.length === 0)
      return makeLabel(stagedRest.length, {
        hold,
        remaining: committed.length > 0,
        number: stagedRest[0] ? order.indexOf(stagedRest[0]) + 1 : undefined,
      });
    return `${verb} hết ${count} video`;
  };
  const allUsd = sum(stagedRest) + sum(stagedStalled);
  const runAll = async (scriptIds: string[]) => {
    await api.invoke("video:make-all", { sessionId, scriptIds });
    await onStarted?.();
  };
  const holdAll = () => all.run(() => runAll(stagedRest.map((s) => s.id)));
  const error = all.error;
  const checkFirst = rest.length > 0 && make.needsCheck(restIds);
  const testing = Boolean(test && staged(test) && count > 1);
  const preview = {
    onPointerEnter: () => setView({ previewAll: true }),
    onPointerLeave: () => setView({ previewAll: false }),
    onFocus: () => setView({ previewAll: true }),
    onBlur: () => setView({ previewAll: false }),
  };

  const allButton = checkFirst ? (
    <Button
      variant={testing ? "outline" : "default"}
      onClick={() => make.open(restIds)}
      {...(testing ? preview : {})}
    >
      {label(false)}
      {count > 0 && <ButtonPrice>{estimateText(allUsd)}</ButtonPrice>}
    </Button>
  ) : (
    count > 0 && (
      <HoldButton
        tone={testing ? "outline" : "primary"}
        onHold={holdAll}
        {...(testing ? preview : {})}
      >
        {label(true)}
        <ButtonPrice>{estimateText(allUsd)}</ButtonPrice>
      </HoldButton>
    )
  );

  const testButton =
    testing && test ? (
      make.needsCheck([test.id]) ? (
        <Button onClick={() => make.open([test.id])}>
          {makeLabel(1, { test: true, hold: false })}
          <ButtonPrice>{estimateText(sum([test]))}</ButtonPrice>
        </Button>
      ) : (
        <HoldButton onHold={() => all.run(() => runAll([test.id]))}>
          {makeLabel(1, { test: true })}
          <ButtonPrice>{estimateText(sum([test]))}</ButtonPrice>
        </HoldButton>
      )
    ) : null;

  return (
    <>
      {showAll && (
        <>
          {error && <span className="text-xs text-destructive-foreground">{error}</span>}
          {allButton}
          {testButton}
        </>
      )}
      <ReadyCheckDialog
        sessionId={sessionId}
        scope={make.scope ?? []}
        open={make.scope !== null}
        onOpenChange={(next) => {
          if (!next) make.close();
        }}
        spend={{
          priceOf: (scriptId) => {
            const script = batch.finished.find((s) => s.id === scriptId);
            return script && staged(script) ? batch.priceOf(scriptId) : null;
          },
          staging: (scriptId) => {
            const script = rest.find((s) => s.id === scriptId);
            return Boolean(script && isStaging(script));
          },
          extra: {
            usd: sum(stagedStalled),
            count: stagedStalled.length,
            staging: stalled.filter(isStaging).length,
          },
          run: runAll,
        }}
      />
    </>
  );
}
