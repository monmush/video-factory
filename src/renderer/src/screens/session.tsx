import { boardOrder } from "@shared/board";
import { committedIds, finishedScripts } from "@shared/ready-check";
import { sessionSteps } from "@shared/session-steps";
import { Link, Outlet, useMatches, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowRight, Check, ChevronRight, LayoutGrid, Rows3 } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { useMakeVideos } from "@/components/ready-check";
import { ScriptBoard } from "@/components/script-board";
import { Button } from "@/components/ui/button";
import { VideosList, VideosToolbar } from "@/components/videos";
import { boardLayout, requestChatFocus, useBoard, useBoardView } from "@/lib/board";
import { cn } from "@/lib/utils";
import { useVideoJobs } from "@/lib/video-jobs";
import { useWorkspace } from "@/lib/workspace";
import { NotFound } from "./not-found";

export function SessionLayout() {
  const { sessionId } = useParams({ from: "/sessions/$sessionId" });
  const session = useWorkspace().sessions.find((s) => s.id === sessionId);
  const board = useBoard(sessionId);
  const jobs = useVideoJobs(sessionId);
  const matches = useMatches();
  const onScripts = matches.some((m) => m.routeId === "/sessions/$sessionId/scripts");
  const onVideos = matches.some((m) => m.routeId === "/sessions/$sessionId/videos");
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

  const steps = sessionSteps(session, board?.scripts ?? [], jobs?.jobs ?? null);
  const tab =
    "flex items-center gap-1.5 rounded-none px-2.5 py-2.5 text-muted-foreground hover:text-foreground [&.active]:text-foreground [&.active]:shadow-[inset_0_-2px_var(--foreground)]";

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
          <ChevronRight aria-hidden className="size-3.5 text-muted-foreground" />
          {session.approvedAt ? (
            <Link to="/sessions/$sessionId/videos" params={{ sessionId }} className={tab}>
              <StepLabel
                number={2}
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
            <span
              className={cn(tab, "cursor-default opacity-50 hover:text-muted-foreground")}
              title="Duyệt kịch bản để tạo video"
              aria-disabled="true"
            >
              <StepLabel number={2} name="Video" count={null} />
            </span>
          )}
        </nav>
        <span className="flex-1" />
        {onScripts && (
          <ScriptsToolbar
            key={sessionId}
            sessionId={sessionId}
            approved={Boolean(session.approvedAt)}
          />
        )}
        {onVideos && <VideosToolbar key={sessionId} sessionId={sessionId} />}
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
  const { sessions } = useWorkspace();
  const session = sessions.find((s) => s.id === sessionId);
  const navigate = useNavigate();
  const [view, setView] = useBoardView(sessionId);
  const busy =
    !!board &&
    (board.scripts.some((s) => s.status === "writing") || board.messages.some((m) => m.pending));
  const make = useMakeVideos({
    sessionId,
    waiting: busy,
    approveOnly: true,
    onStarted: () => navigate({ to: "/sessions/$sessionId/videos", params: { sessionId } }),
  });
  if (!board || !session) return null;
  const scripts = boardOrder(board.scripts);
  const sent = committedIds(session, board.scripts);
  const unsentIncludingStillWriting = scripts.filter(
    (s) => s.status !== "failed" && !sent.includes(s.id),
  ).length;
  const writing = scripts.some((s) => s.status === "writing");
  const chatting = board.messages.some((m) => m.pending);
  const scriptsMayStillChange = writing || chatting;
  const layout = boardLayout(view, scripts.length);
  const finished = finishedScripts(board.scripts).filter((s) => !sent.includes(s.id));
  const finishedIds = finished.map((s) => s.id);

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
      {make.error && <span className="text-xs text-destructive-foreground">{make.error}</span>}
      {unsentIncludingStillWriting > 0 ? (
        <Button
          disabled={scriptsMayStillChange}
          onClick={() =>
            make.needsCheck(finishedIds) ? make.open(finishedIds) : make.make(finishedIds)
          }
        >
          {finishedIds.length > 0 ? `Duyệt ${finishedIds.length} kịch bản` : "Duyệt kịch bản"}
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
      {make.dialog}
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

export function VideosPage() {
  const { sessionId } = useParams({ from: "/sessions/$sessionId" });
  return <VideosList key={sessionId} sessionId={sessionId} />;
}
