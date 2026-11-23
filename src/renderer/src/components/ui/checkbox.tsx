import { type ComponentProps, type ReactNode, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

function Checkbox({
  className,
  indeterminate = false,
  children,
  ...props
}: Omit<ComponentProps<"input">, "type" | "children"> & {
  indeterminate?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <label className={cn("flex cursor-pointer items-center gap-2.5", className)}>
      <input
        ref={ref}
        type="checkbox"
        className="size-4 shrink-0 cursor-pointer accent-foreground"
        {...props}
      />
      {children}
    </label>
  );
}

export { Checkbox };
