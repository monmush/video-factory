import { type ComponentProps, type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/** How long a click that spends money is held (docs/VIDEO_COMMIT_DECISIONS.md). */
export const HOLD_MS = 3000;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Press and hold to confirm: a fill runs left to right and the action fires
 * when it is full. Releasing early undoes it; a quick tap nudges the button
 * as a hint. Space or Enter held works the same. With reduced motion the
 * fill moves in four steps instead of gliding.
 */
export function HoldButton({
  onHold,
  ms = HOLD_MS,
  tone = "primary",
  hint,
  disabled,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "onClick" | "variant"> & {
  onHold: () => unknown;
  ms?: number;
  /** "stop": quiet outline with a red fill. */
  tone?: "primary" | "outline" | "stop";
  /** Shown while held or hovered, and after a tap (e.g. what stopping loses). */
  hint?: ReactNode;
  children: ReactNode;
}) {
  const [share, setShare] = useState(0);
  const [holding, setHolding] = useState(false);
  const [nudge, setNudge] = useState(false);
  const [busy, setBusy] = useState(false);
  // The timer decides when the hold completes; animation frames only draw the
  // fill (they pause in a hidden window, the timer does not).
  const state = useRef<{ start: number; frame: number; timer: number } | null>(null);
  const mounted = useRef(true);

  useEffect(
    () => () => {
      mounted.current = false;
      if (state.current) {
        cancelAnimationFrame(state.current.frame);
        clearTimeout(state.current.timer);
      }
    },
    [],
  );

  const fire = async () => {
    setBusy(true);
    try {
      await onHold();
    } finally {
      if (mounted.current) {
        setBusy(false);
        setShare(0);
      }
    }
  };

  const begin = () => {
    if (state.current || disabled || busy) return;
    const start = performance.now();
    const steps = reducedMotion();
    setHolding(true);
    const tick = () => {
      if (!state.current) return;
      const raw = Math.min(1, (performance.now() - start) / ms);
      setShare(steps ? Math.floor(raw * 4) / 4 : raw);
      state.current.frame = requestAnimationFrame(tick);
    };
    const timer = window.setTimeout(() => {
      if (!state.current) return;
      cancelAnimationFrame(state.current.frame);
      state.current = null;
      setShare(1);
      setHolding(false);
      void fire();
    }, ms);
    state.current = { start, frame: requestAnimationFrame(tick), timer };
  };

  const end = () => {
    const current = state.current;
    if (!current) return;
    cancelAnimationFrame(current.frame);
    clearTimeout(current.timer);
    state.current = null;
    setHolding(false);
    setShare(0);
    if (performance.now() - current.start < 300) {
      setNudge(true);
      setTimeout(() => mounted.current && setNudge(false), 1200);
    }
  };

  return (
    <Button
      {...props}
      variant={tone === "primary" ? "default" : "outline"}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(
        "group/hold touch-none select-none overflow-hidden",
        tone === "stop" && "font-normal text-destructive-foreground",
        holding && "scale-[0.985]",
        nudge && "hold-nudge",
        className,
      )}
      data-holding={holding || undefined}
      data-hint={nudge || undefined}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        // Released anywhere (even off the button) ends the hold.
        const release = () => {
          window.removeEventListener("pointerup", release);
          window.removeEventListener("pointercancel", release);
          end();
        };
        window.addEventListener("pointerup", release);
        window.addEventListener("pointercancel", release);
        begin();
      }}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          begin();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          end();
        }
      }}
      onBlur={end}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0",
          tone === "primary"
            ? "bg-white/30"
            : tone === "stop"
              ? "bg-destructive/18"
              : "bg-primary/14",
        )}
        style={{ width: `${share * 100}%` }}
      />
      <span className="relative inline-flex items-center gap-1.5">
        {children}
        {hint && (
          <span className="hidden tabular-nums group-hover/hold:inline group-data-[holding]/hold:inline group-data-[hint]/hold:inline">
            {hint}
          </span>
        )}
      </span>
    </Button>
  );
}

/** A price inside a button, quieter than its label. */
export function ButtonPrice({ children }: { children: ReactNode }) {
  return <span className="font-normal tabular-nums opacity-70">{children}</span>;
}
