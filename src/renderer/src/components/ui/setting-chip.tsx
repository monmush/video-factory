import { ChevronDown } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

function SettingChip({
  label,
  value,
  className,
  children: _children,
  ...props
}: React.ComponentProps<"button"> & { label: string; value: React.ReactNode }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-7 min-w-0 shrink cursor-pointer items-center gap-1.5 rounded-[var(--control-radius)] border border-input bg-popover px-2 text-xs whitespace-nowrap outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-popup-open:bg-accent/50 dark:bg-input/32",
        className,
      )}
      {...props}
    >
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate font-medium text-foreground">{value}</span>
      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
    </button>
  );
}

export { SettingChip };
