import { boardOrder, estimateSeconds, estimateUsd, formatSeconds } from "@shared/board";
import { formatCost } from "@shared/credits";
import { committedIds, finishedScripts, isFirstBatch } from "@shared/ready-check";
import { Link, Outlet, useMatches, useNavigate, useParams } from "@tanstack/react-router";
import { LayoutGrid, Rows3 } from "lucide-react";
import type { ReactNode } from "react";
import { BatchSettings } from "@/components/batch-settings";
import { makeLabel, useMakeVideos } from "@/components/ready-check";
import { ScriptBoard } from "@/components/script-board";
import { Button } from "@/components/ui/button";
import { ButtonPrice, HoldButton } from "@/components/ui/hold-button";
import { VideosList } from "@/components/videos";
import { boardLayout, testCardId, useBoard, useBoardView } from "@/lib/board";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";
import { NotFound } from "./not-found";

/**
 * A production session: scripts first, videos after session-level approval.
 * Board rules: docs/SCRIPT_BOARD_DECISIONS.md.
 */
export function SessionLayout() {
  const { sessionId } = useParams({ from: "/sessions/$sessionId" });
  const session = useWorkspace().sessions.find((s) => s.id === sessionId);
  const onScripts = useMatches().some((m) => m.routeId === "/sessions/$sessionId/scripts");
  if (!session) return <NotFound />;

  const tab =
    "rounded-none px-2.5 py-2.5 text-muted-foreground hover:text-foreground [&.active]:text-foreground [&.active]:shadow-[inset_0_-2px_var(--foreground)]";

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 px-4">
        <nav aria-label="Tiến trình tạo video" className="flex">
          <Link to="/sessions/$sessionId/scripts" params={{ sessionId }} className={tab}>
            Kịch bản
          </Link>
          {session.approvedAt ? (
            <Link to="/sessions/$sessionId/videos" params={{ sessionId }} className={tab}>
              Video
            </Link>
          ) : (
            <span
              className={cn(tab, "cursor-default opacity-50 hover:text-muted-foreground")}
              title="Duyệt kịch bản để tạo video"
              aria-disabled="true"
            >
              Video
            </span>
          )}
          <Link to="/sessions/$sessionId/settings" params={{ sessionId }} className={tab}>
            Thiết lập
          </Link>
        </nav>
        <span className="flex-1" />
        {onScripts && (
          <ScriptsToolbar
            key={sessionId}
            sessionId={sessionId}
            approved={Boolean(session.approvedAt)}
          />
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}

/**
 * View toggle and the primary action: make videos from the scripts on the
 * board. A series' first batch nudges toward one test video first
 * (docs/VIDEO_COMMIT_DECISIONS.md, "One video first").
 */
function ScriptsToolbar({ sessionId, approved }: { sessionId: string; approved: boolean }) {
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
  const nudge = !approved && isFirstBatch(session, sessions) && finished.length > 1;
  const testId = testCardId(view, finishedIds);
  const test = finished.find((s) => s.id === testId);
  // Estimates, all-in; "…" until writing finishes.
  const seconds = finished.reduce((sum, s) => sum + estimateSeconds(s.lines), 0);
  const usd = finished.reduce(
    (sum, s) =>
      sum +
      estimateUsd(s.lines, {
        frames: make.frames,
        model: make.model,
        resolution: make.resolution,
        cutoutUsd: make.cutouts(s),
      }),
    0,
  );
  const price = (value: number) => (writing ? "…" : `~${formatCost(value)}`);

  return (
    <div className="flex items-center gap-2">
      {ready > 0 && !nudge && (
        <span className="px-1 text-xs text-muted-foreground tabular-nums">
          {writing ? "…" : `~${formatSeconds(seconds)} · ~${formatCost(usd)}`}
        </span>
      )}
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
      {nudge && test ? (
        <>
          <MakeButton
            tone="outline"
            ids={finishedIds}
            label={makeLabel(ready, { hold: !make.needsCheck(finishedIds) })}
            price={price(usd)}
            disabled={waiting}
            make={make}
            onPointerEnter={() => setView({ previewAll: true })}
            onPointerLeave={() => setView({ previewAll: false })}
            onFocus={() => setView({ previewAll: true })}
            onBlur={() => setView({ previewAll: false })}
          />
          <MakeButton
            ids={[test.id]}
            label={makeLabel(1, { test: true, hold: !make.needsCheck([test.id]) })}
            price={price(
              estimateUsd(test.lines, {
                frames: make.frames,
                model: make.model,
                resolution: make.resolution,
                cutoutUsd: make.cutouts(test),
              }),
            )}
            disabled={waiting}
            make={make}
          />
        </>
      ) : ready > 0 ? (
        <MakeButton
          ids={finishedIds}
          label={makeLabel(ready, {
            hold: !make.needsCheck(finishedIds),
            // With other videos already made, say which scripts this makes.
            remaining: sent.length > 0,
            number: scripts.findIndex((s) => s.id === finishedIds[0]) + 1,
          })}
          price={price(usd)}
          disabled={waiting}
          make={make}
        />
      ) : (
        !approved && <Button disabled>Tạo video</Button>
      )}
      {make.dialog}
    </div>
  );
}

/**
 * A make button: held for three seconds when nothing needs fixing, else a
 * plain click that opens the ready check.
 */
function MakeButton({
  ids,
  label,
  price,
  disabled,
  make,
  tone = "primary",
  ...pointer
}: {
  ids: string[];
  label: string;
  price: string;
  disabled?: boolean;
  make: ReturnType<typeof useMakeVideos>;
  tone?: "primary" | "outline";
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  if (make.needsCheck(ids)) {
    return (
      <Button
        variant={tone === "primary" ? "default" : "outline"}
        disabled={disabled}
        onClick={() => make.open(ids)}
        {...pointer}
      >
        {label}
        <ButtonPrice>{price}</ButtonPrice>
      </Button>
    );
  }
  return (
    <HoldButton tone={tone} disabled={disabled} onHold={() => make.make(ids)} {...pointer}>
      {label}
      <ButtonPrice>{price}</ButtonPrice>
    </HoldButton>
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

/** The batch's output settings, the series' by default. */
export function SessionSettingsPage() {
  const { sessionId } = useParams({ from: "/sessions/$sessionId" });
  return <BatchSettings key={sessionId} sessionId={sessionId} />;
}

/** The session's videos (docs/VIDEO_GENERATION_DECISIONS.md). */
export function VideosPage() {
  const { sessionId } = useParams({ from: "/sessions/$sessionId" });
  return <VideosList key={sessionId} sessionId={sessionId} />;
}
