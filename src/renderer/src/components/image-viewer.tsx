import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ChevronLeft, ChevronRight, LoaderCircle, XIcon } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

export type ViewerImage = {
  url: string;
  label?: string;
  transparent?: boolean;
  origin?: () => HTMLElement | null;
};

type Size = { w: number; h: number };
type View = { s: number; x: number; y: number };
type Phase = "opening" | "open" | "closing";

const FIT: View = { s: 1, x: 0, y: 0 };
const DURATION = 240;
const EASE = "cubic-bezier(0.2, 0, 0, 1)";
const PAD_Y = 24;
const PAD_X_SINGLE = 24;
const PAD_X_WITH_SIDE_ARROWS = 72;
const CLICK_SLOP = 4;

export function ImageViewer({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: ViewerImage[];
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const open = index !== null && images.length > 0;
  const at = open ? Math.min(Math.max(index, 0), images.length - 1) : 0;
  const current = open ? images[at] : undefined;
  const many = images.length > 1;

  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stage, setStage] = useState<Size | null>(null);
  const [sizes, setSizes] = useState<Record<string, Size>>({});
  const [phase, setPhase] = useState<Phase>("opening");
  const [view, setView] = useState<View>(FIT);
  const [animate, setAnimate] = useState(true);
  const [flip, setFlip] = useState<{ transform: string; opacity: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const reducedMotion = useRef(false);

  useLayoutEffect(() => {
    if (!open) return;
    reducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setPhase("opening");
    setView(FIT);
    setFlip(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    for (const { url } of images) {
      if (sizes[url]) continue;
      const img = new Image();
      img.onload = () => {
        const dpr = window.devicePixelRatio || 1;
        setSizes((s) => ({
          ...s,
          [url]: { w: img.naturalWidth / dpr, h: img.naturalHeight / dpr },
        }));
      };
      img.src = url;
    }
  }, [open, images, sizes]);

  const observe = useCallback((node: HTMLDivElement | null) => {
    stageRef.current = node;
    if (!node) return;
    const update = () => setStage({ w: node.clientWidth, h: node.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const natural = current ? sizes[current.url] : undefined;
  const padX = many ? PAD_X_WITH_SIDE_ARROWS : PAD_X_SINGLE;
  const fit =
    natural && stage
      ? Math.min((stage.w - padX * 2) / natural.w, (stage.h - PAD_Y * 2) / natural.h)
      : 1;
  const box = useMemo(
    () => (natural && stage ? { w: natural.w * fit, h: natural.h * fit } : null),
    [natural, stage, fit],
  );
  const maxZoom = Math.max(4, 2 / fit);
  const clickZoom = Math.min(Math.max(2, 1 / fit), maxZoom);
  const zoomed = view.s > 1.01;

  const clamp = useCallback(
    (v: View): View => {
      if (!box || !stage || v.s <= 1) return FIT;
      const mx = Math.max(0, (box.w * v.s - stage.w) / 2);
      const my = Math.max(0, (box.h * v.s - stage.h) / 2);
      return {
        s: v.s,
        x: Math.min(mx, Math.max(-mx, v.x)),
        y: Math.min(my, Math.max(-my, v.y)),
      };
    },
    [box, stage],
  );

  const zoomTo = useCallback(
    (s: number, px = 0, py = 0, smooth = true) => {
      setAnimate(smooth);
      setView((v) => {
        const next = Math.min(Math.max(s, 1), maxZoom);
        const k = next / v.s;
        return clamp({ s: next, x: px - (px - v.x) * k, y: py - (py - v.y) * k });
      });
    },
    [clamp, maxZoom],
  );

  const originTransform = useCallback(
    (image: ViewerImage | undefined) => {
      const el = image?.origin?.();
      const stageEl = stageRef.current;
      if (!el || !stageEl || !box || !natural) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return null;
      const scale = Math.min(r.width / natural.w, r.height / natural.h);
      const s = stageEl.getBoundingClientRect();
      const dx = r.left + r.width / 2 - (s.left + s.width / 2);
      const dy = r.top + r.height / 2 - (s.top + s.height / 2);
      return `translate(${dx}px, ${dy}px) scale(${(natural.w * scale) / box.w})`;
    },
    [box, natural],
  );

  useLayoutEffect(() => {
    if (!open || phase !== "opening" || !box) return;
    const from = reducedMotion.current ? null : originTransform(current);
    setAnimate(false);
    setFlip({ transform: from ?? "scale(0.96)", opacity: from ? 1 : 0 });
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setAnimate(true);
        setFlip(null);
        setPhase("open");
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [open, phase, box, current, originTransform]);

  const close = useCallback(() => {
    if (phase === "closing") return;
    const to = reducedMotion.current ? null : originTransform(current);
    setAnimate(true);
    setFlip({ transform: to ?? "scale(0.96)", opacity: to ? 1 : 0 });
    setPhase("closing");
    window.setTimeout(onClose, reducedMotion.current ? 120 : DURATION);
  }, [phase, current, originTransform, onClose]);

  const go = useCallback(
    (to: number) => {
      if (to < 0 || to >= images.length || to === at) return;
      setAnimate(false);
      setView(FIT);
      onIndexChange(to);
    },
    [images.length, at, onIndexChange],
  );

  useEffect(() => {
    if (!open || phase === "closing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.altKey || e.ctrlKey) return;
      if (e.key === "ArrowLeft") go(at - 1);
      else if (e.key === "ArrowRight") go(at + 1);
      else if (e.key === "+" || e.key === "=") zoomTo(view.s * 1.5);
      else if (e.key === "-") zoomTo(view.s / 1.5);
      else if (e.key === "0") zoomTo(1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    const beforeDialogStopsArrowKeys = true;
    window.addEventListener("keydown", onKey, beforeDialogStopsArrowKeys);
    return () => window.removeEventListener("keydown", onKey, beforeDialogStopsArrowKeys);
  }, [open, phase, at, go, zoomTo, view.s]);

  const swipe = useRef({ dx: 0, locked: false, timer: 0 });
  useEffect(() => {
    const node = stageRef.current;
    if (!open || !node) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = node.getBoundingClientRect();
      const px = e.clientX - (r.left + r.width / 2);
      const py = e.clientY - (r.top + r.height / 2);
      if (e.ctrlKey) {
        setAnimate(false);
        setView((v) => {
          const next = Math.min(Math.max(v.s * Math.exp(-e.deltaY * 0.01), 1), maxZoom);
          const k = next / v.s;
          return clamp({ s: next, x: px - (px - v.x) * k, y: py - (py - v.y) * k });
        });
        return;
      }
      if (view.s > 1.01) {
        setAnimate(false);
        setView((v) => clamp({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
        return;
      }
      const s = swipe.current;
      window.clearTimeout(s.timer);
      s.timer = window.setTimeout(() => {
        s.dx = 0;
        s.locked = false;
      }, 180);
      if (s.locked || Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;
      s.dx += e.deltaX;
      if (Math.abs(s.dx) > 60) {
        s.locked = true;
        go(at + (s.dx > 0 ? 1 : -1));
      }
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [open, clamp, maxZoom, view.s, go, at]);

  const press = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLImageElement>) => {
    if (e.button !== 0 || phase !== "open") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { x: e.clientX, y: e.clientY, view, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLImageElement>) => {
    const p = press.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
    p.moved = true;
    if (p.view.s <= 1.01) return;
    setDragging(true);
    setAnimate(false);
    setView(clamp({ ...p.view, x: p.view.x + dx, y: p.view.y + dy }));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLImageElement>) => {
    const p = press.current;
    press.current = null;
    setDragging(false);
    if (!p || p.moved) return;
    if (zoomed) {
      setAnimate(true);
      setView(FIT);
      return;
    }
    const r = stageRef.current?.getBoundingClientRect();
    if (!r) return;
    zoomTo(clickZoom, e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
  };

  const shown = phase === "open";
  const fade = { opacity: shown ? 1 : 0, transition: `opacity ${DURATION}ms ${EASE}` };
  const transform = flip?.transform ?? `translate(${view.x}px, ${view.y}px) scale(${view.s})`;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && close()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup
          initialFocus={stageRef}
          aria-label={current?.label ?? "Xem ảnh"}
          className="fixed inset-0 z-50 flex flex-col overflow-hidden outline-none select-none"
        >
          <div
            aria-hidden
            className="absolute inset-0 bg-background/88 backdrop-blur-2xl backdrop-saturate-150"
            style={fade}
          />

          <header
            className="relative grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center px-3 app-drag"
            style={fade}
          >
            <span />
            <p className="flex items-baseline gap-2 truncate text-sm font-medium text-foreground">
              {current?.label}
              {many && (
                <span className="font-normal text-muted-foreground tabular-nums">
                  {at + 1} / {images.length}
                </span>
              )}
            </p>
            <div className="flex justify-end">
              <DialogPrimitive.Close
                aria-label="Đóng"
                className="app-no-drag"
                render={<Button size="icon" variant="ghost-muted" className="rounded-full" />}
              >
                <XIcon />
              </DialogPrimitive.Close>
            </div>
          </header>

          <div
            ref={observe}
            tabIndex={-1}
            className="relative min-h-0 flex-1 outline-none app-no-drag"
          >
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              className="absolute inset-0 cursor-default"
              onClick={close}
            />
            {current && box && (
              <img
                key={current.url}
                src={current.url}
                alt={current.label ?? ""}
                draggable={false}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => {
                  press.current = null;
                  setDragging(false);
                }}
                className={cn(
                  "absolute top-1/2 left-1/2 max-w-none touch-none rounded-lg will-change-transform",
                  current.transparent ? "bg-checker" : "bg-muted",
                  "shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_2px_4px_rgb(0_0_0/0.04),0_12px_32px_rgb(0_0_0/0.10),0_32px_80px_rgb(0_0_0/0.12)]",
                  "dark:shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_12px_32px_rgb(0_0_0/0.5),0_32px_80px_rgb(0_0_0/0.5)]",
                  dragging ? "cursor-grabbing" : zoomed ? "cursor-grab" : "cursor-zoom-in",
                )}
                style={{
                  width: box.w,
                  height: box.h,
                  marginLeft: -box.w / 2,
                  marginTop: -box.h / 2,
                  transform,
                  opacity: flip?.opacity ?? 1,
                  transition: animate
                    ? `transform ${DURATION}ms ${EASE}, opacity ${DURATION}ms ${EASE}`
                    : "opacity 150ms ease-out",
                }}
              />
            )}
            {current && !box && (
              <LoaderCircle className="absolute top-1/2 left-1/2 -mt-3 -ml-3 size-6 animate-spin text-muted-foreground" />
            )}

            {many && (
              <div style={fade}>
                <NavButton side="left" disabled={at === 0} onClick={() => go(at - 1)} />
                <NavButton
                  side="right"
                  disabled={at === images.length - 1}
                  onClick={() => go(at + 1)}
                />
              </div>
            )}

            {zoomed && (
              <button
                type="button"
                onClick={() => zoomTo(1)}
                title="Vừa khung (0)"
                className="absolute right-4 bottom-4 h-8 cursor-pointer rounded-full bg-popover/90 px-3 text-xs font-medium text-foreground tabular-nums shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_4px_12px_rgb(0_0_0/0.08)] backdrop-blur-md transition-[scale] active:scale-96 dark:shadow-[0_0_0_1px_rgb(255_255_255/0.08)]"
              >
                {Math.round(view.s * fit * 100)}%
              </button>
            )}
          </div>

          {many && (
            <nav
              aria-label="Các ảnh"
              className="relative flex shrink-0 justify-center gap-2.5 app-no-drag px-4 pt-1 pb-5"
              style={fade}
            >
              {images.map((image, n) => (
                <button
                  key={image.url}
                  type="button"
                  aria-label={image.label ?? `Ảnh ${n + 1}`}
                  aria-current={n === at || undefined}
                  title={image.label}
                  onClick={() => go(n)}
                  className={cn(
                    "relative size-12 cursor-pointer overflow-hidden rounded-md bg-muted outline-none transition-[opacity,scale] duration-150 active:scale-96 focus-visible:ring-2 focus-visible:ring-ring",
                    n === at
                      ? "opacity-100 ring-2 ring-foreground ring-offset-2 ring-offset-background"
                      : "opacity-55 hover:opacity-100",
                  )}
                >
                  <img
                    src={image.url}
                    alt=""
                    draggable={false}
                    className="size-full object-cover"
                  />
                </button>
              ))}
            </nav>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function NavButton({
  side,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  const label = side === "left" ? "Ảnh trước (←)" : "Ảnh sau (→)";
  return (
    <Button
      size="icon"
      variant="outline"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "absolute top-1/2 size-10 -translate-y-1/2 rounded-full bg-popover/90 backdrop-blur-md disabled:opacity-0",
        side === "left" ? "left-4" : "right-4",
      )}
    >
      <Icon className="size-5" />
    </Button>
  );
}
