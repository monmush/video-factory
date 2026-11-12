import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "@/lib/utils";

// Hover cards for extra detail about a row. Same surface as menus.

const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

function TooltipPopup({
  className,
  side = "right",
  sideOffset = 8,
  align = "start",
  ...props
}: TooltipPrimitive.Popup.Props & {
  side?: TooltipPrimitive.Positioner.Props["side"];
  sideOffset?: number;
  align?: TooltipPrimitive.Positioner.Props["align"];
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        className="z-50 app-no-drag"
      >
        <TooltipPrimitive.Popup
          className={cn(
            "origin-(--transform-origin) rounded-lg border bg-popover px-3 py-2.5 text-popover-foreground shadow-lg outline-none transition-[scale,opacity] duration-150 data-ending-style:scale-98 data-ending-style:opacity-0 data-instant:duration-0 data-starting-style:scale-98 data-starting-style:opacity-0",
            className,
          )}
          {...props}
        />
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipPopup, TooltipTrigger };
