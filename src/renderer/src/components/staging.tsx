import { estimateSeconds, formatSeconds } from "@shared/board";
import { costToFinishUsd } from "@shared/cost/estimate";
import type { Script } from "@shared/ipc";
import { type MediaLevel, type MediaLevelId, mediaLevel } from "@shared/media-level";
import { OUTDATED_TEXT, readyToMake, stageable } from "@shared/staging-status";
import { followBatch, type VideoJob } from "@shared/video-job";
import { planAtLevel } from "@shared/video-takes";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  ChevronRight,
  Ellipsis,
  LoaderCircle,
  MessageSquarePlus,
  Pencil,
  RotateCw,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { api } from "@/lib/api";
import { addRefs, FULL_CARDS_MAX, requestCardFocus, requestChatFocus } from "@/lib/board";
import type { ScriptStaging } from "@/lib/staging";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { LivePlanFold } from "./live-plan";
import { type Batch, useBatch } from "./make-all";
import { VideoQuality } from "./quality-chip";
import { ReadyCheckDialog } from "./ready-check";
import { ShotBrief } from "./shot-brief";
import { Button } from "./ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";

function onStagingStep(batch: Batch) {
  const stageableScripts = batch.finished.filter(stageable);
  const started = stageableScripts.filter((s) => batch.stagingOfScript(s).status === "started");
  const unstarted = stageableScripts.filter((s) => !started.includes(s));
  const toStage = unstarted.filter((s) => batch.stagingOfScript(s).canStage);
  const toCommit = unstarted.filter(
    (s) => batch.stagingOfScript(s).status === "ready" && !batch.committed.includes(s.id),
  );
  return { unstarted, started, toStage, toCommit };
}

function useCommitToVideos(sessionId: string) {
  const navigate = useNavigate();
  return async (ids: string[]) => {
    await api.invoke("session:approve", sessionId, ids);
    await navigate({ to: "/sessions/$sessionId/videos", params: { sessionId } });
  };
}

export function StagingList({ sessionId }: { sessionId: string }) {
  const batch = useBatch(sessionId);
  const [openCards, setOpenCards] = useState<Record<string, boolean>>({});
  if (!batch) return null;
  const { unstarted, started } = onStagingStep(batch);
  const grid = unstarted.length <= FULL_CARDS_MAX;
  const number = (s: Script) => batch.order.indexOf(s) + 1;

  if (unstarted.length === 0) {
    return (
      <section className="px-6 pt-4 pb-8">
        {started.length > 0 ? (
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground">Tất cả đã tạo video</span>
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
          />
        ))}
      </ul>
      {started.length > 0 && (
        <section className="mt-8">
          <h3 className="mb-3 text-sm text-muted-foreground">Đã tạo video</h3>
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

function StagingCard({
  sessionId,
  script,
  number,
  batch,
  open,
  onToggle,
}: {
  sessionId: string;
  script: Script;
  number: number;
  batch: Batch;
  open: boolean;
  onToggle: () => void;
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
  const ready = staging.status === "ready" && job;

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
  }

  return (
    <li className="rounded-xl border bg-card p-4">
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

export function StagingToolbar({ sessionId }: { sessionId: string }) {
  const batch = useBatch(sessionId);
  const commit = useCommitToVideos(sessionId);
  const { error, run } = useAction();
  if (!batch) return null;
  const { unstarted, toStage, toCommit } = onStagingStep(batch);
  const staging = unstarted.filter((s) => batch.stagingOfScript(s).status === "staging").length;
  const allOutdated = toStage.every((s) => batch.stagingOfScript(s).status === "outdated");
  const stageAll = () =>
    run(() => api.invoke("video:stage", { sessionId, scriptIds: toStage.map((s) => s.id) }));
  const commitIds = toCommit.map((s) => s.id);
  const makeVideos = () =>
    batch.make.needsCheck(commitIds) ? batch.make.open(commitIds) : run(() => commit(commitIds));

  return (
    <div className="flex items-center gap-2.5">
      {error && <span className="text-xs text-destructive-foreground">{error}</span>}
      {staging > 0 && (
        <span className="text-xs text-muted-foreground tabular-nums">{staging} đang dàn dựng</span>
      )}
      {toStage.length > 0 && (
        <Button onClick={stageAll}>
          {allOutdated
            ? `Cập nhật ${toStage.length} dàn dựng`
            : `Dàn dựng ${toStage.length} kịch bản`}
        </Button>
      )}
      {toCommit.length > 0 ? (
        <Button variant={toStage.length > 0 ? "outline" : "default"} onClick={makeVideos}>
          Tạo {toCommit.length} video
          <ArrowRight />
        </Button>
      ) : (
        batch.committed.length > 0 && (
          <Button
            variant="outline"
            render={<Link to="/sessions/$sessionId/videos" params={{ sessionId }} />}
          >
            Xem video
            <ArrowRight />
          </Button>
        )
      )}
      <ReadyCheckDialog
        sessionId={sessionId}
        scope={batch.make.scope ?? []}
        open={batch.make.scope !== null}
        onOpenChange={(next) => {
          if (!next) batch.make.close();
        }}
        onCommit={commit}
      />
    </div>
  );
}
