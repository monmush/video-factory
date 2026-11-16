import { boardOrder } from "@shared/board";
import { committedIds, finishedScripts } from "@shared/ready-check";
import { type SessionSteps, sessionSteps } from "@shared/session-steps";
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

/**
 * A production session: scripts first, videos after session-level approval.
 * Board rules: docs/SCRIPT_BOARD_DECISIONS.md.
 */
export function SessionLayout() {
  const { sessionId } = useParams({ from: "/sessions/$sessionId" });
  const session = useWorkspace().sessions.find((s) => s.id === sessionId);
  const board = useBoard(sessionId);
  const jobs = useVideoJobs(sessionId);
  const matches = useMatches();
  const onScripts = matches.some((m) => m.routeId === "/sessions/$sessionId/scripts");
  const onVideos = matches.some((m) => m.routeId === "/sessions/$sessionId/videos");
  // An empty session starts in the chat: its composer takes the keyboard once.
  const empty =
    !!board && boardOrder(board.scripts).length === 0 && !board.messages.some((m) => m.pending);
  const focused = useRef<string | null>(null);
  useEffect(() => {
    if (!empty || focused.current === sessionId) return;
    focused.current = sessionId;
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
            steps={steps}
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

/** A step of the header: its number (a check once done), name and count. */
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

/**
 * View toggle and the step's next action: approve the scripts on the board,
 * which sends them to the Video tab, or, once nothing is left to send, a way
 * there. A series' first batch nudges toward one test video first
 * (docs/VIDEO_COMMIT_DECISIONS.md, "One video first").
 */
function ScriptsToolbar({
  sessionId,
  approved,
  steps,
}: {
  sessionId: string;
  approved: boolean;
  steps: SessionSteps;
}) {
  const board = useBoard(sessionId);
  const { sessions } = useWorkspace();
  const session = sessions.find((s) => s.id === sessionId);
  const navigate = useNavigate();
  const [view, setView] = useBoardView(sessionId);
  // A chat turn or the writer may still change the scripts.
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
  // Scripts already sent to video are not counted again.
  const sent = committedIds(session, board.scripts);
  // Counts cards still being written, so the number rises the moment a card
  // appears; the button waits until writing finishes. Failed cards are not videos.
  const ready = scripts.filter((s) => s.status !== "failed" && !sent.includes(s.id)).length;
  const writing = scripts.some((s) => s.status === "writing");
  // A chat turn may still change the scripts; wait for it before approving.
  const chatting = board.messages.some((m) => m.pending);
  const waiting = writing || chatting;
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
      {ready > 0 ? (
        // Experiment branch: no price here; the Media level is chosen on the Video tab.
        <Button
          disabled={waiting}
          onClick={() =>
            make.needsCheck(finishedIds) ? make.open(finishedIds) : make.make(finishedIds)
          }
        >
          {/* How many scripts this sends: the one number worth seeing before approving. */}
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
  // Keyed so board-local state (selection, undo notice) never carries over to another session.
  return <ScriptBoard key={sessionId} sessionId={sessionId} />;
}

/** The session's videos (docs/VIDEO_GENERATION_DECISIONS.md). */
export function VideosPage() {
  const { sessionId } = useParams({ from: "/sessions/$sessionId" });
  return <VideosList key={sessionId} sessionId={sessionId} />;
}
