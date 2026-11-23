import { boardOrder } from "@shared/board";
import { X } from "lucide-react";
import { useEffect } from "react";
import { api } from "@/lib/api";
import { useBoard } from "@/lib/board";
import { type BoardNotice, useBoardNotice } from "@/lib/board-notice";
import { useAction } from "@/lib/use-action";
import { Button } from "./ui/button";

const PLAIN_NOTICE_MS = 8000;

export function BoardToast({
  sessionId,
  error,
  onClearError,
}: {
  sessionId: string;
  error?: string | null;
  onClearError?: () => void;
}) {
  const board = useBoard(sessionId);
  const [notice, setNotice] = useBoardNotice(sessionId);
  const own = useAction();

  useEffect(() => {
    if (!notice || notice.undoOf) return;
    const timer = setTimeout(() => setNotice(null), PLAIN_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice, setNotice]);

  const scripts = board ? boardOrder(board.scripts) : [];
  const undoNumber = notice?.undoOf
    ? scripts.findIndex((s) => s.id === notice.undoOf && s.changeUndo)
    : -1;
  const shown: BoardNotice | null =
    (error ?? own.error)
      ? { text: (error ?? own.error) as string }
      : notice?.undoOf && undoNumber < 0
        ? null
        : notice;
  if (!shown) return null;

  const close = () => {
    setNotice(null);
    own.clear();
    onClearError?.();
  };
  const undo = (scriptId: string) =>
    own.run(async () => {
      await api.invoke("board:undo-change", { sessionId, scriptId });
      setNotice(null);
    });
  const restore = (ids: string[]) =>
    own.run(async () => {
      await api.invoke("board:restore", { sessionId, ids });
      setNotice(null);
    });
  const closeButton = (
    <Button
      variant="ghost-muted"
      size="icon-sm"
      className="rounded-full"
      aria-label="Đóng"
      onClick={close}
    >
      <X />
    </Button>
  );

  return (
    <div className="pointer-events-none sticky bottom-4 z-20 mt-4 flex flex-col items-center gap-2">
      <div
        role="status"
        className="pointer-events-auto flex items-center gap-2 rounded-full border bg-popover py-1 pr-1 pl-4 text-popover-foreground shadow-lg"
      >
        {shown.text}
        {shown.undoOf && (
          <span className="text-muted-foreground tabular-nums">#{undoNumber + 1}</span>
        )}
        {shown.restore || shown.undoOf ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full"
              onClick={() => (shown.undoOf ? undo(shown.undoOf) : restore(shown.restore ?? []))}
            >
              Hoàn tác
            </Button>
            {shown.undoOf && closeButton}
          </>
        ) : (
          closeButton
        )}
      </div>
    </div>
  );
}
