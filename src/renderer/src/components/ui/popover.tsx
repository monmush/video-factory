import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cn } from "@/lib/utils";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;

function PopoverPopup({
  className,
  align = "start",
  side = "top",
  ...props
}: PopoverPrimitive.Popup.Props & {
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        side={side}
        sideOffset={4}
        collisionPadding={8}
        className="z-50 app-no-drag"
      >
        <PopoverPrimitive.Popup
          className={cn(
            "max-w-(--available-width) origin-(--transform-origin) rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg outline-none transition-[scale,opacity] duration-150 data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0",
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverPopup, PopoverTrigger };
