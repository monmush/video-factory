import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto max-w-5xl px-12 pt-7 pb-12", className)}>{children}</div>;
}

/**
 * Marks a screen region that the shell reserves but does not implement yet.
 * Search for `<Placeholder` to find the next pieces of work.
 */
export function Placeholder({ title }: { title: string }) {
  return (
    <div className="grid min-h-64 place-items-center rounded-xl border border-dashed text-muted-foreground">
      {title}
    </div>
  );
}
