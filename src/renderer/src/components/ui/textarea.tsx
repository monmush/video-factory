import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Multi-line counterpart of Input, using the same border, focus and dark treatment. */
function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "w-full min-w-0 resize-none rounded-lg border border-input bg-background px-[calc(--spacing(3)-1px)] py-2 text-sm leading-relaxed text-foreground shadow-xs/5 outline-none ring-ring/24 transition-shadow placeholder:text-placeholder focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-inset disabled:opacity-64 aria-invalid:border-destructive/36 dark:bg-input/32",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
