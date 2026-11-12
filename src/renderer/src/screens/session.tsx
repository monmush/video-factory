import { boardOrder, estimateSeconds, estimateVideoUsd, formatSeconds } from "@shared/board";
import { formatCost } from "@shared/credits";
import { Link, Outlet, useMatches, useNavigate, useParams } from "@tanstack/react-router";
import { LayoutGrid, Rows3 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Page, Placeholder } from "@/components/page";
import { ScriptBoard } from "@/components/script-board";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { boardLayout, useBoard, useBoardView } from "@/lib/board";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { refreshWorkspace, useWorkspace } from "@/lib/workspace";
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

/** View toggle and the one primary action: make videos from the scripts on the board. */
function ScriptsToolbar({ sessionId, approved }: { sessionId: string; approved: boolean }) {
  const board = useBoard(sessionId);
  const [view, setView] = useBoardView(sessionId);
  const [confirming, setConfirming] = useState(false);
  if (!board) return null;
  const scripts = boardOrder(board.scripts);
  // Counts cards still being written, so the number rises the moment a card
  // appears; the button waits until writing finishes. Failed cards are not videos.
  const ready = scripts.filter((s) => s.status !== "failed").length;
  const writing = scripts.some((s) => s.status === "writing");
  // A chat turn may still change the scripts; wait for it before approving.
  const chatting = board.messages.some((m) => m.pending);
  const layout = boardLayout(view, scripts.length);
  // Estimated total for what "Tạo N video" would make; "…" until writing finishes.
  const seconds = scripts
    .filter((s) => s.status === "ready")
    .reduce((sum, s) => sum + estimateSeconds(s.lines), 0);
  const total = `~${formatSeconds(seconds)} · ~${formatCost(estimateVideoUsd(seconds))}`;

  return (
    <div className="flex items-center gap-2">
      {ready > 0 && (
        <span className="px-1 text-xs text-muted-foreground tabular-nums">
          {writing ? "…" : total}
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
      {!approved && (
        <Button disabled={ready === 0 || writing || chatting} onClick={() => setConfirming(true)}>
          {ready > 0 ? `Tạo ${ready} video` : "Tạo video"}
        </Button>
      )}
      <ApproveDialog
        sessionId={sessionId}
        count={ready}
        total={total}
        blocked={writing || chatting}
        open={confirming}
        onOpenChange={setConfirming}
      />
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

/**
 * Confirms count, length and estimated cost before the board is locked for
 * production. The estimate covers generated video only (shared/board.ts).
 */
function ApproveDialog({
  sessionId,
  count,
  total,
  blocked,
  open,
  onOpenChange,
}: {
  sessionId: string;
  count: number;
  total: string;
  blocked: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.invoke("session:approve", sessionId);
      await refreshWorkspace();
      onOpenChange(false);
      await navigate({ to: "/sessions/$sessionId/videos", params: { sessionId } });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Tạo {count} video?</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2 p-5">
          <p className="font-medium tabular-nums">{total}</p>
          <p className="text-muted-foreground">Chưa gồm giọng đọc và làm lại.</p>
          {error && <p className="text-destructive-foreground">{error}</p>}
        </div>
        <DialogFooter className="justify-end">
          <DialogClose render={<Button variant="ghost" />}>Hủy</DialogClose>
          <Button disabled={busy || blocked || count === 0} onClick={approve}>
            Tạo {count} video
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function ScriptsPage() {
  const { sessionId } = useParams({ from: "/sessions/$sessionId" });
  // Keyed so board-local state (selection, undo notice) never carries over to another session.
  return <ScriptBoard key={sessionId} sessionId={sessionId} />;
}

export function VideosPage() {
  return (
    <Page className="pt-4">
      <Placeholder title="Video" />
    </Page>
  );
}
