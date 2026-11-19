import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto max-w-5xl px-12 pt-7 pb-12", className)}>{children}</div>;
}

export function Placeholder({ title }: { title: string }) {
  return (
    <div className="grid min-h-64 place-items-center rounded-xl border border-dashed text-muted-foreground">
      {title}
    </div>
  );
}
