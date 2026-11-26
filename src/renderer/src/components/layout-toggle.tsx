import { LayoutGrid, Rows3 } from "lucide-react";
import type { ReactNode } from "react";
import { type BoardLayout, preferLayout } from "@/lib/board";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

const LAYOUTS: readonly { layout: BoardLayout; label: string; icon: ReactNode }[] = [
  { layout: "gallery", label: "Thẻ", icon: <LayoutGrid /> },
  { layout: "list", label: "Danh sách", icon: <Rows3 /> },
];

export function LayoutToggle({ sessionId, layout }: { sessionId: string; layout: BoardLayout }) {
  return (
    <fieldset className="flex rounded-[var(--control-radius)] border p-0.5" aria-label="Kiểu xem">
      {LAYOUTS.map((option) => (
        <Button
          key={option.layout}
          variant="ghost-muted"
          size="icon-xs"
          className={cn(
            "rounded-[calc(var(--control-radius)-2px)]",
            option.layout === layout && "bg-accent text-foreground",
          )}
          aria-label={option.label}
          title={option.label}
          aria-pressed={option.layout === layout}
          onClick={() => preferLayout(sessionId, option.layout)}
        >
          {option.icon}
        </Button>
      ))}
    </fieldset>
  );
}
