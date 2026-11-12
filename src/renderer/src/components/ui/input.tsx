// Adapted from T3 Code apps/web/src/components/ui/input.tsx (snapshot c6ca6056, MIT).
import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";
import { cn } from "@/lib/utils";

type InputProps = Omit<InputPrimitive.Props & React.RefAttributes<HTMLInputElement>, "size"> & {
  size?: "sm" | "default" | "lg";
};

function Input({ className, size = "default", ...props }: InputProps) {
  return (
    <span
      data-slot="input-control"
      data-size={size}
      className={cn(
        "relative inline-flex w-full rounded-lg border border-input bg-background not-dark:bg-clip-padding text-sm text-foreground shadow-xs/5 ring-ring/24 transition-shadow before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] not-has-disabled:not-has-focus-visible:not-has-aria-invalid:before:shadow-[0_1px_--theme(--color-black/4%)] has-aria-invalid:border-destructive/36 has-focus-visible:border-ring has-disabled:opacity-64 has-[:disabled,:focus-visible,[aria-invalid]]:shadow-none has-focus-visible:ring-[3px] has-focus-visible:ring-inset dark:bg-input/32 dark:not-has-disabled:not-has-focus-visible:not-has-aria-invalid:before:shadow-[0_-1px_--theme(--color-white/6%)]",
        className,
      )}
    >
      <InputPrimitive
        data-slot="input"
        className={cn(
          "h-7.5 w-full min-w-0 rounded-[inherit] px-[calc(--spacing(3)-1px)] leading-7.5 outline-none placeholder:text-placeholder",
          size === "sm" && "h-6.5 px-[calc(--spacing(2.5)-1px)] leading-6.5",
          size === "lg" && "h-8.5 leading-8.5",
        )}
        {...props}
      />
    </span>
  );
}

export { Input, type InputProps };
