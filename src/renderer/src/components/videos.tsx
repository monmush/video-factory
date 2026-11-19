import { boardOrder, estimateSeconds, formatSeconds } from "@shared/board";
import { formatCost } from "@shared/credits";
import { mediaUrl, type Script } from "@shared/ipc";
import { mediaLevel } from "@shared/media-level";
import { isNetworkMessage, OFFLINE_MESSAGE } from "@shared/net-error";
import { committedIds, finishedScripts } from "@shared/ready-check";
import { stagingState } from "@shared/session-steps";
import {
  canFix,
  canRestore,
  type FixChange,
  fixPriceUsd,
  previousIsNewer,
} from "@shared/video-fix";
import {
  costToFinishUsd,
  costToPreviewUsd,
  doneShots,
  followBatch,
  frameFor,
  isGenerated,
  type JobShot,
  jobPhase,
  liveCostTable,
  lossIfStoppedUsd,
  madeByProvider,
  remainingSec,
  type StepAverages,
  spentUsd,
  stopsForPreview,
  totalEstimateUsd,
  type VideoJob,
} from "@shared/video-job";
import { videoModel } from "@shared/video-models";
import {
  canSwitch,
  chosenModel,
  focusTake,
  takeCostUsd,
  takeModels,
  takePriceUsd,
  viewTake,
  workingModel,
} from "@shared/video-takes";
import { useNavigate } from "@tanstack/react-router";
import {
  Check,
  Ellipsis,
  History,
  LoaderCircle,
  MessageSquarePlus,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCw,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { addRefs, editAsNewVersion, requestChatFocus, useBoard } from "@/lib/board";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import {
  markHeard,
  reloadVideoJobs,
  useHeard,
  useNow,
  useVideoJobs,
  useVideoJobsError,
} from "@/lib/video-jobs";
import { useWorkspace } from "@/lib/workspace";
import { LivePlanFold } from "./live-plan";
import { Page } from "./page";
import { QualityChip } from "./quality-chip";
import { makeLabel, ReadyCheckDialog, useBatchMediaLevel, useMakeVideos } from "./ready-check";
import { PlanningSteps } from "./shot-brief";
import { Button } from "./ui/button";
import { ButtonPrice, HoldButton } from "./ui/hold-button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { VideoModelMenu } from "./video-model-menu";

// The Video tab (prototypes/video-generation, third version): a card per
// finished script. Committed scripts show their job: one status line, the
// dialogue once it exists, a tile per shot, and the finished video. Every
// action that spends money is held. Jobs run in the main process; this only
// shows them (docs/VIDEO_GENERATION_DECISIONS.md).

const STOP_HOLD_MS = 1200;

/**
 * Sent videos the batch button also takes to the end: not started, waiting at
 * "Nghe và xem cảnh chính", stopped or failed, or a test video that would still stop.
 */
function stalledScripts(sent: Script[], jobs: ReadonlyMap<string, VideoJob>): Script[] {
  return sent.filter((s) => {
    const job = jobs.get(s.id);
    if (!job) return true;
    if (job.status === "running" || job.status === "waiting") return job.pause && !job.reviewed;
    return job.status !== "done";
  });
}

export function VideosList({ sessionId }: { sessionId: string }) {
  const board = useBoard(sessionId);
  const session = useWorkspace().sessions.find((s) => s.id === sessionId);
  const state = useVideoJobs(sessionId);
  const make = useMakeVideos({ sessionId });
  const loadError = useVideoJobsError(sessionId);
  if (!state && loadError) {
    return (
      <Page className="pt-0">
        <div className="flex items-center gap-2 pt-4">
          <span className="text-destructive-foreground">{loadError}</span>
          <Button variant="outline" size="sm" onClick={() => reloadVideoJobs(sessionId)}>
            <RotateCw />
            Thử lại
          </Button>
        </div>
      </Page>
    );
  }
  if (!board || !session || !state) return null;
  const order = boardOrder(board.scripts);
  const committed = committedIds(session, board.scripts);
  const finished = finishedScripts(board.scripts);
  const sent = finished.filter((s) => committed.includes(s.id));
  const rest = finished.filter((s) => !committed.includes(s.id));

  const card = (script: Script) => (
    <VideoCard
      key={script.id}
      sessionId={sessionId}
      script={script}
      number={order.indexOf(script) + 1}
      committed={committed.includes(script.id)}
      job={state.jobs.get(script.id) ?? null}
      averages={state.averages}
      make={make}
      // Its own button unless the batch button makes exactly this one video.
      ownMake={rest.length > 1 || stalledScripts(sent, state.jobs).length > 0}
    />
  );

  // Made videos first; scripts still waiting follow as one group. The batch
  // button sits in the session header (VideosToolbar).
  return (
    <Page className="pt-0">
      <SettingsBar sessionId={sessionId} />
      <ul className="flex flex-col gap-4">{sent.map(card)}</ul>
      {rest.length > 0 && (
        <section className={cn(committed.length > 0 && "mt-8")}>
          {committed.length > 0 && (
            <h3 className="mb-3 text-sm text-muted-foreground tabular-nums">
              Chưa tạo {rest.length} video
            </h3>
          )}
          <ul className="flex flex-col gap-4">{rest.map(card)}</ul>
        </section>
      )}
      {make.dialog}
    </Page>
  );
}

/**
 * The Video tab's batch action, in the session header: one button makes every
 * video on the tab that is not finished, end to end
 * (docs/VIDEO_COMMIT_DECISIONS.md, "Auto mode").
 */
export function VideosToolbar({ sessionId }: { sessionId: string }) {
  const board = useBoard(sessionId);
  const session = useWorkspace().sessions.find((s) => s.id === sessionId);
  const state = useVideoJobs(sessionId);
  const makeAll = useMakeVideos({ sessionId });
  const all = useAction();
  if (!board || !session || !state) return null;
  const order = boardOrder(board.scripts);
  const committed = committedIds(session, board.scripts);
  const finished = finishedScripts(board.scripts);
  const sent = finished.filter((s) => committed.includes(s.id));
  const rest = finished.filter((s) => !committed.includes(s.id));
  const restIds = rest.map((s) => s.id);
  const estimate = makeAll.estimate;
  const restUsd = rest.reduce((n, s) => n + estimate(s), 0);

  const stalled = stalledScripts(sent, state.jobs);
  const stalledUsd = stalled.reduce((n, s) => {
    const job = state.jobs.get(s.id);
    return n + (job ? costToFinishUsd(job) : estimate(s));
  }, 0);
  const count = rest.length + stalled.length;
  // One unsent script uses the group's own wording; a lone sent one has its card's button.
  const showAll = count > 1 || rest.length === 1;

  const label = (hold: boolean) => {
    const verb = hold ? "Giữ để tạo" : "Tạo";
    if (stalled.length === 0)
      return makeLabel(rest.length, {
        hold,
        remaining: committed.length > 0,
        number: rest[0] ? order.indexOf(rest[0]) + 1 : undefined,
      });
    return `${verb} hết ${count} video`;
  };
  const allUsd = restUsd + stalledUsd;
  const runAll = (scriptIds: string[]) => api.invoke("video:make-all", { sessionId, scriptIds });
  const holdAll = () => all.run(() => runAll(restIds));
  const error = all.error ?? makeAll.error;

  return (
    <div className="flex items-center gap-2.5">
      {showAll && (
        <>
          {error && <span className="text-xs text-destructive-foreground">{error}</span>}
          {rest.length > 0 && makeAll.needsCheck(restIds) ? (
            <Button onClick={() => makeAll.open(restIds)}>
              {label(false)}
              <ButtonPrice>~{formatCost(allUsd)}</ButtonPrice>
            </Button>
          ) : (
            <HoldButton onHold={holdAll}>
              {label(true)}
              <ButtonPrice>~{formatCost(allUsd)}</ButtonPrice>
            </HoldButton>
          )}
        </>
      )}
      <ReadyCheckDialog
        sessionId={sessionId}
        scope={makeAll.scope ?? []}
        open={makeAll.scope !== null}
        onOpenChange={(next) => {
          if (!next) makeAll.close();
        }}
        spend={{ extraUsd: stalledUsd, extraCount: stalled.length, run: runAll }}
      />
    </div>
  );
}

/**
 * The batch's settings, always in view while videos are made. Experiment
 * branch: the Media level ("Chất lượng") applies to videos not yet planned; a
 * planned one keeps its level and offers "Lập lại". Further settings are one
 * more chip in the row.
 */
function SettingsBar({ sessionId }: { sessionId: string }) {
  const { sessions, series } = useWorkspace();
  const session = sessions.find((s) => s.id === sessionId);
  const own = series.find((s) => s.id === session?.seriesId);
  const seriesLevel = mediaLevel(own?.mediaLevel).id;
  const level = useBatchMediaLevel(sessionId);
  const { error, run } = useAction();
  const set = (id: string) =>
    run(() =>
      api.invoke("session:update", {
        id: sessionId,
        settings: { mediaLevel: id === seriesLevel ? null : id },
      }),
    );
  return (
    <div className="sticky top-0 z-10 mb-1 bg-background py-2">
      <div className="flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-muted/60 px-3 py-1.5">
        <span className="text-xs text-muted-foreground">Thiết lập</span>
        <QualityChip value={level.id} onChange={set} seriesDefault={seriesLevel} />
        {error && <span className="text-xs text-destructive-foreground">{error}</span>}
      </div>
    </div>
  );
}

/**
 * The level a video is made at: the batch's until it is planned or started.
 * A video with anything paid keeps its own level, and says why when the
 * batch's is now another.
 */
function LevelLabel({ job, batchLevel }: { job: VideoJob | null; batchLevel?: string | null }) {
  const own = job && (job.plan || job.status !== "idle") ? job.level : batchLevel;
  const label = mediaLevel(own).label;
  const paid = job && (job.status !== "idle" || job.dialogue || spentUsd(job) > 0);
  if (!paid || mediaLevel(own).id === mediaLevel(batchLevel).id) return label;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="cursor-default" />}>{label}</TooltipTrigger>
      <TooltipPopup side="top" align="center" className="text-xs">
        Video đã bắt đầu tạo nên giữ mức này
      </TooltipPopup>
    </Tooltip>
  );
}

/**
 * What this hold spends: up to "Nghe và xem cảnh chính" when it stops there, else the
 * rest of the video; "+?" when a planned step has no known price.
 */
function holdPrice(job: VideoJob): string {
  const unknown = liveCostTable(job)?.unknownSteps ?? 0;
  const usd = stopsForPreview(job) ? costToPreviewUsd(job) : costToFinishUsd(job);
  return `~${formatCost(usd)}${unknown ? " +?" : ""}`;
}

const minutes = (seconds: number) => `còn ~${Math.max(1, Math.round(seconds / 60))} phút`;

function statusLine(job: VideoJob | null, script: Script, averages: StepAverages, now: number) {
  // Staging follows by itself: being made, or about to be.
  if (stagingState(script, job) === "staging") return "Đang lên dàn dựng";
  if (!job || job.status === "idle") return formatSeconds(estimateSeconds(script.lines));
  if (job.offline && (job.status === "running" || job.status === "waiting")) return OFFLINE_MESSAGE;
  const done = doneShots(job);
  const total = job.shots.length;
  switch (job.status) {
    case "waiting":
      return "Chờ video trước";
    case "done":
      return "Xong";
    case "review":
      return "Nghe và xem cảnh chính";
    case "stopped":
      return `Đã dừng · ${done}/${total} cảnh`;
    case "failed": {
      const failed = job.shots.filter((s) => s.state === "failed").length;
      if (failed) return `Lỗi ${failed} cảnh · ${done}/${total} cảnh`;
      // Failed on a lost connection before that was told apart: continuing is safe.
      return isNetworkMessage(job.error) ? "Mất kết nối" : `Lỗi · ${job.error ?? ""}`;
    }
  }
  const left = minutes(remainingSec(job, averages, now));
  switch (jobPhase(job)) {
    case "plan":
      return `Lên cảnh quay · ${left}`;
    case "voice":
      return `Tạo giọng đọc · ${left}`;
    case "frames":
      return `Vẽ khung hình · ${left}`;
    case "shots":
      return `Cảnh ${done}/${total} · ${left}`;
    default:
      return "Ghép video";
  }
}

type Stage = { label: string; state: "done" | "now" | "next"; count?: string };

/** The stages of making a video, from its state: what is done, what runs now, what follows. */
function stages(job: VideoJob): Stage[] {
  const phase = jobPhase(job);
  const order = ["voice", "frames", "shots", "assemble"] as const;
  const at = order.indexOf(phase as (typeof order)[number]);
  const state = (i: number): Stage["state"] =>
    phase === "done" || i < at ? "done" : i === at ? "now" : "next";
  const stills = job.frames.filter((f) => isGenerated(job, f) || f.kind === "product");
  const made = stills.filter((f) => f.file).length;
  const shots = job.shots.filter((s) => s.state === "done").length;
  const rendering = job.shots.filter((s) => s.state === "rendering").length;
  const list: Stage[] = [
    { label: "Tạo giọng đọc", state: state(0) },
    {
      label: "Vẽ khung hình",
      state: state(1),
      ...(stills.length ? { count: `${made}/${stills.length}` } : {}),
    },
    {
      label: "Quay cảnh",
      state: state(2),
      count: `${shots}/${job.shots.length}${rendering && state(2) === "now" ? ` · ${rendering} đang quay` : ""}`,
    },
    {
      label: "Ghép video và phụ đề",
      state: state(3),
      ...(job.assembleProgress !== undefined && state(3) === "now"
        ? { count: `${Math.round(job.assembleProgress * 100)}%` }
        : {}),
    },
  ];
  // A video that stops for a preview ends, for now, after its stills.
  return stopsAfterStills(job) ? list.slice(0, 2) : list;
}

const stopsAfterStills = (job: VideoJob) =>
  Boolean(
    job.pause &&
      !job.reviewed &&
      job.shots.every((s) => s.state === "queued" || s.state === "planned"),
  );

/**
 * While a video is made: every stage in order, done ones checked, the current
 * one shining with its count, the rest faint. The same look as the planning log.
 */
function MakingSteps({ job }: { job: VideoJob }) {
  return (
    <ol className="mt-2 ml-7.5 flex flex-col gap-1 border-l border-border pl-3 text-xs tabular-nums">
      {stages(job).map((stage) => (
        <li
          key={stage.label}
          className={cn(
            "flex items-center gap-1.5",
            stage.state === "done" && "text-muted-foreground/70",
            stage.state === "next" && "text-muted-foreground/40",
          )}
        >
          {stage.state === "done" ? (
            <Check className="size-3" aria-hidden />
          ) : (
            <span className="size-3" aria-hidden />
          )}
          {stage.state === "now" ? (
            <span className="shimmer-text">{stage.label}</span>
          ) : (
            <span>{stage.label}</span>
          )}
          {stage.count && <span className="text-muted-foreground">{stage.count}</span>}
        </li>
      ))}
    </ol>
  );
}

function VideoCard({
  sessionId,
  script,
  number,
  committed,
  job: saved,
  averages,
  make,
  ownMake,
}: {
  sessionId: string;
  script: Script;
  number: number;
  committed: boolean;
  job: VideoJob | null;
  averages: StepAverages;
  make: ReturnType<typeof useMakeVideos>;
  /** A waiting script's own make button; outline, since the group's is primary. */
  ownMake: boolean;
}) {
  const { error, run } = useAction();
  const navigate = useNavigate();
  // Until its first shot is sent, a video uses the batch's model and size as they are now.
  const job = saved && followBatch(saved, make.batch);
  const active = job?.status === "running" || job?.status === "waiting";
  const now = useNow(job?.status === "running");
  const ids = { sessionId, scriptId: script.id };
  const restage = Boolean(
    job && job.status === "failed" && !job.plan && !job.dialogue && spentUsd(job) === 0,
  );

  // Takes with other models: tabs; the selected one is shown and acted on.
  const [tab, setTab] = useState<string | null>(null);
  const [trying, setTrying] = useState<string | null>(null);
  // Playback time carried across tabs.
  const playhead = useRef(0);
  const takes = job ? takeModels(job) : [];
  const selectedModel = job ? (tab && takes.includes(tab) ? tab : chosenModel(job)) : null;
  const view = job && selectedModel ? viewTake(job, selectedModel) : job;
  const working = Boolean(job && selectedModel === workingModel(job));
  const chosen = Boolean(job && selectedModel === chosenModel(job));
  /** Fixes and "Bản trước" on another take make it the one worked on first. */
  const takeArg = working ? {} : { take: selectedModel ?? undefined };
  const switchable = Boolean(job && (working || canSwitch(job)));
  /** The take a new take starts from: the selected one, worked on. */
  const base = (() => {
    if (!job || !selectedModel || !view?.final || view.status !== "done" || !canSwitch(job)) {
      return null;
    }
    try {
      return focusTake(job, selectedModel, new Date().toISOString());
    } catch {
      return null;
    }
  })();
  const takePrice = (model: string) => {
    try {
      return base ? takePriceUsd(base, model, new Date().toISOString()) : null;
    } catch {
      return null;
    }
  };
  const startTake = async (model: string) => {
    if (!working && selectedModel) {
      await api.invoke("video:take", { ...ids, action: "focus", model: selectedModel });
    }
    await api.invoke("video:take", { ...ids, action: "start", model });
    setTrying(null);
    setTab(model);
  };

  // Experiment branch: takes with another model are hidden; the plan picks models.
  const showTabs = false;
  const several = takes.length > 1;
  /** What a whole video with the selected take's model cost; null when unknown. */
  const ownCost = job && selectedModel ? takeCostUsd(job, selectedModel) : null;
  const shownCost = several ? ownCost : job ? spentUsd(job) : null;

  let cost: string | null = null;
  let action: ReactNode = null;
  if (!committed) {
    // Experiment branch: sending only puts it on this tab; planning shows the price.
    if (ownMake)
      action = (
        <Button
          variant="outline"
          onClick={() =>
            make.needsCheck([script.id]) ? make.open([script.id]) : make.make([script.id])
          }
        >
          Tạo video
        </Button>
      );
  } else if (job?.planning) {
    // Planning is free; what the director is doing shows under the title (PlanningSteps).
    action = (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" />
        ~1–2 phút
      </span>
    );
  } else if (!job || job.status === "idle") {
    // The plan first: made after approval, read and changed on the Kịch bản tab (Dàn dựng).
    // The hold makes exactly that plan.
    action = job?.plan ? (
      <HoldButton tone="outline" onHold={() => run(() => api.invoke("video:start", ids))}>
        {/* Says what this hold makes: the preview (voice and stills, then a stop) or the video. */}
        {stopsForPreview(job) ? "Giữ để tạo các cảnh chính" : "Giữ để tạo video"}
        <ButtonPrice>{holdPrice(job)}</ButtonPrice>
      </HoldButton>
    ) : null;
  } else if (active && working) {
    // This take so far, and all-in when finished.
    const left = totalEstimateUsd(job) - spentUsd(job);
    cost = shownCost === null ? null : `${formatCost(shownCost)} · còn ~${formatCost(left)}`;
    action = (
      <HoldButton
        tone="stop"
        ms={STOP_HOLD_MS}
        hint={`· mất ${formatCost(lossIfStoppedUsd(job))}`}
        onHold={() => run(() => api.invoke("video:stop", ids))}
      >
        Dừng
      </HoldButton>
    );
  } else if (view?.status === "review") {
    // Test video: voice and stills are ready; the expensive step waits for this hold.
    // With the plan table on the card, its "Đã chi" says it; the status line does not repeat it.
    cost = shownCost === null || view.live ? null : formatCost(shownCost);
    action = (
      <HoldButton tone="outline" onHold={() => run(() => api.invoke("video:start", ids))}>
        Giữ để tạo video
        <ButtonPrice>{holdPrice(job)}</ButtonPrice>
      </HoldButton>
    );
  } else if (view?.status === "done" || active) {
    cost = shownCost === null ? null : formatCost(shownCost);
    action =
      chosen || !view?.final ? (
        // Download is always "the video".
        <Button variant="outline" onClick={() => run(() => api.invoke("video:save", ids))}>
          Tải xuống
        </Button>
      ) : (
        <Button
          variant="outline"
          onClick={() =>
            run(() =>
              api.invoke("video:take", { ...ids, action: "use", model: selectedModel as string }),
            )
          }
        >
          <Check />
          Dùng bản này
        </Button>
      );
  } else if (restage) {
    action = (
      <Button variant="outline" onClick={() => run(() => api.invoke("video:plan", ids))}>
        Lên dàn dựng
      </Button>
    );
  } else {
    // Stopped or failed: continue, paying only for what is missing.
    cost = shownCost === null ? null : formatCost(shownCost);
    action = (
      <HoldButton tone="outline" onHold={() => run(() => api.invoke("video:start", ids))}>
        {stopsForPreview(job) ? "Giữ để tạo các cảnh chính" : "Giữ để tạo tiếp"}
        <ButtonPrice>{holdPrice(job)}</ButtonPrice>
      </HoldButton>
    );
  }

  // Secondary actions, in the "⋯" menu.
  const fixOrTalk = Boolean(
    view && view.status !== "idle" && view.status !== "waiting" && switchable,
  );
  const restorable = Boolean(view && canRestore(view) && switchable);
  const deletable = Boolean(job && view && !chosen && switchable && view.status !== "running");
  const hasMenu = committed || fixOrTalk || restorable || deletable;

  return (
    <li
      className={cn(
        "rounded-xl border bg-card p-4 transition-opacity",
        !committed && "opacity-55 focus-within:opacity-100 hover:opacity-100",
      )}
    >
      {/* Row 1: what it is; the one main action and the rest in "⋯". */}
      <div className="flex min-h-9 items-center gap-2.5">
        <span className="w-5 text-xs text-muted-foreground tabular-nums">#{number}</span>
        <h3 className="min-w-0 flex-1 truncate font-semibold">
          {script.title}
          {script.version && (
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              bản {script.version}
            </span>
          )}
        </h3>
        {action}
        {hasMenu && (
          <Menu>
            <MenuTrigger render={<Button variant="ghost-muted" size="icon-sm" aria-label="Thêm" />}>
              <Ellipsis />
            </MenuTrigger>
            <MenuPopup align="end">
              {committed && (
                // A script with a video never changes: editing makes a new version on the board.
                <MenuItem
                  onClick={() =>
                    run(async () => {
                      await editAsNewVersion(sessionId, script.id);
                      await navigate({
                        to: "/sessions/$sessionId/scripts",
                        params: { sessionId },
                      });
                    })
                  }
                >
                  <Pencil />
                  Sửa kịch bản
                </MenuItem>
              )}
              {fixOrTalk && view && (
                <MenuItem
                  onClick={() =>
                    run(async () => {
                      // The chat fixes the take worked on: this one.
                      if (!working && selectedModel) {
                        await api.invoke("video:take", {
                          ...ids,
                          action: "focus",
                          model: selectedModel,
                        });
                      }
                      addRefs(sessionId, [script.id]);
                      requestChatFocus(sessionId);
                    })
                  }
                >
                  {canFix(view) ? <WandSparkles /> : <MessageSquarePlus />}
                  {canFix(view) ? "Sửa video" : "Nhắc trong chat"}
                </MenuItem>
              )}
              {restorable && view && (
                <MenuItem
                  onClick={() => run(() => api.invoke("video:restore", { ...ids, ...takeArg }))}
                >
                  <History />
                  {previousIsNewer(view) ? "Bản sau" : "Bản trước"}
                </MenuItem>
              )}
              {deletable && (
                <MenuItem
                  destructive
                  onClick={() =>
                    run(async () => {
                      await api.invoke("video:take", {
                        ...ids,
                        action: "delete",
                        model: selectedModel as string,
                      });
                      setTab(null);
                    })
                  }
                >
                  <Trash2 />
                  Xóa bản này
                </MenuItem>
              )}
              {several && job && (
                <MenuItem disabled className="cursor-default tabular-nums text-muted-foreground">
                  Tổng đã chi {formatCost(spentUsd(job))}
                </MenuItem>
              )}
            </MenuPopup>
          </Menu>
        )}
      </div>

      {/* Row 2: the takes, by model. */}
      {showTabs && job && (
        <div
          role="tablist"
          aria-label="Các bản"
          className="mt-1 flex flex-wrap items-center gap-1 pl-7.5"
        >
          {takes.map((model) => {
            const t = viewTake(job, model);
            const busy = t.status === "running" || t.status === "waiting";
            const spent = t.status === "done" ? takeCostUsd(job, model) : null;
            return (
              <Button
                key={model}
                role="tab"
                aria-selected={model === selectedModel}
                variant={model === selectedModel ? "secondary" : "ghost-muted"}
                size="xs"
                onClick={() => setTab(model)}
              >
                {several && model === chosenModel(job) && <Check />}
                {videoModel(model).name}
                {(busy || spent !== null) && (
                  <span className="font-normal text-muted-foreground tabular-nums">
                    {busy
                      ? t.status === "waiting"
                        ? "· chờ"
                        : `· Cảnh ${doneShots(t)}/${t.shots.length}`
                      : `· ${formatCost(spent as number)}`}
                  </span>
                )}
              </Button>
            );
          })}
          {view && base && (
            <VideoModelMenu
              label="Thử mô hình khác"
              trigger={<Button variant="ghost-muted" size="xs" />}
              triggerContent={
                <>
                  <Plus />
                  Thử mô hình khác
                </>
              }
              resolution={view.resolution === "1080p" ? "1080p" : "720p"}
              disabled={(m) => takes.includes(m.id)}
              price={(m) => {
                const usd = takes.includes(m.id) ? null : takePrice(m.id);
                return usd === null
                  ? null
                  : { usd, seconds: view.finalSec ?? view.dialogueSec ?? 0 };
              }}
              onChange={setTrying}
            />
          )}
        </div>
      )}
      {trying && base && (
        <div className="mt-2 ml-7.5 flex w-fit max-w-full flex-wrap items-center gap-2 rounded-lg border bg-popover py-1.5 pr-1.5 pl-2.5 shadow-sm">
          <span className="text-xs text-muted-foreground">{videoModel(trying).name}</span>
          <HoldButton size="xs" tone="outline" onHold={() => run(() => startTake(trying))}>
            Giữ để tạo
            <ButtonPrice>~{formatCost(takePrice(trying) ?? 0)}</ButtonPrice>
          </HoldButton>
          <Button variant="ghost-muted" size="xs" onClick={() => setTrying(null)}>
            Hủy
          </Button>
        </div>
      )}

      {/* Row 3: the selected take's status and cost; the dialogue once it exists. */}
      <div className="mt-1 flex min-h-6 flex-wrap items-center gap-x-2.5 gap-y-1 pl-7.5">
        <span className="text-xs text-muted-foreground tabular-nums">
          <span className={cn(view?.status === "failed" && "text-destructive-foreground")}>
            {statusLine(view, script, averages, now)}
          </span>
          {/* The Media level, not a model; videos made before levels existed keep their model's name. */}
          {(!job || job.level) && (
            <>
              {" · "}
              <LevelLabel job={job} batchLevel={make.level} />
            </>
          )}
          {/* Charged so far, never an estimate (an estimate always carries "~"). */}
          {cost && shownCost ? ` · Đã chi ${cost}` : ""}
        </span>
        {job?.offline && active && working && (
          <Button
            variant="ghost-muted"
            size="xs"
            onClick={() => run(() => api.invoke("video:start", ids))}
          >
            <RotateCw />
            Thử lại
          </Button>
        )}
        {view?.dialogue && <DialogueButton key={view.dialogue} job={view} />}
        {error && <span className="text-xs text-destructive-foreground">{error}</span>}
      </div>
      {/* Planned at another level than the batch's now: re-planning is free but slow, so only on request. */}
      {view?.status === "idle" &&
        view.plan &&
        !view.planning &&
        mediaLevel(view.level).id !== mediaLevel(make.level).id && (
          <div className="mt-1 flex items-center gap-2 pl-7.5 text-xs text-muted-foreground">
            Kế hoạch theo {mediaLevel(view.level).label}
            <Button
              variant="outline"
              size="xs"
              onClick={() => run(() => api.invoke("video:replan", ids))}
            >
              Lập lại
            </Button>
          </div>
        )}
      {/* How it will be filmed is read and changed on the Kịch bản tab (Dàn dựng); here only its planning shows. */}
      {view?.planningSteps && (view.planning || jobPhase(view) === "plan") && (
        <PlanningSteps steps={view.planningSteps} className="mt-2 ml-7.5" />
      )}
      {view &&
        (view.status === "running" || view.status === "waiting") &&
        jobPhase(view) !== "plan" && <MakingSteps job={view} />}
      {/* What it costs, row by row, at every stage: planned, being made and finished. */}
      {view?.live && <LivePlanFold job={view} />}
      {view && view.status !== "idle" && (
        <JobBody
          key={selectedModel ?? ""}
          job={view}
          number={number}
          run={run}
          take={working ? undefined : (selectedModel ?? undefined)}
          canAct={switchable}
          playhead={playhead}
        />
      )}
    </li>
  );
}

/** Plays the whole dialogue; pulses until played once. */
function DialogueButton({ job }: { job: VideoJob }) {
  const key = `${job.sessionId}/${job.scriptId}`;
  const heard = useHeard(key);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(
    () => () => {
      audio.current?.pause();
    },
    [],
  );
  const toggle = () => {
    markHeard(key);
    if (!audio.current) {
      audio.current = new Audio(
        mediaUrl.video(job.sessionId, job.scriptId, job.dialogue as string),
      );
      audio.current.onended = () => setPlaying(false);
      audio.current.onpause = () => setPlaying(false);
      audio.current.onplay = () => setPlaying(true);
    }
    if (audio.current.paused) void audio.current.play();
    else audio.current.pause();
  };
  return (
    <Button variant="outline" size="xs" className={cn(!heard && "ring-out")} onClick={toggle}>
      {playing ? <Pause /> : <Play />}
      Lời thoại
    </Button>
  );
}

/**
 * What "Làm lại" on a shot means: the shot itself (always with its video's
 * model), or at the pause the still behind it.
 */
function redoChange(job: VideoJob, shot: JobShot): FixChange {
  const frame = frameFor(job, shot);
  if (job.status === "review" && frame && madeByProvider(shot)) {
    return { op: "redo_still", frame: frame.id };
  }
  return { op: "redo_shot", shot: shot.index };
}

/** What a fix costs, or null when it cannot be made (a product's own photo). */
function priceOf(job: VideoJob, change: FixChange): number | null {
  try {
    return fixPriceUsd(job, [change], new Date().toISOString());
  } catch {
    return null;
  }
}

function JobBody({
  job,
  number,
  run,
  take,
  canAct,
  playhead,
}: {
  job: VideoJob;
  /** The video's number in the list; a shot is named within it ("Video #2 · Cảnh 3"). */
  number: number;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  /** A parked take shown: fixes make it the one worked on first. */
  take?: string;
  /** Nothing blocks acting on this take (another take is not rendering). */
  canAct: boolean;
  /** Playback time, kept when switching takes. */
  playhead: { current: number };
}) {
  const phase = jobPhase(job);
  const [picked, setPicked] = useState<number | null>(null);
  const url = (file: string) => mediaUrl.video(job.sessionId, job.scriptId, file);
  const fixable = canFix(job) && canAct;
  const selected = fixable && picked !== null ? (job.shots[picked] ?? null) : null;
  const tiles = job.shots.map((shot) => (
    <ShotTile
      key={shot.index}
      job={job}
      shot={shot}
      selected={selected?.index === shot.index}
      onPick={fixable ? () => setPicked((p) => (p === shot.index ? null : shot.index)) : undefined}
    />
  ));

  // One shot picked on a finished video (or at the pause): make it again, or talk about it.
  let bar: ReactNode = null;
  if (selected) {
    const change = redoChange(job, selected);
    const price = priceOf(job, change);
    bar = (
      // Stays in view under a tall grid, so the actions are never a scroll away.
      <div className="sticky bottom-2 z-10 mt-2.5 flex w-fit max-w-full flex-wrap items-center gap-2 rounded-lg border bg-popover py-1.5 pr-1.5 pl-2.5 shadow-sm">
        <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          Video #{number} · Cảnh {selected.index + 1}
        </span>
        {price !== null && (
          <HoldButton
            size="xs"
            tone="outline"
            onHold={() =>
              run(async () => {
                await api.invoke("video:fix", {
                  sessionId: job.sessionId,
                  scriptId: job.scriptId,
                  changes: [change],
                  ...(take ? { take } : {}),
                });
                setPicked(null);
              })
            }
          >
            <RotateCw />
            Giữ để làm lại
            <ButtonPrice>~{formatCost(price)}</ButtonPrice>
          </HoldButton>
        )}
        <Button
          variant="ghost-muted"
          size="xs"
          onClick={() => {
            addRefs(job.sessionId, [job.scriptId]);
            requestChatFocus(job.sessionId, `Video #${number}, cảnh ${selected.index + 1}: `);
          }}
        >
          <MessageSquarePlus />
          Nhắc trong chat
        </Button>
      </div>
    );
  }

  // While a fix runs, the video from before it stays playable.
  const playable = job.final ?? (job.status !== "done" ? job.previous?.final : undefined);
  if (playable) {
    return (
      <div className="mt-3.5 grid grid-cols-[minmax(0,320px)_1fr] items-start gap-4 max-md:grid-cols-1">
        {/* biome-ignore lint/a11y/useMediaCaption: subtitles are burned into the video */}
        <video
          key={playable}
          src={url(playable)}
          onLoadedMetadata={(e) => {
            if (playhead.current < e.currentTarget.duration) {
              e.currentTarget.currentTime = playhead.current;
            }
          }}
          onTimeUpdate={(e) => {
            playhead.current = e.currentTarget.currentTime;
          }}
          controls
          playsInline
          preload="metadata"
          // Contain, not cover: in full screen a 9:16 video keeps its whole picture (black bars at the sides).
          className="aspect-[9/16] w-full rounded-xl bg-black object-contain"
        />
        <div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2">{tiles}</div>
          {bar}
          {phase === "assemble" && job.status === "running" && <AssembleBar job={job} />}
        </div>
      </div>
    );
  }
  return (
    <>
      <div
        className={cn(
          "mt-3.5 grid gap-2",
          // At the pause the stills are what is being judged: show them larger.
          job.status === "review"
            ? "grid-cols-[repeat(auto-fill,minmax(132px,1fr))]"
            : "grid-cols-[repeat(auto-fill,minmax(96px,1fr))]",
        )}
      >
        {tiles}
      </div>
      {bar}
      {phase === "assemble" && job.status === "running" && <AssembleBar job={job} />}
    </>
  );
}

function AssembleBar({ job }: { job: VideoJob }) {
  return (
    <div className="mt-3.5 h-1 overflow-hidden rounded-full bg-muted">
      <div
        className="h-full bg-primary transition-[width] duration-500"
        style={{ width: `${(job.assembleProgress ?? 0) * 100}%` }}
      />
    </div>
  );
}

function ShotTile({
  job,
  shot,
  selected,
  onPick,
}: {
  job: VideoJob;
  shot: JobShot;
  selected?: boolean;
  /** Picks the shot for "Làm lại" and "Nhắc trong chat"; absent while the video is being made. */
  onPick?: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const frame = frameFor(job, shot);
  const url = (file: string) => mediaUrl.video(job.sessionId, job.scriptId, file);
  const image = frame?.file ? url(frame.file) : null;
  const drawing = !frame?.file && job.status === "running" && jobPhase(job) === "frames";
  const number = (
    <span
      className={cn(
        "absolute top-1 left-1.5 text-2xs tabular-nums",
        image ? "text-white [text-shadow:0_1px_2px_#000]" : "text-muted-foreground",
      )}
    >
      {shot.index + 1}
    </span>
  );
  const caption = (
    <span className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 to-transparent px-1.5 pt-4 pb-1.5 text-2xs leading-snug text-white">
      {shot.text}
    </span>
  );
  const retryMark = shot.retried && shot.state !== "failed" && (
    <RotateCw
      aria-label="Đã thử lại"
      className={cn(
        "absolute top-1 right-1.5 size-3 text-white [filter:drop-shadow(0_1px_1px_#000)]",
        onPick && "group-hover/tile:hidden group-focus-visible/tile:hidden",
      )}
    />
  );
  // Shows that a click opens "Giữ để làm lại" before the click is made.
  const redoMark = onPick && !selected && (
    <span
      aria-hidden
      className="absolute top-1 right-1 hidden items-center gap-0.5 rounded-full bg-black/60 px-1.5 py-0.5 text-2xs text-white group-hover/tile:inline-flex group-focus-visible/tile:inline-flex"
    >
      <RotateCw className="size-2.5" />
      Làm lại
    </span>
  );
  const base = cn(
    "relative aspect-[9/16] overflow-hidden rounded-[10px] border bg-muted",
    selected && "ring-2 ring-ring ring-offset-1 ring-offset-card",
  );

  if (shot.state === "done" && shot.clip) {
    const play = () => void video.current?.play().catch(() => undefined);
    const pause = () => video.current?.pause();
    return (
      <button
        type="button"
        className={cn(base, "group/tile cursor-pointer text-left")}
        title={`Cảnh ${shot.index + 1}`}
        onPointerEnter={play}
        onPointerLeave={pause}
        onFocus={play}
        onBlur={pause}
        aria-pressed={onPick ? Boolean(selected) : undefined}
        onClick={() => (onPick ? onPick() : video.current?.paused ? play() : pause())}
      >
        <video
          ref={video}
          src={url(shot.clip)}
          poster={image ?? undefined}
          muted
          loop
          playsInline
          preload="none"
          className="size-full object-cover"
        />
        {number}
        {retryMark}
        {redoMark}
        {caption}
      </button>
    );
  }

  if (!image) {
    // Before the frame exists: the line itself.
    return (
      <div className={cn(base, !shot.audio && "border-dashed", drawing && "shimmer")}>
        {number}
        <span className="absolute inset-0 overflow-hidden px-1.5 pt-5 pb-1.5 text-2xs leading-snug text-muted-foreground">
          {shot.text}
        </span>
      </div>
    );
  }

  // At the pause the stills are what is judged: full colour, and each can be picked.
  if (job.status === "review" && onPick) {
    return (
      <button
        type="button"
        className={cn(base, "group/tile cursor-pointer text-left")}
        title={`Cảnh ${shot.index + 1}`}
        aria-pressed={Boolean(selected)}
        onClick={onPick}
      >
        <img src={image} alt="" className="size-full object-cover" />
        {number}
        {redoMark}
        {caption}
      </button>
    );
  }

  return (
    <div className={cn(base, shot.state === "stopped" && "opacity-40")}>
      <img
        src={image}
        alt=""
        className={cn(
          "size-full object-cover",
          shot.state !== "rendering" && "opacity-60 grayscale-[0.6]",
        )}
      />
      {shot.state === "rendering" && (
        <span className="absolute inset-0 animate-[shimmer_1.6s_linear_infinite] bg-[length:250%_100%] bg-[linear-gradient(100deg,transparent_30%,rgb(255_255_255/0.45)_50%,transparent_70%)]" />
      )}
      {number}
      {retryMark}
      {caption}
      {shot.state === "failed" && (
        <span className="absolute inset-0 grid place-items-center bg-black/30">
          <HoldButton
            size="xs"
            tone="outline"
            onHold={() =>
              api.invoke("video:retry-shot", {
                sessionId: job.sessionId,
                scriptId: job.scriptId,
                shot: shot.index,
              })
            }
          >
            <RotateCw />
            Thử lại
          </HoldButton>
        </span>
      )}
    </div>
  );
}
