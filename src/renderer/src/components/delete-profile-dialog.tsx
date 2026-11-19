import type { DevProfile, DevProfiles } from "@shared/ipc";
import { useState } from "react";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { Button } from "./ui/button";
import { Dialog, DialogClose, DialogFooter, DialogPopup, DialogTitle } from "./ui/dialog";

export function DeleteProfileDialog({
  profile,
  onOpenChange,
  onDeleted,
}: {
  profile: DevProfile | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: (profiles: DevProfiles | null) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(profile);
  if (profile && profile !== shown) setShown(profile);

  const remove = async () => {
    if (!shown) return;
    setError(null);
    try {
      onDeleted(await api.invoke("dev:delete-profile", shown.id));
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Dialog
      open={profile !== null}
      onOpenChange={(open) => {
        if (!open) setError(null);
        onOpenChange(open);
      }}
    >
      <DialogPopup className="max-w-md" showCloseButton={false}>
        <div className="flex flex-col gap-2 p-5">
          <DialogTitle>Xóa hồ sơ “{shown?.name}”?</DialogTitle>
          <p className="leading-relaxed text-muted-foreground">
            Toàn bộ dữ liệu của hồ sơ này sẽ bị xóa.
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
