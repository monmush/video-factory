import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { cn } from "@/lib/utils";

const Menu = MenuPrimitive.Root;
const MenuTrigger = MenuPrimitive.Trigger;

function MenuPopup({
  className,
  align = "end",
  ...props
}: MenuPrimitive.Popup.Props & { align?: "start" | "center" | "end" }) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner align={align} sideOffset={4} className="z-50 app-no-drag">
        <MenuPrimitive.Popup
          className={cn(
            "min-w-40 origin-(--transform-origin) rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg outline-none transition-[scale,opacity] duration-150 data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0",
            className,
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function MenuItem({
  className,
  destructive,
  ...props
}: MenuPrimitive.Item.Props & { destructive?: boolean }) {
  return (
    <MenuPrimitive.Item
      className={cn(
        "flex h-8 cursor-pointer items-center gap-2 rounded-md px-2.5 text-sm outline-none data-highlighted:bg-accent [&_svg]:size-4 [&_svg]:text-muted-foreground",
        destructive && "text-destructive-foreground [&_svg]:text-destructive-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Menu, MenuItem, MenuPopup, MenuTrigger };
