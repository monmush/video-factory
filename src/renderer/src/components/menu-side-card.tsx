import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function useShownRow<T>() {
  const [shown, setShown] = useState<T | null>(null);
  return {
    shown,
    clear: () => setShown(null),
    row: (item: T) => ({
      onPointerEnter: () => setShown(item),
      onFocus: () => setShown(item),
    }),
  };
}

export function MenuSideCard({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(false);
  useLayoutEffect(() => {
    const card = ref.current;
    const menu = card?.parentElement;
    if (!card || !menu) return;
    const room = window.innerWidth - menu.getBoundingClientRect().right - 8;
    setLeft(room < card.offsetWidth + 8 && menu.getBoundingClientRect().left > room);
  }, []);
  return (
    <div
      ref={ref}
      className={cn(
        "absolute top-0 w-64 rounded-lg border bg-popover text-popover-foreground shadow-lg",
        left ? "right-full mr-2" : "left-full ml-2",
        className,
      )}
    >
      {children}
    </div>
  );
}
