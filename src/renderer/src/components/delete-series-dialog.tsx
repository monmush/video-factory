import type { Series } from "@shared/ipc";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { refreshWorkspace, useWorkspace } from "@/lib/workspace";
import { Button } from "./ui/button";
import { Dialog, DialogClose, DialogFooter, DialogPopup, DialogTitle } from "./ui/dialog";

/**
 * Confirms and deletes a series with its sessions. Used from the series page
 * and the sidebar. Only leaves the current screen when it belongs to that series.
 */
export function DeleteSeriesDialog({
  series,
  open,
  onOpenChange,
}: {
  series: Series;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const workspace = useWorkspace();
  const params = useParams({ strict: false }) as { seriesId?: string; sessionId?: string };
  const [error, setError] = useState<string | null>(null);
  const sessions = workspace.sessions.filter((s) => s.seriesId === series.id);
  const viewing = params.seriesId === series.id || sessions.some((s) => s.id === params.sessionId);
  const next = workspace.series.findLast((s) => s.id !== series.id);

  const remove = async () => {
    setError(null);
    try {
      await api.invoke("series:delete", series.id);
      onOpenChange(false);
      // Leave first when the open screen belongs to this series: it has nothing left to show.
      if (viewing) {
        if (next) {
          await navigate({ to: "/series/$seriesId", params: { seriesId: next.id }, replace: true });
        } else await navigate({ to: "/series/new", replace: true });
      }
      await refreshWorkspace();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md" showCloseButton={false}>
        <div className="flex flex-col gap-2 p-5">
          <DialogTitle>Xóa “{series.name}”?</DialogTitle>
          <p className="leading-relaxed text-muted-foreground">
            {sessions.length > 0
              ? `Series và ${sessions.length} lần tạo video trong đó sẽ bị xóa. Tệp video được chuyển vào Thùng rác của máy.`
              : "Series này sẽ bị xóa."}{" "}
            Nhân vật và sản phẩm trong thư viện vẫn giữ nguyên.
          </p>
          {error && <p className="text-destructive-foreground">{error}</p>}
        </div>
        <DialogFooter className="justify-end">
          <DialogClose render={<Button variant="ghost" />}>Hủy</DialogClose>
          <Button variant="destructive" onClick={remove}>
            Xóa
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
