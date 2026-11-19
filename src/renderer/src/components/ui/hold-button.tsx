import { type ComponentProps, type ReactNode, useEffect, useRef, useState } from "react";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { Button } from "./button";

const SPENDING_HOLD_MS = 3000;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function HoldButton({
  onHold,
  ms = SPENDING_HOLD_MS,
  tone = "primary",
  hint,
  disabled,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "onClick" | "variant"> & {
  onHold: () => unknown;
  ms?: number;
  tone?: "primary" | "outline" | "stop";
  hint?: ReactNode;
  children: ReactNode;
}) {
  const [share, setShare] = useState(0);
  const [holding, setHolding] = useState(false);
  const [nudge, setNudge] = useState(false);
  const [busy, setBusy] = useState(false);
  const action = useAction();
  const state = useRef<{ start: number; fillFrame: number; completionTimer: number } | null>(null);
  const mounted = useRef(true);
  const latest = useRef({ onHold, disabled });
  latest.current = { onHold, disabled };

  useEffect(
    () => () => {
      mounted.current = false;
      if (state.current) {
        cancelAnimationFrame(state.current.fillFrame);
        clearTimeout(state.current.completionTimer);
      }
    },
    [],
  );

  const fire = async () => {
    setBusy(true);
    await action.run(async () => {
      await latest.current.onHold();
    });
    if (mounted.current) {
      setBusy(false);
      setShare(0);
    }
  };

  const begin = () => {
    if (state.current || disabled || busy) return;
    const start = performance.now();
    const fillInFourSteps = reducedMotion();
    setHolding(true);
    const tick = () => {
      if (!state.current) return;
      const raw = Math.min(1, (performance.now() - start) / ms);
      setShare(fillInFourSteps ? Math.floor(raw * 4) / 4 : raw);
      state.current.fillFrame = requestAnimationFrame(tick);
    };
    const completionTimer = window.setTimeout(() => {
      if (!state.current) return;
      cancelAnimationFrame(state.current.fillFrame);
      state.current = null;
      setHolding(false);
      if (latest.current.disabled) {
        setShare(0);
        return;
      }
      setShare(1);
      void fire();
    }, ms);
    state.current = { start, fillFrame: requestAnimationFrame(tick), completionTimer };
  };

  const end = () => {
    const current = state.current;
    if (!current) return;
    cancelAnimationFrame(current.fillFrame);
    clearTimeout(current.completionTimer);
    state.current = null;
    setHolding(false);
    setShare(0);
    if (performance.now() - current.start < 300) {
      setNudge(true);
      setTimeout(() => mounted.current && setNudge(false), 1200);
    }
  };

  return (
    <>
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
          action.clear();
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
            action.clear();
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
      {action.error && (
        <span role="alert" className="text-xs text-destructive-foreground">
          {action.error}
        </span>
      )}
    </>
  );
}

export function ButtonPrice({ children }: { children: ReactNode }) {
  return <span className="font-normal tabular-nums opacity-70">{children}</span>;
}
