import { boardOrder, formatClock, formatSeconds } from "@shared/board";
import { inFlightUsd, stillToPayUsd } from "@shared/cost/estimate";
import { estimateText, moneyText, paidSoFar } from "@shared/cost/table";
import { formatCost } from "@shared/credits";
import { failedUnpaid, videoUntouched } from "@shared/edit-in-place";
import { mediaUrl, type Script } from "@shared/ipc";
import { type JobModels, modelsLabel, resolvedModels } from "@shared/models";
import { isNetworkMessage, OFFLINE_MESSAGE } from "@shared/net-error";
import { scriptSeconds } from "@shared/pace";
import { stillOwedHint } from "@shared/paid-work";
import { phaseSecNow, timed, totalSec } from "@shared/phase-clock";
import { committedIds, finishedScripts } from "@shared/ready-check";
import { sceneNotes } from "@shared/scene-notes";
import { OUTDATED_TEXT, readyToMake } from "@shared/staging-status";
import { finishedLength, jobTempo } from "@shared/tempo";
import {
  canFix,
  canRestore,
  type FixChange,
  fixPriceUsd,
  MADE_THE_OLD_WAY,
  previousIsNewer,
} from "@shared/video-fix";
import {
  doneShots,
  failedSegmentAt,
  followSeriesModels,
  frameFor,
  isGenerated,
  type JobShot,
  jobPhase,
  madeByProvider,
  modelsOf,
  remainingSec,
  type StepAverages,
  segmentAnchor,
  stopsForPreview,
  type TimedPhase,
  type VideoJob,
} from "@shared/video-job";
import { useNavigate } from "@tanstack/react-router";
import {
  Check,
  Clock,
  Ellipsis,
  History,
  LoaderCircle,
  Maximize2,
  MessageSquarePlus,
  Pause,
  Pencil,
  Play,
  RotateCw,
  TriangleAlert,
  WandSparkles,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { addRefs, editAsNewVersion, requestChatFocus, useBoard } from "@/lib/board";
import { type ScriptStaging, STAGE_LABEL, stagingOf } from "@/lib/staging";
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
import { useSeriesTargetSec, useWorkspace } from "@/lib/workspace";
import { ImageViewer, type ViewerImage } from "./image-viewer";
import { LivePlanFold } from "./live-plan";
import { MakeAll, priceOfThisHold, useBatch } from "./make-all";
import { Page } from "./page";
import { stagingText, useMakeVideos } from "./ready-check";
import { SaveVideosButton } from "./save-videos";
import { PlanningSteps } from "./shot-brief";
import { TempoMenu } from "./tempo-menu";
import { Button } from "./ui/button";
import { ButtonPrice, HoldButton } from "./ui/hold-button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { VideoLength } from "./video-length";

const STOP_HOLD_MS = 1200;

export function VideosList({ sessionId }: { sessionId: string }) {
  const board = useBoard(sessionId);
  const { sessions } = useWorkspace();
  const session = sessions.find((s) => s.id === sessionId);
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

  return (
    <Page className="pt-2">
      <ul className="flex flex-col gap-4">
        {sent.map((script) => (
          <VideoCard
            key={script.id}
            sessionId={sessionId}
            script={script}
            number={order.indexOf(script) + 1}
            job={state.jobs.get(script.id) ?? null}
            averages={state.averages}
            make={make}
          />
        ))}
      </ul>
    </Page>
  );
}

export function VideosToolbar({ sessionId }: { sessionId: string }) {
  const batch = useBatch(sessionId);
  const all = useAction();
  if (!batch) return null;
  const { stalled, stagingOfScript } = batch;
  const staging = stalled.filter((s) => stagingOfScript(s).status === "staging").length;
  const unstaged = stalled.filter((s) => stagingOfScript(s).canStage);
  const stageAll = () =>
    all.run(() => api.invoke("video:stage", { sessionId, scriptIds: unstaged.map((s) => s.id) }));
  const several = stalled.length > 1;

  return (
    <div className="flex items-center gap-2.5">
      {several && all.error && (
        <span className="text-xs text-destructive-foreground">{all.error}</span>
      )}
      {several && staging > 0 && (
        <span className="text-xs text-muted-foreground tabular-nums">{stagingText(staging)}</span>
      )}
      {several && unstaged.length > 0 && (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
          {unstaged.length} video chưa dàn dựng
          <Button variant="outline" size="xs" onClick={stageAll}>
            Dàn dựng
          </Button>
        </span>
      )}
      <SaveVideosButton sessionId={sessionId} />
      <MakeAll sessionId={sessionId} batch={batch} />
    </div>
  );
}

function ModelsRow({ job, series }: { job: VideoJob | null; series: JobModels }) {
  const label = modelsLabel(job ? modelsOf(job) : series);
  const kept = Boolean(job?.modelsKept) && modelsLabel(series) !== label;
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-muted-foreground">Mô hình</span>
      {kept ? (
        <Tooltip>
          <TooltipTrigger render={<span className="cursor-default font-medium text-foreground" />}>
            {label}
          </TooltipTrigger>
          <TooltipPopup side="top" align="center" className="text-xs">
            Video đã bắt đầu tạo nên giữ mô hình này
          </TooltipPopup>
        </Tooltip>
      ) : (
        <span className="font-medium text-foreground">{label}</span>
      )}
    </span>
  );
}

const hasPlanTable = (job: VideoJob) => Boolean(job.live);

const minutes = (seconds: number) => `còn ~${Math.max(1, Math.round(seconds / 60))} phút`;

function stagingLine({ status, reasons }: ScriptStaging): string | null {
  if (status === "staging") return "Đang dàn dựng";
  if (status === "outdated" && reasons[0]) return OUTDATED_TEXT[reasons[0]];
  return null;
}

function statusLine(
  job: VideoJob | null,
  seconds: number,
  staging: ScriptStaging,
  averages: StepAverages,
  now: number,
): string | null {
  const stagingNow = stagingLine(staging);
  if (stagingNow) return stagingNow;
  const length = formatSeconds(seconds);
  if (staging.canStage && staging.status === "none") {
    return `Chưa dàn dựng · ${length}`;
  }
  if (!job || job.status === "idle") return length;
  if (job.offline && (job.status === "running" || job.status === "waiting")) return OFFLINE_MESSAGE;
  const done = doneShots(job);
  const total = job.shots.length;
  switch (job.status) {
    case "waiting":
      return "Chờ video trước";
    case "done":
      return null;
    case "review":
      return "Xem cảnh chính";
    case "stopped":
      return `Đã dừng · ${done}/${total} cảnh`;
    case "failed": {
      const failed =
        job.shots.filter((s) => s.state === "failed").length +
        (job.segments ?? []).filter((s) => s.state === "failed").length;
      if (failed) return `Lỗi ${failed} cảnh · ${done}/${total} cảnh`;
      return isNetworkMessage(job.error) ? "Mất kết nối" : `Lỗi · ${job.error ?? ""}`;
    }
  }
  const elapsed = timed(job) ? formatClock(totalSec(phaseSecNow(job, now))) : null;
  const left = minutes(remainingSec(job, averages, now));
  const phase = jobPhase(job);
  if (phase === "plan") return [PLAN_LABEL, elapsed, left].filter(Boolean).join(" · ");
  if (phase === "assemble" || phase === "done") return elapsed;
  return elapsed ? `${elapsed} · ${left}` : left;
}

type Stage = {
  label: string;
  state: "done" | "now" | "next";
  count?: string;
  phases: readonly TimedPhase[];
};

const PLAN_LABEL = "Lên cảnh quay";

const ORDER: readonly string[] = ["frames", "speech", "shots", "assemble"];

function stages(job: VideoJob): Stage[] {
  const phase = jobPhase(job);
  const order = ORDER;
  const at = order.indexOf(phase === "voice" ? "speech" : phase);
  const state = (name: string): Stage["state"] => {
    const i = order.indexOf(name);
    return phase === "done" || i < at ? "done" : i === at ? "now" : "next";
  };
  const stills = job.frames.filter((f) => isGenerated(job, f) || f.kind === "product");
  const made = stills.filter((f) => f.file).length;
  const shots = job.shots.filter((s) => s.state === "done").length;
  const rendering = job.shots.filter((s) => s.state === "rendering").length;
  const segments = job.segments ?? [];
  const spoken = segments.filter((s) => s.state === "done").length;
  const speaking = segments.filter((s) => s.state === "rendering").length;
  const voice: Stage = {
    label: "Tạo lời nói",
    state: state("speech"),
    phases: ["speech", "voice"],
    count: `${spoken}/${segments.length}${speaking && state("speech") === "now" ? ` · ${speaking} đang tạo` : ""}`,
  };
  const frames: Stage = {
    label: "Vẽ khung hình",
    state: state("frames"),
    phases: ["frames"],
    ...(stills.length ? { count: `${made}/${stills.length}` } : {}),
  };
  const voices = characterVoicesStage(job);
  const list: Stage[] = [
    frames,
    ...voices,
    voice,
    {
      label: "Quay cảnh",
      state: state("shots"),
      phases: ["shots"],
      count: `${shots}/${job.shots.length}${rendering && state("shots") === "now" ? ` · ${rendering} đang quay` : ""}`,
    },
    {
      label: "Ghép video và phụ đề",
      state: state("assemble"),
      phases: ["assemble"],
      ...(job.assembleProgress !== undefined && state("assemble") === "now"
        ? { count: `${Math.round(job.assembleProgress * 100)}%` }
        : {}),
    },
  ];
  return stopsAfterStills(job) ? list.slice(0, 1 + voices.length) : list;
}

function characterVoicesStage(job: VideoJob): Stage[] {
  const made = (job.voices ?? []).filter((v) => v.toMake);
  if (!made.length) return [];
  const ready = made.filter((v) => v.ready).length;
  const making = job.status === "running" || made.some((v) => v.requestId && !v.ready);
  return [
    {
      label: "Tạo giọng nhân vật",
      state: ready === made.length ? "done" : making ? "now" : "next",
      phases: [],
      count: `${ready}/${made.length}`,
    },
  ];
}

const stopsAfterStills = (job: VideoJob) =>
  Boolean(
    job.pause &&
      !job.reviewed &&
      job.shots.every((s) => s.state === "queued" || s.state === "planned"),
  );

function stageSec(spent: Partial<Record<TimedPhase, number>>, stage: Stage): number | null {
  const recorded = stage.phases.filter((p) => spent[p] !== undefined);
  return recorded.length ? recorded.reduce((n, p) => n + (spent[p] ?? 0), 0) : null;
}

function MakingSteps({ job, now }: { job: VideoJob; now: number }) {
  const spent = phaseSecNow(job, now);
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
          {stage.state !== "next" && stageSec(spent, stage) !== null && (
            <span className="text-muted-foreground">
              {formatClock(stageSec(spent, stage) ?? 0)}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function MakingTime({ job }: { job: VideoJob }) {
  const spent = job.phaseSec;
  if (!spent) return null;
  const total = totalSec(spent);
  if (!(total > 0)) return null;
  const rows = [
    { label: PLAN_LABEL, sec: spent.plan },
    ...stages({ ...job, pause: false }).map((stage) => ({
      label: stage.label,
      sec: stageSec(spent, stage) ?? undefined,
    })),
  ].filter((row) => row.sec !== undefined);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="flex cursor-default items-center gap-1 text-muted-foreground tabular-nums" />
        }
      >
        <Clock className="size-3" aria-hidden />
        {formatClock(total)}
      </TooltipTrigger>
      <TooltipPopup side="top" align="start" className="text-xs tabular-nums">
        <div className="flex flex-col gap-0.5">
          {rows.map((row) => (
            <div key={row.label} className="flex justify-between gap-4">
              <span>{row.label}</span>
              <span>{formatClock(row.sec ?? 0)}</span>
            </div>
          ))}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

function VideoCard({
  sessionId,
  script,
  number,
  job: saved,
  averages,
  make,
}: {
  sessionId: string;
  script: Script;
  number: number;
  job: VideoJob | null;
  averages: StepAverages;
  make: ReturnType<typeof useMakeVideos>;
}) {
  const { error, run } = useAction();
  const navigate = useNavigate();
  const seriesTargetSec = useSeriesTargetSec(sessionId);
  const job = saved && followSeriesModels(saved, make.models);
  const active = job?.status === "running" || job?.status === "waiting";
  const now = useNow(job?.status === "running");
  const ids = { sessionId, scriptId: script.id };
  const stagingFailedBeforeSpending = Boolean(job && failedUnpaid(job));
  const staging = stagingOf(job, script);
  const stageThis = () =>
    run(() => api.invoke("video:stage", { sessionId, scriptIds: [script.id] }));
  const playhead = useRef(0);
  const oldWay = Boolean(job?.dubbed);

  const status = statusLine(job, scriptSeconds(script, seriesTargetSec), staging, averages, now);
  const length = job?.status === "done" && job.final ? finishedLength(job) : null;
  const shownCost = job ? moneyText(paidSoFar(job)) : null;

  let cost: string | null = null;
  let action: ReactNode = null;
  if (staging.status === "staging") {
    action = (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" />
        ~1–2 phút
      </span>
    );
  } else if (!job || job.status === "idle") {
    action =
      job && readyToMake(job, script) ? (
        <HoldButton tone="outline" onHold={() => run(() => api.invoke("video:start", ids))}>
          {stopsForPreview(job) ? "Giữ để tạo các cảnh chính" : "Giữ để tạo video"}
          <ButtonPrice>{priceOfThisHold(job)}</ButtonPrice>
        </HoldButton>
      ) : staging.canStage ? (
        <Button variant="outline" onClick={stageThis}>
          {STAGE_LABEL[staging.status]}
        </Button>
      ) : null;
  } else if (active) {
    const left = stillToPayUsd(job);
    cost =
      shownCost === null
        ? null
        : left === null
          ? shownCost
          : `${shownCost} · còn ${estimateText(left)}`;
    action = (
      <HoldButton
        tone="stop"
        ms={STOP_HOLD_MS}
        hint={stillOwedHint(inFlightUsd(job))}
        onHold={() => run(() => api.invoke("video:stop", ids))}
      >
        Dừng
      </HoldButton>
    );
  } else if (job.status === "review") {
    cost = hasPlanTable(job) ? null : shownCost;
    action = (
      <HoldButton tone="outline" onHold={() => run(() => api.invoke("video:start", ids))}>
        Giữ để tạo video
        <ButtonPrice>{priceOfThisHold(job)}</ButtonPrice>
      </HoldButton>
    );
  } else if (job.status === "done") {
    cost = shownCost;
    action = (
      <Button variant="outline" onClick={() => run(() => api.invoke("video:save", ids))}>
        Tải xuống
      </Button>
    );
  } else if (stagingFailedBeforeSpending) {
    action = staging.canStage ? (
      <Button variant="outline" onClick={stageThis}>
        {STAGE_LABEL[staging.status]}
      </Button>
    ) : null;
  } else {
    cost = shownCost;
    action = (
      <HoldButton tone="outline" onHold={() => run(() => api.invoke("video:start", ids))}>
        {stopsForPreview(job) ? "Giữ để tạo các cảnh chính" : "Giữ để tạo tiếp"}
        <ButtonPrice>{priceOfThisHold(job)}</ButtonPrice>
      </HoldButton>
    );
  }

  const fixOrTalk = Boolean(job && !oldWay && job.status !== "idle" && job.status !== "waiting");
  const restorable = Boolean(job && canRestore(job));
  return (
    <li className="rounded-xl border bg-card p-4">
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
        <Menu>
          <MenuTrigger render={<Button variant="ghost-muted" size="icon-sm" aria-label="Thêm" />}>
            <Ellipsis />
          </MenuTrigger>
          <MenuPopup align="end">
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
            {oldWay && (
              <MenuItem onClick={() => run(() => api.invoke("video:remake", ids))}>
                <RotateCw />
                Tạo lại video
              </MenuItem>
            )}
            {fixOrTalk && job && (
              <MenuItem
                onClick={() => {
                  addRefs(sessionId, [script.id]);
                  requestChatFocus(sessionId);
                }}
              >
                {canFix(job) ? <WandSparkles /> : <MessageSquarePlus />}
                {canFix(job) ? "Sửa video" : "Nhắc trong chat"}
              </MenuItem>
            )}
            {restorable && job && (
              <MenuItem onClick={() => run(() => api.invoke("video:restore", ids))}>
                <History />
                {previousIsNewer(job) ? "Bản sau" : "Bản trước"}
              </MenuItem>
            )}
          </MenuPopup>
        </Menu>
      </div>

      <div className="mt-1 flex min-h-7 flex-wrap items-center gap-x-2.5 gap-y-1 pl-7.5 text-xs">
        {oldWay ? (
          <span className="text-muted-foreground">{MADE_THE_OLD_WAY}</span>
        ) : (
          <ModelsRow job={job} series={resolvedModels(make.models)} />
        )}
        {job?.status === "done" && <MakingTime job={job} />}
        {length && <VideoLength length={length} />}
        {(job?.final || job?.previous?.final) && (
          <TempoMenu
            value={job.tempo}
            onChange={(tempo) => run(() => api.invoke("video:tempo", { ...ids, tempo }))}
          />
        )}
        {status && (
          <span
            className={cn(
              "text-muted-foreground tabular-nums",
              job?.status === "failed" && "text-destructive-foreground",
            )}
          >
            {status}
          </span>
        )}
        {cost && !hasPlanTable(job as VideoJob) && (
          <span className="text-muted-foreground tabular-nums">Đã chi {cost}</span>
        )}
        {job?.offline && active && (
          <Button
            variant="ghost-muted"
            size="xs"
            onClick={() => run(() => api.invoke("video:start", ids))}
          >
            <RotateCw />
            Thử lại
          </Button>
        )}
        {error && <span className="text-destructive-foreground">{error}</span>}
        {job?.dialogue && (
          <span className="ml-auto">
            <DialogueButton key={job.dialogue} job={job} />
          </span>
        )}
      </div>
      {job?.planningSteps && (job.planning || jobPhase(job) === "plan") && (
        <PlanningSteps steps={job.planningSteps} className="mt-2 ml-7.5" />
      )}
      {job &&
        (job.status === "running" || job.status === "waiting") &&
        jobPhase(job) !== "plan" && <MakingSteps job={job} now={now} />}
      {job && hasPlanTable(job) && (!videoUntouched(job) || staging.status === "ready") && (
        <LivePlanFold job={job} />
      )}
      {job && job.status !== "idle" && (
        <JobBody job={job} number={number} run={run} playhead={playhead} />
      )}
    </li>
  );
}

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

function redoChange(job: VideoJob, shot: JobShot): FixChange {
  const frame = frameFor(job, shot);
  if (job.status === "review" && frame && madeByProvider(shot)) {
    return { op: "redo_still", frame: frame.id };
  }
  return { op: "redo_shot", shot: shot.index };
}

function priceOf(job: VideoJob, change: FixChange): number | null {
  try {
    return fixPriceUsd(job, [change], new Date().toISOString());
  } catch {
    return null;
  }
}

function playAtTempo(video: HTMLVideoElement, tempo: number) {
  video.preservesPitch = true;
  video.defaultPlaybackRate = tempo;
  video.playbackRate = tempo;
}

function JobBody({
  job,
  number,
  run,
  playhead,
}: {
  job: VideoJob;
  number: number;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  playhead: { current: number };
}) {
  const phase = jobPhase(job);
  const [picked, setPicked] = useState<number | null>(null);
  const url = (file: string) => mediaUrl.video(job.sessionId, job.scriptId, file);
  const fixable = canFix(job);
  const redoable = (shot: JobShot) => fixable && priceOf(job, redoChange(job, shot)) !== null;
  const pickedShot = picked !== null ? job.shots[picked] : undefined;
  const selected = pickedShot && redoable(pickedShot) ? pickedShot : null;
  const thumbs = useRef(new Map<number, HTMLElement>());
  const [viewing, setViewing] = useState<{ at: number; from: number } | null>(null);
  const stills = stillsOf(job);
  const viewerImages: ViewerImage[] = stills.map((still) => ({
    url: url(still.file),
    label: `Cảnh ${still.shots.map((i) => i + 1).join(", ")}`,
    origin: () => {
      const from = viewing && still.shots.includes(viewing.from) ? viewing.from : still.shots[0];
      return from === undefined ? null : (thumbs.current.get(from) ?? null);
    },
  }));
  const view = (shot: number) => {
    const at = stills.findIndex((still) => still.shots.includes(shot));
    if (at >= 0) setViewing({ at, from: shot });
  };
  const tiles = job.shots.map((shot) => (
    <ShotTile
      key={shot.index}
      job={job}
      shot={shot}
      selected={selected?.index === shot.index}
      onPick={
        redoable(shot) ? () => setPicked((p) => (p === shot.index ? null : shot.index)) : undefined
      }
      onView={() => view(shot.index)}
      thumbRef={(el) => {
        if (el) thumbs.current.set(shot.index, el);
        else thumbs.current.delete(shot.index);
      }}
    />
  ));
  const viewer = (
    <ImageViewer
      images={viewerImages}
      index={viewing?.at ?? null}
      onIndexChange={(at) => setViewing((v) => v && { ...v, at })}
      onClose={() => setViewing(null)}
    />
  );

  let bar: ReactNode = null;
  if (selected) {
    const change = redoChange(job, selected);
    const price = priceOf(job, change);
    bar = (
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

  const previousVideoWhileFixRuns = job.status !== "done" ? job.previous?.final : undefined;
  const playable = job.final ?? previousVideoWhileFixRuns;
  const tempo = jobTempo(job);
  if (playable) {
    return (
      <div className="mt-3.5 grid grid-cols-[minmax(0,320px)_1fr] items-start gap-4 max-md:grid-cols-1">
        {/* biome-ignore lint/a11y/useMediaCaption: subtitles are burned into the video */}
        <video
          key={playable}
          ref={(video) => {
            if (video) playAtTempo(video, tempo);
          }}
          src={url(playable)}
          onLoadedMetadata={(e) => {
            playAtTempo(e.currentTarget, tempo);
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
          className="aspect-[9/16] w-full rounded-xl bg-black object-contain"
        />
        <div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2">{tiles}</div>
          {bar}
          {phase === "assemble" && job.status === "running" && <AssembleBar job={job} />}
        </div>
        {viewer}
      </div>
    );
  }
  return (
    <>
      <div
        className={cn(
          "mt-3.5 grid gap-2",
          job.status === "review"
            ? "grid-cols-[repeat(auto-fill,minmax(132px,1fr))]"
            : "grid-cols-[repeat(auto-fill,minmax(96px,1fr))]",
        )}
      >
        {tiles}
      </div>
      {bar}
      {phase === "assemble" && job.status === "running" && <AssembleBar job={job} />}
      {viewer}
    </>
  );
}

function stillsOf(job: VideoJob): { file: string; shots: number[] }[] {
  const stills: { file: string; shots: number[] }[] = [];
  for (const shot of job.shots) {
    const file = frameFor(job, shot)?.file;
    if (!file) continue;
    const still = stills.find((s) => s.file === file);
    if (still) still.shots.push(shot.index);
    else stills.push({ file, shots: [shot.index] });
  }
  return stills;
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

function Viewable({
  onView,
  className,
  children,
  ...pointer
}: {
  onView: () => void;
  className?: string;
  children: ReactNode;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}) {
  return (
    <div className={cn("group/view relative", className)} {...pointer}>
      {children}
      <button
        type="button"
        aria-label="Xem ảnh"
        title="Xem ảnh"
        className="absolute top-1 left-1 grid size-5 cursor-zoom-in place-items-center rounded-full bg-black/60 text-white opacity-0 outline-none group-focus-within/view:opacity-100 group-hover/view:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onView}
      >
        <Maximize2 className="size-3" aria-hidden />
      </button>
    </div>
  );
}

function ShotTile({
  job,
  shot,
  selected,
  onPick,
  onView,
  thumbRef,
}: {
  job: VideoJob;
  shot: JobShot;
  selected?: boolean;
  onPick?: () => void;
  onView: () => void;
  thumbRef: (el: HTMLElement | null) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const frame = frameFor(job, shot);
  const url = (file: string) => mediaUrl.video(job.sessionId, job.scriptId, file);
  const image = frame?.file ? url(frame.file) : null;
  const drawing = !frame?.file && job.status === "running" && jobPhase(job) === "frames";
  const speechFailed = Boolean(failedSegmentAt(job, shot.index));
  const speaking = (job.segments ?? []).some(
    (s) => s.state === "rendering" && segmentAnchor(s) === shot.index,
  );
  const rendering = shot.state === "rendering" || speaking;
  const number = (
    <span
      className={cn(
        "absolute top-1 left-1.5 text-2xs tabular-nums",
        image
          ? "text-white [text-shadow:0_1px_2px_#000] group-focus-within/view:opacity-0 group-hover/view:opacity-0"
          : "text-muted-foreground",
      )}
    >
      {shot.index + 1}
    </span>
  );
  const notes = sceneNotes(job, shot);
  const notesMark = notes.length > 0 && <NotesMark notes={notes} />;
  const caption = (
    <span
      className={cn(
        "absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 to-transparent px-1.5 pt-4 pb-1.5 text-2xs leading-snug text-white",
        notesMark && "pr-6",
      )}
    >
      {shot.text}
    </span>
  );
  const reusedMark = (frame?.source === "material" || shot.reused) && (
    <span
      title="Lấy từ tư liệu của series"
      className={cn(
        "absolute top-1 right-1 rounded-full bg-black/60 px-1.5 py-0.5 text-2xs leading-none text-white",
        onPick && !selected && "group-hover/tile:hidden group-focus-visible/tile:hidden",
      )}
    >
      Dùng lại
    </span>
  );
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
    "relative block aspect-[9/16] w-full overflow-hidden rounded-[10px] border bg-muted",
    selected && "ring-2 ring-ring ring-offset-1 ring-offset-card",
  );

  if (shot.state === "done" && shot.clip) {
    const play = () => void video.current?.play().catch(() => undefined);
    const pause = () => video.current?.pause();
    const main = (
      <button
        type="button"
        className={cn(base, "group/tile cursor-pointer text-left")}
        title={`Cảnh ${shot.index + 1}`}
        onFocus={play}
        onBlur={pause}
        aria-pressed={onPick ? Boolean(selected) : undefined}
        onClick={() => (onPick ? onPick() : video.current?.paused ? play() : pause())}
      >
        <video
          ref={(el) => {
            video.current = el;
            thumbRef(el);
          }}
          src={url(shot.clip)}
          poster={image ?? undefined}
          muted
          loop
          playsInline
          preload="none"
          className="size-full object-cover"
        />
        {number}
        {reusedMark}
        {redoMark}
        {caption}
      </button>
    );
    return image ? (
      <Viewable onView={onView} onPointerEnter={play} onPointerLeave={pause}>
        {main}
        {notesMark}
      </Viewable>
    ) : (
      <div className="relative" onPointerEnter={play} onPointerLeave={pause}>
        {main}
        {notesMark}
      </div>
    );
  }

  if (!image) {
    return (
      <div className={cn(base, shot.end === undefined && "border-dashed", drawing && "shimmer")}>
        {number}
        <span className="absolute inset-0 overflow-hidden px-1.5 pt-5 pb-1.5 text-2xs leading-snug text-muted-foreground">
          {shot.text}
        </span>
        {notesMark}
      </div>
    );
  }

  if (job.status === "review" && onPick) {
    return (
      <Viewable onView={onView}>
        <button
          type="button"
          className={cn(base, "group/tile cursor-pointer text-left")}
          title={`Cảnh ${shot.index + 1}`}
          aria-pressed={Boolean(selected)}
          onClick={onPick}
        >
          <img ref={thumbRef} src={image} alt="" className="size-full object-cover" />
          {number}
          {reusedMark}
          {redoMark}
          {caption}
        </button>
        {notesMark}
      </Viewable>
    );
  }

  return (
    <Viewable onView={onView}>
      <div className={cn(base, shot.state === "stopped" && "opacity-40")}>
        <img
          ref={thumbRef}
          src={image}
          alt=""
          className={cn("size-full object-cover", !rendering && "opacity-60 grayscale-[0.6]")}
        />
        {rendering && (
          <span className="absolute inset-0 animate-[shimmer_1.6s_linear_infinite] bg-[length:250%_100%] bg-[linear-gradient(100deg,transparent_30%,rgb(255_255_255/0.45)_50%,transparent_70%)]" />
        )}
        {number}
        {reusedMark}
        {caption}
        {(shot.state === "failed" || speechFailed) && (
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
        {notesMark}
      </div>
    </Viewable>
  );
}

function NotesMark({ notes }: { notes: string[] }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<button type="button" />}
        aria-label={notes.join(" ")}
        className="absolute right-1 bottom-1 z-10 grid size-5 cursor-default place-items-center rounded-full bg-black/60 text-warning outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <TriangleAlert className="size-3" aria-hidden />
      </TooltipTrigger>
      <TooltipPopup side="top" align="end" className="max-w-64 space-y-1 text-xs">
        {notes.map((note) => (
          <p key={note}>{note}</p>
        ))}
      </TooltipPopup>
    </Tooltip>
  );
}
