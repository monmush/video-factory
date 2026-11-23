import { estimateSeconds, formatSeconds } from "@shared/board";
import { costToFinishUsd } from "@shared/cost/estimate";
import type { Script } from "@shared/ipc";
import { type MediaLevel, type MediaLevelId, mediaLevel } from "@shared/media-level";
import { isFirstBatch } from "@shared/ready-check";
import { OUTDATED_TEXT, readyToMake, stageable } from "@shared/staging-status";
import { followBatch, stopsForPreview, type VideoJob } from "@shared/video-job";
import { planAtLevel } from "@shared/video-takes";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  ChevronRight,
  Clapperboard,
  Ellipsis,
  LoaderCircle,
  MessageSquarePlus,
  Pencil,
  RotateCw,
} from "lucide-react";
import { type MouseEvent, type ReactNode, useState } from "react";
import { api } from "@/lib/api";
import {
  addRefs,
  FULL_CARDS_MAX,
  requestCardFocus,
  requestChatFocus,
  testCardId,
  useBoardView,
} from "@/lib/board";
import type { ScriptStaging } from "@/lib/staging";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";
import { LivePlanFold } from "./live-plan";
import { type Batch, MakeAll, priceOfThisHold, useBatch } from "./make-all";
import { QualityChip, VideoQuality } from "./quality-chip";
import { ReadyCheckDialog, useBatchMediaLevel } from "./ready-check";
import { ShotBrief } from "./shot-brief";
import { Button } from "./ui/button";
import { ButtonPrice, HoldButton } from "./ui/hold-button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";

const DIMMED = "opacity-50 hover:opacity-80 focus-within:opacity-80";

function onStagingStep(batch: Batch) {
  const stageableScripts = batch.finished.filter(stageable);
  const started = stageableScripts.filter((s) => batch.stagingOfScript(s).status === "started");
  const unstarted = stageableScripts.filter((s) => !started.includes(s));
  return { unstarted, started };
}

function useTestChoice(sessionId: string, batch: Batch | null) {
  const { sessions } = useWorkspace();
  const [view, setView] = useBoardView(sessionId);
  if (!batch) return null;
  const { session, finished } = batch;
  const nudge = !session.approvedAt && isFirstBatch(session, sessions) && finished.length > 1;
  if (!nudge) return null;
  const testId = testCardId(
    view,
    finished.map((s) => s.id),
  );
  return {
    test: finished.find((s) => s.id === testId) ?? null,
    isTest: (id: string) => id === testId,
    isDimmed: (id: string) => id !== testId && !view.previewAll,
    pick: (id: string) => setView({ testId: id }),
  };
}

export function StagingList({ sessionId }: { sessionId: string }) {
  const batch = useBatch(sessionId);
  const testChoice = useTestChoice(sessionId, batch);
  const navigate = useNavigate();
  const { error, run } = useAction();
  const [openCards, setOpenCards] = useState<Record<string, boolean>>({});
  if (!batch) return null;
  const { unstarted, started } = onStagingStep(batch);
  const toStage = unstarted.filter((s) => batch.stagingOfScript(s).canStage);
  const anyReady = unstarted.some((s) => batch.stagingOfScript(s).status === "ready");
  const stageRest = () =>
    run(() => api.invoke("video:stage", { sessionId, scriptIds: toStage.map((s) => s.id) }));
  const grid = unstarted.length <= FULL_CARDS_MAX;
  const number = (s: Script) => batch.order.indexOf(s) + 1;
  const toVideos = () => navigate({ to: "/sessions/$sessionId/videos", params: { sessionId } });

  const pay = async (ids: string[]) => {
    const unsent = ids.filter((id) => !batch.committed.includes(id));
    if (unsent.length) await api.invoke("session:approve", sessionId, unsent);
    for (const scriptId of ids) await api.invoke("video:start", { sessionId, scriptId });
    await toVideos();
  };
  const make = (script: Script) =>
    !batch.committed.includes(script.id) && batch.make.needsCheck([script.id])
      ? batch.make.open([script.id])
      : run(() => pay([script.id]));

  if (unstarted.length === 0) {
    return (
      <section className="px-6 pt-4 pb-8">
        {started.length > 0 ? (
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground">Tất cả đã gửi tạo video</span>
            <Button
              variant="outline"
              render={<Link to="/sessions/$sessionId/videos" params={{ sessionId }} />}
            >
              Xem video
              <ArrowRight />
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground">Chưa có kịch bản.</p>
        )}
      </section>
    );
  }

  return (
    <section aria-label="Dàn dựng" className={cn("px-6 pt-2 pb-8", !grid && "mx-auto max-w-5xl")}>
      <BatchQuality sessionId={sessionId}>
        {anyReady && toStage.length > 0 && (
          <Button variant="outline" size="sm" className="ml-auto" onClick={stageRest}>
            Dàn dựng {toStage.length} kịch bản
          </Button>
        )}
      </BatchQuality>
      {error && <p className="mb-3 text-xs text-destructive-foreground">{error}</p>}
      <ul
        className={cn(
          "grid items-start gap-4",
          grid ? "grid-cols-[repeat(auto-fill,minmax(min(100%,400px),1fr))]" : "grid-cols-1",
        )}
      >
        {unstarted.map((script) => (
          <StagingCard
            key={script.id}
            sessionId={sessionId}
            script={script}
            number={number(script)}
            batch={batch}
            open={openCards[script.id] ?? grid}
            onToggle={() =>
              setOpenCards((current) => ({
                ...current,
                [script.id]: !(current[script.id] ?? grid),
              }))
            }
            ownHold={!batch.batchMakesOnlyThisVideo}
            onMake={() => make(script)}
            test={
              testChoice && {
                isTest: testChoice.isTest(script.id),
                dimmed: testChoice.isDimmed(script.id),
                pick: () => testChoice.pick(script.id),
              }
            }
          />
        ))}
      </ul>
      {started.length > 0 && (
        <section className="mt-8">
          <h3 className="mb-3 text-sm text-muted-foreground">Đã gửi tạo video</h3>
          <ul className="flex flex-col gap-2">
            {started.map((script) => (
              <li
                key={script.id}
                className="flex min-h-11 items-center gap-2.5 rounded-xl border bg-card px-4 py-1.5"
              >
                <span className="w-5 text-xs text-muted-foreground tabular-nums">
                  #{number(script)}
                </span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {script.title}
                </span>
                <Button
                  variant="ghost-muted"
                  size="sm"
                  render={<Link to="/sessions/$sessionId/videos" params={{ sessionId }} />}
                >
                  Xem video
                  <ArrowRight />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <ReadyCheckDialog
        sessionId={sessionId}
        scope={batch.make.scope ?? []}
        open={batch.make.scope !== null}
        onOpenChange={(next) => {
          if (!next) batch.make.close();
        }}
        spend={{
          priceOf: (scriptId) => {
            const script = batch.finished.find((s) => s.id === scriptId);
            return script && batch.staged(script) ? batch.priceOf(scriptId) : null;
          },
          staging: (scriptId) => {
            const script = batch.finished.find((s) => s.id === scriptId);
            return Boolean(script && batch.stagingOfScript(script).status === "staging");
          },
          extra: { usd: 0, count: 0, staging: 0 },
          run: pay,
        }}
      />
    </section>
  );
}

function statusLine(script: Script, job: VideoJob | undefined, staging: ScriptStaging): string {
  const length = formatSeconds(estimateSeconds(script.lines));
  switch (staging.status) {
    case "ready":
      return `${job?.shots.length ?? 0} cảnh · ${length}`;
    case "staging":
      return "Đang dàn dựng · ~1–2 phút";
    case "outdated":
      return staging.reasons[0] ? OUTDATED_TEXT[staging.reasons[0]] : length;
    case "failed":
      return job?.error ? `Lỗi dàn dựng · ${job.error}` : "Lỗi dàn dựng";
    default:
      return `Chưa dàn dựng · ${length}`;
  }
}

const STAGE_ACTION: Partial<Record<ScriptStaging["status"], string>> = {
  none: "Dàn dựng",
  outdated: "Cập nhật",
  failed: "Thử lại",
};

function isCardClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (target.closest("button, a, input, textarea, [data-shot-brief]")) return false;
  return !window.getSelection()?.toString();
}

function StagingCard({
  sessionId,
  script,
  number,
  batch,
  open,
  onToggle,
  ownHold,
  onMake,
  test,
}: {
  sessionId: string;
  script: Script;
  number: number;
  batch: Batch;
  open: boolean;
  onToggle: () => void;
  ownHold: boolean;
  onMake: () => void;
  test: { isTest: boolean; dimmed: boolean; pick: () => void } | null;
}) {
  const { error, run } = useAction();
  const navigate = useNavigate();
  const saved = batch.jobOf(script.id);
  const level = batch.make.levelOf(script.id);
  const job = saved && followBatch(saved, batch.make.batchFor(script.id));
  const staging = batch.stagingOfScript(script);
  const ids = { sessionId, scriptId: script.id };
  const stage = (again = false) =>
    run(() =>
      api.invoke("video:stage", { sessionId, scriptIds: [script.id], ...(again ? { again } : {}) }),
    );
  const priceAt = (at: MediaLevel) => {
    if (saved?.status !== "idle" || !readyToMake(saved, script, at.id)) return null;
    const plan = at.id === mediaLevel(saved.level).id ? saved : planAtLevel(saved, at.id);
    return plan ? costToFinishUsd(plan) : null;
  };
  const setLevel = (next: MediaLevelId) =>
    run(() => api.invoke("video:level", { ...ids, level: next }));
  const dimmed = Boolean(test?.dimmed);
  const ready = staging.status === "ready" && job;
  const needsCheck = !batch.committed.includes(script.id) && batch.make.needsCheck([script.id]);

  let action: ReactNode = null;
  const stageLabel = STAGE_ACTION[staging.status];
  if (stageLabel) {
    action = (
      <Button variant="outline" onClick={() => stage()}>
        {stageLabel}
      </Button>
    );
  } else if (staging.status === "staging") {
    action = (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" />
        <Button
          variant="ghost-muted"
          size="xs"
          onClick={() => run(() => api.invoke("video:stage-stop", ids))}
        >
          Dừng
        </Button>
      </span>
    );
  } else if (ready && ownHold) {
    const label = stopsForPreview(job) ? "các cảnh chính" : "video";
    action = needsCheck ? (
      <Button variant="outline" onClick={onMake}>
        Tạo {label}
        <ButtonPrice>{priceOfThisHold(job)}</ButtonPrice>
      </Button>
    ) : (
      <HoldButton tone="outline" onHold={onMake}>
        Giữ để tạo {label}
        <ButtonPrice>{priceOfThisHold(job)}</ButtonPrice>
      </HoldButton>
    );
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: picking the test video is also in the card menu
    <li
      className={cn(
        "rounded-xl border bg-card p-4 transition-opacity",
        dimmed && cn(DIMMED, "cursor-pointer"),
      )}
      title={dimmed ? "Chọn làm video thử" : undefined}
      onClick={(e) => {
        if (dimmed && isCardClick(e)) test?.pick();
      }}
    >
      <div className="flex min-h-9 items-center gap-2.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="-ml-1 flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-1 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
          <span className="text-xs text-muted-foreground tabular-nums">#{number}</span>
          <span className="line-clamp-2 min-w-0 font-semibold leading-snug text-balance">
            {script.title}
            {script.version && (
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                bản {script.version}
              </span>
            )}
          </span>
        </button>
        <Menu>
          <MenuTrigger render={<Button variant="ghost-muted" size="icon-sm" aria-label="Thêm" />}>
            <Ellipsis />
          </MenuTrigger>
          <MenuPopup align="end">
            {test && !test.isTest && (
              <MenuItem onClick={test.pick}>
                <Clapperboard />
                Chọn làm video thử
              </MenuItem>
            )}
            {staging.status === "ready" && (
              <MenuItem onClick={() => stage(true)}>
                <RotateCw />
                Dàn dựng lại
              </MenuItem>
            )}
            <MenuItem
              onClick={() => {
                addRefs(sessionId, [script.id]);
                requestChatFocus(sessionId);
              }}
            >
              <MessageSquarePlus />
              Nhắc trong chat
            </MenuItem>
            <MenuItem
              onClick={() => {
                requestCardFocus(sessionId, script.id);
                void navigate({ to: "/sessions/$sessionId/scripts", params: { sessionId } });
              }}
            >
              <Pencil />
              Sửa kịch bản
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      <div className="mt-1 flex min-h-7 flex-wrap items-center gap-x-2.5 gap-y-1 pl-6 text-xs">
        <span
          className={cn(
            "text-muted-foreground tabular-nums",
            staging.status === "failed" && "text-destructive-foreground",
          )}
        >
          {statusLine(script, saved, staging)}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Chất lượng</span>
          <VideoQuality value={level} onChange={setLevel} price={priceAt} />
        </span>
        {error && <span className="text-destructive-foreground">{error}</span>}
        <span className="ml-auto flex items-center gap-2.5 text-sm">{action}</span>
      </div>
      {open && (
        <>
          {ready && job.live && <LivePlanFold job={job} />}
          <ShotBrief sessionId={sessionId} script={script} className="mt-3 pl-6" />
        </>
      )}
    </li>
  );
}

function BatchQuality({ sessionId, children }: { sessionId: string; children?: ReactNode }) {
  const { sessions, series } = useWorkspace();
  const session = sessions.find((s) => s.id === sessionId);
  const seriesLevel = mediaLevel(series.find((s) => s.id === session?.seriesId)?.mediaLevel).id;
  const level = useBatchMediaLevel(sessionId);
  const { error, run } = useAction();
  const setLevel = (id: string) =>
    run(() =>
      api.invoke("session:update", {
        id: sessionId,
        settings: { mediaLevel: id === seriesLevel ? null : id },
      }),
    );
  return (
    <div className="mb-3 flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-muted/60 px-3 py-1.5">
      <span className="text-xs text-muted-foreground">Thiết lập</span>
      <QualityChip value={level.id} onChange={setLevel} seriesDefault={seriesLevel} />
      {error && <span className="text-xs text-destructive-foreground">{error}</span>}
      {children}
    </div>
  );
}

export function StagingToolbar({ sessionId }: { sessionId: string }) {
  const batch = useBatch(sessionId);
  const testChoice = useTestChoice(sessionId, batch);
  const navigate = useNavigate();
  const { error, run } = useAction();
  if (!batch) return null;
  const { unstarted } = onStagingStep(batch);
  const statuses = unstarted.map((s) => batch.stagingOfScript(s));
  const staging = statuses.filter((s) => s.status === "staging").length;
  const toStage = unstarted.filter((s) => batch.stagingOfScript(s).canStage);
  const anyReady = statuses.some((s) => s.status === "ready");
  const stageAll = () =>
    run(() => api.invoke("video:stage", { sessionId, scriptIds: toStage.map((s) => s.id) }));

  return (
    <div className="flex items-center gap-2.5">
      {error && <span className="text-xs text-destructive-foreground">{error}</span>}
      {staging > 0 && (
        <span className="text-xs text-muted-foreground tabular-nums">{staging} đang dàn dựng</span>
      )}
      {toStage.length > 0 && !anyReady && (
        <Button onClick={stageAll}>Dàn dựng {toStage.length} kịch bản</Button>
      )}
      {anyReady && (
        <MakeAll
          sessionId={sessionId}
          batch={batch}
          withUnsent
          test={testChoice?.test}
          onStarted={() => navigate({ to: "/sessions/$sessionId/videos", params: { sessionId } })}
        />
      )}
    </div>
  );
}
