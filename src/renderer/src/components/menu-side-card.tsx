import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// A card beside an open menu for the row under the pointer or keyboard focus
// ("Mô hình AI", "Chất lượng"). The row sets what is shown; the card sits to
// the right of the menu, or to the left when there is no room.

const files = import.meta.glob<string>("../assets/model-samples/*.{mp4,jpg}", {
  eager: true,
  query: "?url",
  import: "default",
});

/** A sample loop or poster by file name (src/renderer/src/assets/model-samples/). */
export const sampleAsset = (file?: string) =>
  file ? Object.entries(files).find(([path]) => path.endsWith(`/${file}`))?.[1] : undefined;

/**
 * The item a menu's rows show a card for: the last one under the pointer or
 * focused. `row(item)` goes on each row; `clear` on the menu's close.
 */
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

/** Inside the menu popup (which must be `relative`): the card beside it. */
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

/** A muted looping sample with its poster; nothing when the file is missing. */
export function SampleLoop({
  file,
  poster,
  className,
}: {
  file?: string;
  poster?: string;
  className?: string;
}) {
  const src = sampleAsset(file);
  if (!src) return null;
  return (
    <video
      key={src}
      src={src}
      poster={sampleAsset(poster)}
      autoPlay
      muted
      loop
      playsInline
      className={cn("w-full rounded-md bg-muted object-cover", className)}
    />
  );
}
