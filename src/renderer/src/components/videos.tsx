import { boardOrder, estimateSeconds, estimateUsd, formatSeconds } from "@shared/board";
import { formatCost } from "@shared/credits";
import { mediaUrl, type Script } from "@shared/ipc";
import { committedIds, finishedScripts } from "@shared/ready-check";
import {
  canFix,
  canRestore,
  type FixChange,
  fixPriceUsd,
  previousIsNewer,
} from "@shared/video-fix";
import {
  costToFinishUsd,
  doneShots,
  followBatch,
  frameFor,
  type JobShot,
  jobPhase,
  lossIfStoppedUsd,
  madeByProvider,
  modelLocked,
  remainingSec,
  type StepAverages,
  spentUsd,
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
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { markHeard, useHeard, useNow, useVideoJobs } from "@/lib/video-jobs";
import { useWorkspace } from "@/lib/workspace";
import { Page } from "./page";
import { makeLabel, useMakeVideos } from "./ready-check";
import { Button } from "./ui/button";
import { ButtonPrice, HoldButton } from "./ui/hold-button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { VideoModelMenu } from "./video-model-menu";

// The Video tab (prototypes/video-generation, third version): a card per
// finished script. Committed scripts show their job: one status line, the
// dialogue once it exists, a tile per shot, and the finished video. Every
// action that spends money is held. Jobs run in the main process; this only
// shows them (docs/VIDEO_GENERATION_DECISIONS.md).

const STOP_HOLD_MS = 1200;

export function VideosList({ sessionId }: { sessionId: string }) {
  const board = useBoard(sessionId);
  const session = useWorkspace().sessions.find((s) => s.id === sessionId);
  const state = useVideoJobs(sessionId);
  const make = useMakeVideos({ sessionId });
  // The batch button runs everything once the ready check lets the new ones through.
  const runAll = async () => {
    await api.invoke("video:make-all", { sessionId, scriptIds: [] });
  };
  const makeAll = useMakeVideos({ sessionId, onStarted: runAll });
  const [allError, setAllError] = useState<string | null>(null);
  if (!board || !session || !state) return null;
  const order = boardOrder(board.scripts);
  const committed = committedIds(session, board.scripts);
  const finished = finishedScripts(board.scripts);
  const sent = finished.filter((s) => committed.includes(s.id));
  const rest = finished.filter((s) => !committed.includes(s.id));
  const restIds = rest.map((s) => s.id);
  const restUsd = rest.reduce(
    (n, s) =>
      n +
      estimateUsd(s.lines, {
        frames: make.frames,
        model: make.model,
        resolution: make.resolution,
        cutoutUsd: make.cutouts(s),
      }),
    0,
  );

  // Sent videos the one button also takes to the end: not started, waiting at
  // "Nghe và xem thử", stopped or failed, or a test video that would still stop.
  const stalled = sent.filter((s) => {
    const job = state.jobs.get(s.id);
    if (!job) return true;
    if (job.status === "running" || job.status === "waiting") return job.pause && !job.reviewed;
    return job.status !== "done";
  });
  const stalledUsd = stalled.reduce((n, s) => {
    const job = state.jobs.get(s.id);
    return (
      n +
      (job
        ? costToFinishUsd(job)
        : estimateUsd(s.lines, {
            frames: make.frames,
            model: make.model,
            resolution: make.resolution,
            cutoutUsd: make.cutouts(s),
          }))
    );
  }, 0);
  const count = rest.length + stalled.length;
  // One unsent script uses the group's own wording; a lone sent one has its card's button.
  const showAll = count > 1 || rest.length === 1;

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
      // With one left, the batch button already names it.
      ownMake={rest.length > 1}
    />
  );
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
  const holdAll = async () => {
    setAllError(null);
    try {
      await api.invoke("video:make-all", { sessionId, scriptIds: restIds });
    } catch (e) {
      setAllError(errorMessage(e));
    }
  };
  const error = allError ?? makeAll.error;

  // One button makes every video on the tab that is not finished, end to end
  // (docs/VIDEO_COMMIT_DECISIONS.md, "Auto mode"). Made videos first; scripts
  // still waiting follow as one group.
  return (
    <Page className="pt-4">
      {showAll && (
        <div className="mb-3 flex min-h-9 items-center gap-2.5">
          <h3 className="flex-1 text-sm text-muted-foreground tabular-nums">
            {committed.length > 0 ? `Còn ${count} video` : `${count} video`}
            {` · ${videoModel(make.model).name}`}
          </h3>
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
        </div>
      )}
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
      {makeAll.dialog}
    </Page>
  );
}

const minutes = (seconds: number) => `còn ~${Math.max(1, Math.round(seconds / 60))} phút`;

function statusLine(job: VideoJob | null, script: Script, averages: StepAverages, now: number) {
  if (!job || job.status === "idle") return formatSeconds(estimateSeconds(script.lines));
  const done = doneShots(job);
  const total = job.shots.length;
  switch (job.status) {
    case "waiting":
      return "Chờ video trước";
    case "done":
      return "Xong";
    case "review":
      return "Nghe và xem thử";
    case "stopped":
      return `Đã dừng · ${done}/${total} cảnh`;
    case "failed": {
      const failed = job.shots.filter((s) => s.state === "failed").length;
      return failed ? `Lỗi ${failed} cảnh · ${done}/${total} cảnh` : `Lỗi · ${job.error ?? ""}`;
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
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  // Until its first shot is sent, a video uses the batch's model and size as they are now.
  const job = saved && followBatch(saved, make.batch);
  const active = job?.status === "running" || job?.status === "waiting";
  const now = useNow(job?.status === "running");
  const ids = { sessionId, scriptId: script.id };
  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const estimate = estimateUsd(script.lines, {
    frames: make.frames,
    model: make.model,
    resolution: make.resolution,
    cutoutUsd: make.cutouts(script),
  });

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

  // Tabs once the model is fixed (a single take too, so the model is always named).
  const showTabs = Boolean(job && modelLocked(job));
  const several = takes.length > 1;
  /** What a whole video with the selected take's model cost; null when unknown. */
  const ownCost = job && selectedModel ? takeCostUsd(job, selectedModel) : null;
  const shownCost = several ? ownCost : job ? spentUsd(job) : null;

  let cost: string | null = null;
  let action: ReactNode = null;
  if (!committed) {
    if (ownMake)
      action = make.needsCheck([script.id]) ? (
        <Button variant="outline" onClick={() => make.open([script.id])}>
          {makeLabel(1, { hold: false })}
          <ButtonPrice>~{formatCost(estimate)}</ButtonPrice>
        </Button>
      ) : (
        <HoldButton tone="outline" onHold={() => make.make([script.id])}>
          {makeLabel(1)}
          <ButtonPrice>~{formatCost(estimate)}</ButtonPrice>
        </HoldButton>
      );
  } else if (!job || job.status === "idle") {
    action = (
      <HoldButton onHold={() => run(() => api.invoke("video:start", ids))}>
        {makeLabel(1)}
        <ButtonPrice>~{formatCost(job ? costToFinishUsd(job) : estimate)}</ButtonPrice>
      </HoldButton>
    );
  } else if (active && working) {
    // This take so far, and all-in when finished.
    const left = totalEstimateUsd(job) - spentUsd(job);
    cost =
      shownCost === null ? null : `${formatCost(shownCost)} / ~${formatCost(shownCost + left)}`;
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
    cost = shownCost === null ? null : formatCost(shownCost);
    action = (
      <HoldButton onHold={() => run(() => api.invoke("video:start", ids))}>
        Giữ để quay
        <ButtonPrice>~{formatCost(costToFinishUsd(job))}</ButtonPrice>
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
  } else {
    // Stopped or failed: continue, paying only for what is missing.
    cost = shownCost === null ? null : formatCost(shownCost);
    action = (
      <HoldButton onHold={() => run(() => api.invoke("video:start", ids))}>
        Giữ để tạo tiếp
        <ButtonPrice>~{formatCost(costToFinishUsd(job))}</ButtonPrice>
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
          <HoldButton size="xs" onHold={() => run(() => startTake(trying))}>
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
          {!showTabs && " · "}
          {showTabs ? null : job && !modelLocked(job) ? (
            // Not shot yet: this video's own model, overriding the batch.
            <VideoModelMenu
              label="Mô hình AI"
              value={job.model}
              trigger={
                <button
                  type="button"
                  className="cursor-pointer underline decoration-dotted underline-offset-2 hover:text-foreground"
                />
              }
              triggerContent={videoModel(job.model).name}
              resolution={job.resolution === "1080p" ? "1080p" : "720p"}
              price={(m) => ({
                usd: costToFinishUsd(followBatch({ ...job, ownModel: m.id }, make.batch)),
                seconds: job.dialogueSec ?? estimateSeconds(script.lines),
              })}
              onChange={(model) => run(() => api.invoke("video:set-model", { ...ids, model }))}
            />
          ) : (
            videoModel(make.model).name
          )}
          {cost && ` · ${cost}`}
        </span>
        {view?.dialogue && <DialogueButton job={view} />}
        {error && <span className="text-xs text-destructive-foreground">{error}</span>}
      </div>
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
  run: (action: () => Promise<unknown>) => Promise<void>;
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
      <div className="mt-3.5 grid grid-cols-[200px_1fr] items-start gap-3.5 max-sm:grid-cols-1">
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
          className="aspect-[9/16] w-full rounded-xl bg-black object-cover"
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
