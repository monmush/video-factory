import { boardOrder, estimateSeconds, formatClock, formatSeconds } from "@shared/board";
import { spentUsd } from "@shared/cost/charges";
import { costToFinishUsd, inFlightUsd, stillToPayUsd } from "@shared/cost/estimate";
import { estimateText, type Money, moneyText, paidSoFar } from "@shared/cost/table";
import { formatCost } from "@shared/credits";
import { failedUnpaid, videoUntouched } from "@shared/edit-in-place";
import { mediaUrl, type Script } from "@shared/ipc";
import { type MediaLevel, type MediaLevelId, mediaLevel } from "@shared/media-level";
import { isNetworkMessage, OFFLINE_MESSAGE } from "@shared/net-error";
import { stillOwedHint } from "@shared/paid-work";
import { phaseSecNow, timed, totalSec } from "@shared/phase-clock";
import { committedIds, finishedScripts } from "@shared/ready-check";
import { OUTDATED_TEXT, readyToMake } from "@shared/staging-status";
import { type Tempo, tempoOf } from "@shared/tempo";
import {
  canFix,
  canRestore,
  type FixChange,
  fixPriceUsd,
  previousIsNewer,
} from "@shared/video-fix";
import {
  doneShots,
  failedSegmentAt,
  followBatch,
  frameFor,
  isGenerated,
  isNative,
  type JobShot,
  jobPhase,
  madeByProvider,
  remainingSec,
  type StepAverages,
  segmentAnchor,
  stopsForPreview,
  type TimedPhase,
  type VideoJob,
} from "@shared/video-job";
import {
  canSwitch,
  chosenVersion,
  focusVersion,
  levelsToTry,
  planAtLevel,
  versionCostUsd,
  versionLabel,
  versionPriceUsd,
  versions,
  versionsByLevel,
  versionView,
  viewVersion,
  workingVersion,
} from "@shared/video-takes";
import { useNavigate } from "@tanstack/react-router";
import {
  Check,
  Clock,
  Ellipsis,
  History,
  Layers,
  LoaderCircle,
  Maximize2,
  MessageSquarePlus,
  Pause,
  Pencil,
  Play,
  RotateCw,
  Trash2,
  WandSparkles,
  X,
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
import { useWorkspace } from "@/lib/workspace";
import { ImageViewer, type ViewerImage } from "./image-viewer";
import { LivePlanFold } from "./live-plan";
import { MakeAll, priceOfThisHold, useBatch } from "./make-all";
import { Page } from "./page";
import { VideoQuality } from "./quality-chip";
import { stagingText, useMakeVideos } from "./ready-check";
import { SaveVideosButton } from "./save-videos";
import { PlanningSteps } from "./shot-brief";
import { TempoMenu } from "./tempo-menu";
import { Button } from "./ui/button";
import { ButtonPrice, HoldButton } from "./ui/hold-button";
import { Menu, MenuItem, MenuPopup, MenuSub, MenuSubTrigger, MenuTrigger } from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const STOP_HOLD_MS = 1200;

export function VideosList({ sessionId }: { sessionId: string }) {
  const board = useBoard(sessionId);
  const { sessions, series } = useWorkspace();
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

  const notStarted = finished.filter((s) => {
    const job = state.jobs.get(s.id);
    return !job || job.status === "idle";
  }).length;
  const seriesLevel = mediaLevel(series.find((x) => x.id === session.seriesId)?.mediaLevel).id;
  const setBatchLevel = (id: MediaLevelId) =>
    api.invoke("session:update", {
      id: sessionId,
      settings: { mediaLevel: id === seriesLevel ? null : id },
    });

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
            notStarted={notStarted}
            onBatchLevel={setBatchLevel}
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

const hasPlanTable = (job: VideoJob) => Boolean(job.live);

const minutes = (seconds: number) => `còn ~${Math.max(1, Math.round(seconds / 60))} phút`;

function stagingLine({ status, reasons }: ScriptStaging): string | null {
  if (status === "staging") return "Đang dàn dựng";
  if (status === "outdated" && reasons[0]) return OUTDATED_TEXT[reasons[0]];
  return null;
}

function statusLine(
  job: VideoJob | null,
  script: Script,
  staging: ScriptStaging,
  averages: StepAverages,
  now: number,
): string | null {
  const stagingNow = stagingLine(staging);
  if (stagingNow) return stagingNow;
  const length = formatSeconds(estimateSeconds(script.lines));
  if (!job?.plan && staging.canStage && staging.status === "none") {
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
      return isNative(job) ? "Xem cảnh chính" : "Nghe và xem cảnh chính";
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

const DUBBED_ORDER = ["voice", "frames", "shots", "assemble"] as const;
const NATIVE_ORDER = ["frames", "speech", "shots", "assemble"] as const;

function stages(job: VideoJob): Stage[] {
  const phase = jobPhase(job);
  const native = isNative(job);
  const order: readonly string[] = native ? NATIVE_ORDER : DUBBED_ORDER;
  const at = order.indexOf(native && phase === "voice" ? "speech" : phase);
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
  const voice: Stage = native
    ? {
        label: "Tạo lời nói",
        state: state("speech"),
        phases: ["speech", "voice"],
        count: `${spoken}/${segments.length}${speaking && state("speech") === "now" ? ` · ${speaking} đang tạo` : ""}`,
      }
    : { label: "Tạo giọng đọc", state: state("voice"), phases: ["voice"] };
  const frames: Stage = {
    label: "Vẽ khung hình",
    state: state("frames"),
    phases: ["frames"],
    ...(stills.length ? { count: `${made}/${stills.length}` } : {}),
  };
  const list: Stage[] = [
    ...(native ? [frames, voice] : [voice, frames]),
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
  return stopsAfterStills(job) ? list.slice(0, native ? 1 : 2) : list;
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
  notStarted,
  onBatchLevel,
}: {
  sessionId: string;
  script: Script;
  number: number;
  job: VideoJob | null;
  averages: StepAverages;
  make: ReturnType<typeof useMakeVideos>;
  notStarted: number;
  onBatchLevel: (level: MediaLevelId) => Promise<unknown>;
}) {
  const { error, run } = useAction();
  const navigate = useNavigate();
  const ownLevel = make.levelOf(script.id);
  const job = saved && followBatch(saved, make.batchFor(script.id));
  const active = job?.status === "running" || job?.status === "waiting";
  const now = useNow(job?.status === "running");
  const ids = { sessionId, scriptId: script.id };
  const stagingFailedBeforeSpending = Boolean(job && failedUnpaid(job));
  const staging = stagingOf(job, script, ownLevel);
  const stageThis = () =>
    run(() => api.invoke("video:stage", { sessionId, scriptIds: [script.id] }));

  const [tab, setTab] = useState<string | null>(null);
  const [trying, setTrying] = useState<MediaLevelId | null>(null);
  const [offer, setOffer] = useState<MediaLevelId | null>(null);
  const playheadAcrossVersions = useRef(0);
  const all = job ? versions(job) : [];
  const several = all.length > 1;
  const selected = job ? (tab && all.includes(tab) ? tab : chosenVersion(job)) : null;
  const view = job && selected ? versionView(job, selected) : job;
  const working = Boolean(job && selected === workingVersion(job));
  const chosen = Boolean(job && selected === chosenVersion(job));
  const versionArg = working ? {} : { version: selected ?? undefined };
  const switchable = Boolean(job && (working || canSwitch(job)));
  const base = (() => {
    if (!job || !selected || !view?.final || view.status !== "done" || !canSwitch(job)) {
      return null;
    }
    try {
      return focusVersion(job, selected, new Date().toISOString());
    } catch {
      return null;
    }
  })();
  const toTry = base ? levelsToTry(base) : [];
  const priceOfVersion = (level: string) => {
    try {
      return base ? versionPriceUsd(base, level, new Date().toISOString()) : null;
    } catch {
      return null;
    }
  };
  const startVersionAt = async (level: MediaLevelId) => {
    if (!working && selected) {
      await api.invoke("video:version", { ...ids, action: "focus", version: selected });
    }
    await api.invoke("video:version", { ...ids, action: "start", version: level });
    setTrying(null);
    setTab(level);
  };
  const pickVersion = async (version: string) => {
    await api.invoke("video:version", { ...ids, action: "use", version });
    const offersLevel = job && versionsByLevel(job) && version !== make.level && notStarted > 0;
    setOffer(offersLevel ? (version as MediaLevelId) : null);
  };

  const unstartedVideo = !job || job.status === "idle";
  const status = statusLine(view, script, staging, averages, now);
  const priceAt = (level: MediaLevel) => {
    if (job?.status !== "idle" || !readyToMake(job, script, level.id)) return null;
    const at = level.id === mediaLevel(job.level).id ? job : planAtLevel(job, level.id);
    return at ? costToFinishUsd(at) : null;
  };
  const setLevel = (level: MediaLevelId) => run(() => api.invoke("video:level", { ...ids, level }));

  const versionPaid = (): Money | null => {
    if (!job || !view) return null;
    if (!several || !selected) return paidSoFar(job);
    const usd = versionCostUsd(job, selected);
    return usd === null ? null : { usd, billed: paidSoFar(view).billed };
  };
  const shownPaid = versionPaid();
  const shownCost = shownPaid ? moneyText(shownPaid) : null;

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
      job && readyToMake(job, script, ownLevel) ? (
        <HoldButton tone="outline" onHold={() => run(() => api.invoke("video:start", ids))}>
          {stopsForPreview(job) ? "Giữ để tạo các cảnh chính" : "Giữ để tạo video"}
          <ButtonPrice>{priceOfThisHold(job)}</ButtonPrice>
        </HoldButton>
      ) : staging.canStage ? (
        <Button variant="outline" onClick={stageThis}>
          {STAGE_LABEL[staging.status]}
        </Button>
      ) : null;
  } else if (active && working) {
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
  } else if (view?.status === "review") {
    cost = hasPlanTable(view) ? null : shownCost;
    action = (
      <HoldButton tone="outline" onHold={() => run(() => api.invoke("video:start", ids))}>
        Giữ để tạo video
        <ButtonPrice>{priceOfThisHold(job)}</ButtonPrice>
      </HoldButton>
    );
  } else if (view?.status === "done" || active) {
    cost = shownCost;
    action =
      chosen || !view?.final ? (
        <Button variant="outline" onClick={() => run(() => api.invoke("video:save", ids))}>
          Tải xuống
        </Button>
      ) : (
        <Button variant="outline" onClick={() => run(() => pickVersion(selected as string))}>
          <Check />
          Dùng bản này
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

  const fixOrTalk = Boolean(
    view && view.status !== "idle" && view.status !== "waiting" && switchable,
  );
  const restorable = Boolean(view && canRestore(view) && switchable);
  const deletable = Boolean(job && view && !chosen && switchable && view.status !== "running");
  const tryable = toTry.length > 0;
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
            {fixOrTalk && view && (
              <MenuItem
                onClick={() =>
                  run(async () => {
                    if (!working && selected) {
                      await api.invoke("video:version", {
                        ...ids,
                        action: "focus",
                        version: selected,
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
            {tryable && (
              <MenuSub>
                <MenuSubTrigger>
                  <Layers />
                  Thử chất lượng khác
                </MenuSubTrigger>
                <MenuPopup side="inline-end" align="start" className="min-w-44">
                  {toTry.map((level) => {
                    const usd = priceOfVersion(level.id);
                    return (
                      <MenuItem
                        key={level.id}
                        disabled={usd === null}
                        onClick={() => {
                          setOffer(null);
                          setTrying(level.id);
                        }}
                      >
                        <span className="flex-1">{level.label}</span>
                        <span className="pl-3 text-xs text-muted-foreground tabular-nums">
                          ~{formatCost(usd ?? 0)}
                        </span>
                      </MenuItem>
                    );
                  })}
                </MenuPopup>
              </MenuSub>
            )}
            {restorable && view && (
              <MenuItem
                onClick={() => run(() => api.invoke("video:restore", { ...ids, ...versionArg }))}
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
                    await api.invoke("video:version", {
                      ...ids,
                      action: "delete",
                      version: selected as string,
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
                Tổng đã chi {moneyText(paidSoFar(job))}
              </MenuItem>
            )}
          </MenuPopup>
        </Menu>
      </div>

      <div className="mt-1 flex min-h-7 flex-wrap items-center gap-x-2.5 gap-y-1 pl-7.5 text-xs">
        {(several || unstartedVideo || job?.level) && (
          <span className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Chất lượng</span>
            {several && job ? (
              <span role="tablist" aria-label="Các bản" className="flex items-center gap-0.5">
                {all.map((version) => {
                  const v = viewVersion(job, version);
                  const making = v.status === "running" || v.status === "waiting";
                  return (
                    <Button
                      key={version}
                      role="tab"
                      aria-selected={version === selected}
                      variant={version === selected ? "secondary" : "ghost-muted"}
                      size="xs"
                      onClick={() => setTab(version)}
                    >
                      {version === chosenVersion(job) && <Check aria-label="Đang dùng" />}
                      {versionLabel(job, version)}
                      {making && (
                        <LoaderCircle className="size-3 animate-spin" aria-label="Đang tạo" />
                      )}
                    </Button>
                  );
                })}
              </span>
            ) : unstartedVideo ? (
              <VideoQuality value={ownLevel} onChange={setLevel} price={priceAt} />
            ) : (
              <span className="font-medium text-foreground">
                <LevelLabel job={job} batchLevel={make.level} />
              </span>
            )}
          </span>
        )}
        {view?.status === "done" && <MakingTime job={view} />}
        {(view?.final || view?.previous?.final) && (
          <TempoMenu
            value={view.tempo}
            onChange={(tempo) => run(() => api.invoke("video:tempo", { ...ids, tempo }))}
          />
        )}
        {status && (
          <span
            className={cn(
              "text-muted-foreground tabular-nums",
              view?.status === "failed" && "text-destructive-foreground",
            )}
          >
            {status}
          </span>
        )}
        {cost && !hasPlanTable(view as VideoJob) && (
          <span className="text-muted-foreground tabular-nums">Đã chi {cost}</span>
        )}
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
        {error && <span className="text-destructive-foreground">{error}</span>}
        {view?.dialogue && (
          <span className="ml-auto">
            <DialogueButton key={view.dialogue} job={view} />
          </span>
        )}
      </div>
      {trying && base && (
        <div className="mt-2 ml-7.5 flex w-fit max-w-full flex-wrap items-center gap-2 rounded-lg border bg-popover py-1.5 pr-1.5 pl-2.5 shadow-sm">
          <span className="text-xs text-muted-foreground">{mediaLevel(trying).label}</span>
          <HoldButton size="xs" tone="outline" onHold={() => run(() => startVersionAt(trying))}>
            Giữ để tạo
            <ButtonPrice>~{formatCost(priceOfVersion(trying) ?? 0)}</ButtonPrice>
          </HoldButton>
          <Button variant="ghost-muted" size="xs" onClick={() => setTrying(null)}>
            Hủy
          </Button>
        </div>
      )}
      {offer && (
        <div className="mt-1 flex items-center gap-1.5 pl-7.5 text-xs text-muted-foreground">
          Dùng {mediaLevel(offer).label} cho {notStarted} video chưa tạo?
          <Button
            variant="outline"
            size="xs"
            onClick={() =>
              run(async () => {
                await onBatchLevel(offer);
                setOffer(null);
              })
            }
          >
            Dùng
          </Button>
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label="Bỏ qua"
            onClick={() => setOffer(null)}
          >
            <X />
          </Button>
        </div>
      )}
      {view?.planningSteps && (view.planning || jobPhase(view) === "plan") && (
        <PlanningSteps steps={view.planningSteps} className="mt-2 ml-7.5" />
      )}
      {view &&
        (view.status === "running" || view.status === "waiting") &&
        jobPhase(view) !== "plan" && <MakingSteps job={view} now={now} />}
      {view && hasPlanTable(view) && (!videoUntouched(view) || staging.status === "ready") && (
        <LivePlanFold job={view} />
      )}
      {view && view.status !== "idle" && (
        <JobBody
          key={selected ?? ""}
          job={view}
          number={number}
          run={run}
          version={working ? undefined : (selected ?? undefined)}
          canAct={switchable}
          playhead={playheadAcrossVersions}
        />
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

function playAtTempo(video: HTMLVideoElement, tempo: Tempo) {
  video.preservesPitch = true;
  video.defaultPlaybackRate = tempo;
  video.playbackRate = tempo;
}

function JobBody({
  job,
  number,
  run,
  version,
  canAct,
  playhead,
}: {
  job: VideoJob;
  number: number;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  version?: string;
  canAct: boolean;
  playhead: { current: number };
}) {
  const phase = jobPhase(job);
  const [picked, setPicked] = useState<number | null>(null);
  const url = (file: string) => mediaUrl.video(job.sessionId, job.scriptId, file);
  const fixable = canFix(job) && canAct;
  const pickedShot = picked !== null ? job.shots[picked] : undefined;
  const selected =
    fixable && pickedShot && (!isNative(job) || priceOf(job, redoChange(job, pickedShot)) !== null)
      ? pickedShot
      : null;
  const redoable = (shot: JobShot) =>
    fixable && (!isNative(job) || priceOf(job, redoChange(job, shot)) !== null);
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
                  ...(version ? { version } : {}),
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
  const tempo = tempoOf(job.tempo);
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
        {retryMark}
        {redoMark}
        {caption}
      </button>
    );
    return image ? (
      <Viewable onView={onView} onPointerEnter={play} onPointerLeave={pause}>
        {main}
      </Viewable>
    ) : (
      <div className="relative" onPointerEnter={play} onPointerLeave={pause}>
        {main}
      </div>
    );
  }

  if (!image) {
    return (
      <div className={cn(base, !shot.audio && "border-dashed", drawing && "shimmer")}>
        {number}
        <span className="absolute inset-0 overflow-hidden px-1.5 pt-5 pb-1.5 text-2xs leading-snug text-muted-foreground">
          {shot.text}
        </span>
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
          {redoMark}
          {caption}
        </button>
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
        {retryMark}
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
      </div>
    </Viewable>
  );
}
