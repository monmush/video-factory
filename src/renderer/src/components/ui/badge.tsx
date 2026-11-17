// Adapted from T3 Code apps/web/src/components/ui/badge.tsx (snapshot c6ca6056, MIT).
// Trimmed to the quiet variants this app uses: a label, never an action or the primary colour.
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-sm border border-transparent font-medium outline-none [&_svg:not([class*='size-'])]:size-3 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: { size: "default", variant: "outline" },
    variants: {
      size: {
        default: "h-4.5 min-w-4.5 px-[calc(--spacing(1.5)-1px)] text-[.6875rem] leading-none",
      },
      variant: {
        /** A plain label: hairline border, muted text. */
        outline: "border-border text-muted-foreground",
        /** Set apart from plain labels: a soft fill, foreground text. */
        secondary: "bg-accent text-foreground",
      },
    },
  },
);

interface BadgeProps extends useRender.ComponentProps<"span"> {
  variant?: VariantProps<typeof badgeVariants>["variant"];
  size?: VariantProps<typeof badgeVariants>["size"];
}

function Badge({ className, variant, size, render, ...props }: BadgeProps) {
  const defaultProps = {
    className: cn(badgeVariants({ className, size, variant })),
    "data-slot": "badge",
  };
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(defaultProps, props),
    render,
  });
}

export { Badge, badgeVariants };
