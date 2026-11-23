import { boardOrder } from "@shared/board";
import { finishedScripts } from "@shared/ready-check";
import { sessionSteps } from "@shared/session-steps";
import { Link, Outlet, useMatches, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowRight, Check, ChevronRight, LayoutGrid, LoaderCircle, Rows3 } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { ScriptBoard } from "@/components/script-board";
import { StagingList, StagingToolbar } from "@/components/staging";
import { Button } from "@/components/ui/button";
import { VideosList, VideosToolbar } from "@/components/videos";
import { api } from "@/lib/api";
import { boardLayout, requestChatFocus, useBoard, useBoardView } from "@/lib/board";
import { stagingOf, useVideoLevel } from "@/lib/staging";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { useVideoJobs } from "@/lib/video-jobs";
import { useWorkspace } from "@/lib/workspace";
import { NotFound } from "./not-found";

export function SessionLayout() {
  const { sessionId } = useParams({ from: "/sessions/$sessionId" });
  const session = useWorkspace().sessions.find((s) => s.id === sessionId);
  const board = useBoard(sessionId);
  const jobs = useVideoJobs(sessionId);
  const levelOf = useVideoLevel(sessionId);
  const matches = useMatches();
  const onStep = (step: string) =>
    matches.some((m) => m.routeId === `/sessions/$sessionId/${step}`);
  const empty =
    !!board && boardOrder(board.scripts).length === 0 && !board.messages.some((m) => m.pending);
  const chatFocusedOnceFor = useRef<string | null>(null);
  useEffect(() => {
    if (!empty || chatFocusedOnceFor.current === sessionId) return;
    chatFocusedOnceFor.current = sessionId;
    if (document.activeElement instanceof HTMLTextAreaElement) return;
    requestChatFocus(sessionId);
  }, [empty, sessionId]);
  if (!session) return <NotFound />;

  const steps = sessionSteps(session, board?.scripts ?? [], jobs?.jobs ?? null, levelOf);
  const tab =
    "flex items-center gap-1.5 rounded-none px-2.5 py-2.5 text-muted-foreground hover:text-foreground [&.active]:text-foreground [&.active]:shadow-[inset_0_-2px_var(--foreground)]";
  const disabledTab = cn(tab, "cursor-default opacity-50 hover:text-muted-foreground");
  const chevron = <ChevronRight aria-hidden className="size-3.5 text-muted-foreground" />;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 px-4">
        <nav aria-label="Tiến trình tạo video" className="flex items-center">
          <Link to="/sessions/$sessionId/scripts" params={{ sessionId }} className={tab}>
            <StepLabel
              number={1}
              name="Kịch bản"
              count={steps.scripts > 0 ? String(steps.scripts) : null}
              done={steps.scriptsDone}
            />
          </Link>
          {chevron}
          {steps.stageable ? (
            <Link to="/sessions/$sessionId/staging" params={{ sessionId }} className={tab}>
              <StepLabel
                number={2}
                name="Dàn dựng"
                count={steps.unstarted > 0 ? `${steps.staged}/${steps.unstarted}` : null}
              />
              {steps.staging > 0 && (
                <LoaderCircle
                  aria-label="Đang dàn dựng"
                  className="size-3 animate-spin text-muted-foreground"
                />
              )}
            </Link>
          ) : (
            <span className={disabledTab} title="Viết kịch bản trước" aria-disabled="true">
              <StepLabel number={2} name="Dàn dựng" count={null} />
            </span>
          )}
          {chevron}
          {session.approvedAt ? (
            <Link to="/sessions/$sessionId/videos" params={{ sessionId }} className={tab}>
              <StepLabel
                number={3}
                name="Video"
                count={steps.sent > 0 ? `${steps.done}/${steps.sent}` : null}
              />
              {steps.waiting > 0 && (
                <span
                  role="img"
                  aria-label="Có video cần xem"
                  className="size-1.5 rounded-full bg-foreground"
                />
              )}
            </Link>
          ) : (
            <span className={disabledTab} title="Tạo video từ bước Dàn dựng" aria-disabled="true">
              <StepLabel number={3} name="Video" count={null} />
            </span>
          )}
        </nav>
        <span className="flex-1" />
        {onStep("scripts") && (
          <ScriptsToolbar
            key={sessionId}
            sessionId={sessionId}
            approved={Boolean(session.approvedAt)}
          />
        )}
        {onStep("staging") && <StagingToolbar key={sessionId} sessionId={sessionId} />}
        {onStep("videos") && <VideosToolbar key={sessionId} sessionId={sessionId} />}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}

function StepLabel({
  number,
  name,
  count,
  done,
}: {
  number: number;
  name: string;
  count: string | null;
  done?: boolean;
}) {
  return (
    <>
      <span className="grid size-[18px] place-items-center rounded-full border text-2xs tabular-nums">
        {done ? <Check aria-label="Xong" className="size-3" /> : number}
      </span>
      {name}
      {count && <span className="text-muted-foreground tabular-nums">{count}</span>}
    </>
  );
}

function ScriptsToolbar({ sessionId, approved }: { sessionId: string; approved: boolean }) {
  const board = useBoard(sessionId);
  const jobs = useVideoJobs(sessionId);
  const levelOf = useVideoLevel(sessionId);
  const navigate = useNavigate();
  const [view, setView] = useBoardView(sessionId);
  const { error, run } = useAction();
  if (!board) return null;
  const scripts = boardOrder(board.scripts);
  const writing = scripts.some((s) => s.status === "writing");
  const chatting = board.messages.some((m) => m.pending);
  const layout = boardLayout(view, scripts.length);
  const staging = finishedScripts(board.scripts).map((s) => ({
    id: s.id,
    ...stagingOf(jobs?.jobs.get(s.id), s, levelOf(s.id)),
  }));
  const toStage = staging.filter((s) => s.canStage).map((s) => s.id);
  const staged = staging.some((s) => s.status === "ready" || s.status === "staging");
  const stageAll = () =>
    run(async () => {
      await api.invoke("video:stage", { sessionId, scriptIds: toStage });
      await navigate({ to: "/sessions/$sessionId/staging", params: { sessionId } });
    });

  return (
    <div className="flex items-center gap-2">
      {scripts.length > 0 && (
        <fieldset
          className="flex rounded-[var(--control-radius)] border p-0.5"
          aria-label="Kiểu xem"
        >
          <ViewButton
            label="Thẻ"
            active={layout === "gallery"}
            onClick={() => setView({ layout: "gallery" })}
          >
            <LayoutGrid />
          </ViewButton>
          <ViewButton
            label="Danh sách"
            active={layout === "list"}
            onClick={() => setView({ layout: "list" })}
          >
            <Rows3 />
          </ViewButton>
        </fieldset>
      )}
      {error && <span className="text-xs text-destructive-foreground">{error}</span>}
      {toStage.length > 0 || writing ? (
        <Button disabled={writing || chatting || toStage.length === 0} onClick={stageAll}>
          {toStage.length > 0 ? `Dàn dựng ${toStage.length} kịch bản` : "Dàn dựng kịch bản"}
        </Button>
      ) : staged ? (
        <Button
          variant="outline"
          render={<Link to="/sessions/$sessionId/staging" params={{ sessionId }} />}
        >
          Xem dàn dựng
          <ArrowRight />
        </Button>
      ) : (
        approved && (
          <Button
            variant="outline"
            render={<Link to="/sessions/$sessionId/videos" params={{ sessionId }} />}
          >
            Xem video
            <ArrowRight />
          </Button>
        )
      )}
    </div>
  );
}

function ViewButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost-muted"
      size="icon-xs"
      className={cn(
        "rounded-[calc(var(--control-radius)-2px)]",
        active && "bg-accent text-foreground",
      )}
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function ScriptsPage() {
  const { sessionId } = useParams({ from: "/sessions/$sessionId" });
  return <ScriptBoard key={sessionId} sessionId={sessionId} />;
}

export function StagingPage() {
  const { sessionId } = useParams({ from: "/sessions/$sessionId" });
  return <StagingList key={sessionId} sessionId={sessionId} />;
}

export function VideosPage() {
  const { sessionId } = useParams({ from: "/sessions/$sessionId" });
  return <VideosList key={sessionId} sessionId={sessionId} />;
}
