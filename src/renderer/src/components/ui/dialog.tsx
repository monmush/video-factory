// Adapted from T3 Code apps/web/src/components/ui/dialog.tsx (snapshot c6ca6056, MIT).
// Trimmed: no media variant, mobile sheet or nested-dialog retention.
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

const Dialog = DialogPrimitive.Root;
const DialogClose = DialogPrimitive.Close;

function DialogPopup({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & { showCloseButton?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/32 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:bg-black/60" />
      <DialogPrimitive.Viewport className="fixed inset-0 z-50 grid grid-rows-[1fr_auto_1fr] justify-items-center p-6 app-no-drag">
        <DialogPrimitive.Popup
          className={cn(
            "relative row-start-2 flex max-h-full w-full max-w-lg min-w-0 flex-col rounded-2xl border bg-popover text-popover-foreground shadow-2xl outline-none transition-[scale,opacity] duration-200 ease-out data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0",
            className,
          )}
          data-slot="dialog-popup"
          {...props}
        >
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close
              aria-label="Đóng"
              className="absolute end-3 top-3"
              render={<Button size="icon-sm" variant="ghost-muted" />}
            >
              <XIcon />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Viewport>
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1 border-b px-5 py-4", className)} {...props} />;
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return <DialogPrimitive.Title className={cn("text-base font-semibold", className)} {...props} />;
}

function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-center gap-2 rounded-b-2xl border-t px-5 py-3", className)}
      {...props}
    />
  );
}

export { Dialog, DialogClose, DialogFooter, DialogHeader, DialogPopup, DialogTitle };
