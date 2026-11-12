import type { Session } from "@shared/ipc";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { refreshWorkspace } from "@/lib/workspace";
import { Button } from "./ui/button";
import { Dialog, DialogClose, DialogFooter, DialogPopup, DialogTitle } from "./ui/dialog";

/** Confirms and deletes one session. Leaves for its series page when it is open. */
export function DeleteSessionDialog({
  session,
  open,
  onOpenChange,
}: {
  session: Session;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { sessionId?: string };
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setError(null);
    try {
      await api.invoke("session:delete", session.id);
      onOpenChange(false);
      if (params.sessionId === session.id) {
        await navigate({
          to: "/series/$seriesId",
          params: { seriesId: session.seriesId },
          replace: true,
        });
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
          <DialogTitle>Xóa “{session.name}”?</DialogTitle>
          <p className="leading-relaxed text-muted-foreground">
            Kịch bản và cuộc trò chuyện sẽ bị xóa. Tệp được chuyển vào Thùng rác của máy.
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
