import { boardOrder, estimateSeconds, formatSeconds, formatSecondsShort } from "@shared/board";
import { editsInPlace } from "@shared/edit-in-place";
import type { Script } from "@shared/ipc";
import { committedIds, finishedScripts, isFirstBatch } from "@shared/ready-check";
import { hasVideo } from "@shared/session-steps";
import type { VideoJob } from "@shared/video-job";
import { Link } from "@tanstack/react-router";
import {
  Clapperboard,
  CopyPlus,
  GripVertical,
  LoaderCircle,
  Maximize2,
  MessageSquare,
  MessageSquarePlus,
  Pencil,
  Pin,
  PinOff,
  RotateCw,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type DragEvent,
  Fragment,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api } from "@/lib/api";
import {
  addRefs,
  boardLayout,
  editAsNewVersion,
  FULL_CARDS_MAX,
  requestChatFocus,
  startScriptDrag,
  testCardId,
  toggleRef,
  useBoard,
  useBoardView,
} from "@/lib/board";
import { useLiveWriting } from "@/lib/chat";
import { withOccurrenceKeys } from "@/lib/occurrence-keys";
import { type ScriptStaging, STAGE_LABEL, useStaging } from "@/lib/staging";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { useVideoJobs } from "@/lib/video-jobs";
import { useWorkspace } from "@/lib/workspace";
import { ProductPicker } from "./product-picker";
import { ShotBrief } from "./shot-brief";
import { Button } from "./ui/button";
import {
  ContextMenu,
  ContextMenuPopup,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { Input } from "./ui/input";
import { MenuItem } from "./ui/menu";
import { Textarea } from "./ui/textarea";

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const DIMMED = "opacity-50 hover:opacity-80 focus-within:opacity-80";

interface CardActions {
  variant: (id: string, direction?: string) => void;
  pin: (id: string, pinned: boolean) => void;
  remove: (id: string) => void;
  retry: (id: string) => void;
  toggleRef: (id: string) => void;
  open: (id: string) => void;
  removeMany: (ids: string[]) => void;
  pinMany: (ids: string[], pinned: boolean) => void;
  refMany: (ids: string[]) => void;
  customise: (id: string) => void;
  edit: (id: string) => void;
  setProduct: (id: string, productId: string | null) => void;
  editLine: (id: string, edit: LineEdit) => Promise<LineSaved | null | "failed">;
  removeLine: (id: string, removal: Omit<LineEdit, "text">) => Promise<boolean>;
  undoChange: (id: string) => void;
  stage: (id: string) => void;
}

interface LineEdit {
  index: number;
  was: string;
  text: string;
}

interface LineSaved {
  scriptId: string;
  copied: boolean;
}

interface SavingLine extends LineEdit {
  at: string;
  inPlace: boolean;
  sent: boolean;
}

interface Notice {
  text: string;
  restore?: string[];
  undoOf?: string;
}

function isCardClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (target.closest("button, a, input, textarea, form, [data-shot-brief]")) return false;
  return !window.getSelection()?.toString();
}

const SELECTABLE_TEXT_OR_CONTROL =
  "dl, [data-staging], [data-shot-brief], button, input, textarea, form";
const NOT_EMPTY_BOARD_SPACE = "[data-card], [data-reader], button, a, input, textarea, form";

export function ScriptBoard({ sessionId }: { sessionId: string }) {
  const board = useBoard(sessionId);
  const [view, setView] = useBoardView(sessionId);
  const { sessions, series } = useWorkspace();
  const session = sessions.find((s) => s.id === sessionId);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [customiseId, setCustomiseId] = useState<string | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const videoJobs = useVideoJobs(sessionId);
  const action = useAction();

  useEffect(() => {
    if (!notice || notice.undoOf) return;
    const timer = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!focusId) return;
    const card = root.current?.querySelector<HTMLElement>(
      `[data-card][data-script-id="${CSS.escape(focusId)}"]`,
    );
    if (!card) return;
    setFocusId(null);
    card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    card.focus({ preventScroll: true });
  });

  if (!board || !session) return null;
  const scripts = boardOrder(board.scripts);
  const sent = new Set(committedIds(session, board.scripts));
  const jobOf = (id: string) => (sent.has(id) ? (videoJobs?.jobs.get(id) ?? null) : undefined);
  const pending = board.messages.some((m) => m.pending);
  const refs = view.refs.filter((id) => scripts.some((s) => s.id === id));
  const selected = selection.filter((id) => scripts.some((s) => s.id === id));
  const layout = boardLayout(view, scripts.length);
  const finished = finishedScripts(board.scripts);
  const nudge = !session.approvedAt && isFirstBatch(session, sessions) && finished.length > 1;
  const testId = nudge
    ? testCardId(
        view,
        finished.map((s) => s.id),
      )
    : null;
  const isDimmed = (id: string) => nudge && id !== testId && !view.previewAll;
  const testChoice = nudge
    ? { isTest: (id: string) => id === testId, pick: (id: string) => setView({ testId: id }) }
    : null;

  const run = action.run;
  const showLineSaved = (saved: LineSaved, inPlaceText: string) => {
    if (saved.copied) {
      if (layout === "list") setView({ activeId: saved.scriptId });
      else setFocusId(saved.scriptId);
    }
    setNotice({
      text: saved.copied ? "Đã lưu thành bản mới" : inPlaceText,
      undoOf: saved.scriptId,
    });
  };

  const actions: CardActions = {
    variant: (id, direction) =>
      run(() => api.invoke("board:variant", { sessionId, scriptId: id, direction })),
    pin: (id, pinned) => run(() => api.invoke("board:pin", { sessionId, scriptId: id, pinned })),
    remove: (id) => actions.removeMany([id]),
    removeMany: (ids) =>
      run(async () => {
        await api.invoke("board:delete", { sessionId, ids });
        setView((v) => ({ refs: v.refs.filter((x) => !ids.includes(x)) }));
        setSelection([]);
        setNotice({
          text: ids.length > 1 ? `Đã xóa ${ids.length} kịch bản` : "Đã xóa kịch bản",
          restore: ids,
        });
      }),
    pinMany: (ids, pinned) =>
      run(() =>
        Promise.all(ids.map((id) => api.invoke("board:pin", { sessionId, scriptId: id, pinned }))),
      ),
    refMany: (ids) => {
      addRefs(sessionId, ids);
      requestChatFocus(sessionId);
    },
    edit: (id) =>
      run(async () => {
        await editAsNewVersion(sessionId, id);
        setSelection([]);
      }),
    customise: (id) => {
      if (layout === "list") setView({ activeId: id });
      setCustomiseId(id);
    },
    retry: (id) => run(() => api.invoke("board:retry", { sessionId, scriptId: id })),
    setProduct: (id, productId) =>
      run(async () => {
        const changed = await api.invoke("board:set-product", {
          sessionId,
          scriptId: id,
          productId,
        });
        if (changed) setNotice({ text: "Đã đổi sản phẩm", undoOf: changed.scriptId });
      }),
    editLine: async (id, edit) => {
      let saved: LineSaved | null = null;
      const ok = await run(async () => {
        saved = await api.invoke("board:edit-line", { sessionId, scriptId: id, ...edit });
      });
      if (!ok) return "failed";
      const result = saved as LineSaved | null;
      if (!result) return null;
      showLineSaved(result, "Đã sửa lời thoại");
      return result;
    },
    removeLine: async (id, removal) => {
      let removed: LineSaved | null = null;
      const ok = await run(async () => {
        removed = await api.invoke("board:remove-line", { sessionId, scriptId: id, ...removal });
      });
      if (ok && removed) showLineSaved(removed, "Đã xóa lời thoại");
      return ok;
    },
    stage: (id) => run(() => api.invoke("video:stage", { sessionId, scriptIds: [id] })),
    undoChange: (id) =>
      run(async () => {
        await api.invoke("board:undo-change", { sessionId, scriptId: id });
        setNotice(null);
      }),
    toggleRef: (id) => {
      if (toggleRef(sessionId, id)) requestChatFocus(sessionId);
    },
    open: (id) => setView({ layout: "list", activeId: id }),
  };

  const undoNotice = notice?.undoOf
    ? scripts.findIndex((s) => s.id === notice.undoOf && s.changeUndo)
    : -1;
  const shownNotice: Notice | null = action.error
    ? { text: action.error }
    : notice?.undoOf && undoNotice < 0
      ? null
      : notice;
  const closeNotice = () => {
    setNotice(null);
    action.clear();
  };

  const restore = (ids: string[]) =>
    run(async () => {
      await api.invoke("board:restore", { sessionId, ids });
      setNotice(null);
    });

  const onCardKey = (e: KeyboardEvent<HTMLElement>, id: string) => {
    if (e.target !== e.currentTarget) return;
    if (moveFocusInGallery(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      actions.open(id);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      actions.remove(id);
    }
  };

  const onSelectClick = (e: MouseEvent, id: string) => {
    if (!(e.metaKey || e.ctrlKey || e.shiftKey) || !isCardClick(e)) return false;
    e.preventDefault();
    setSelection((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
    return true;
  };

  const dragProps = (script: Script, number: number) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      e.currentTarget.draggable = !(e.target as HTMLElement).closest(SELECTABLE_TEXT_OR_CONTROL);
    },
    onDragStart: (e: DragEvent<HTMLElement>) => {
      const ids = selected.includes(script.id)
        ? scripts.filter((s) => selected.includes(s.id)).map((s) => s.id)
        : [script.id];
      const label =
        ids.length > 1 ? `${ids.length} kịch bản` : `#${number} ${script.title || "Kịch bản"}`;
      startScriptDrag(e, { sessionId, ids }, label);
    },
  });

  const onBoardPointerDown = (e: PointerEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (e.button !== 0 || target.closest(NOT_EMPTY_BOARD_SPACE)) return;
    const el = root.current;
    if (!el) return;
    const start = { x: e.clientX, y: e.clientY };
    const base = e.metaKey || e.ctrlKey || e.shiftKey ? selected : [];
    let moved = false;
    const onMove = (ev: globalThis.PointerEvent) => {
      const rect = {
        left: Math.min(start.x, ev.clientX),
        top: Math.min(start.y, ev.clientY),
        right: Math.max(start.x, ev.clientX),
        bottom: Math.max(start.y, ev.clientY),
      };
      if (!moved && rect.right - rect.left < 4 && rect.bottom - rect.top < 4) return;
      moved = true;
      const origin = el.getBoundingClientRect();
      setBox({
        x: rect.left - origin.left,
        y: rect.top - origin.top,
        w: rect.right - rect.left,
        h: rect.bottom - rect.top,
      });
      const hits = [...el.querySelectorAll<HTMLElement>("[data-script-id]")]
        .filter((card) => {
          const r = card.getBoundingClientRect();
          return (
            r.left < rect.right && r.right > rect.left && r.top < rect.bottom && r.bottom > rect.top
          );
        })
        .map((card) => card.dataset.scriptId as string);
      setSelection([...new Set([...base, ...hits])]);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      setBox(null);
      if (!moved) setSelection(base);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    e.preventDefault();
  };

  const seriesProductIds = series.find((x) => x.id === session.seriesId)?.productIds ?? [];
  const shared: SharedProps = {
    sessionId,
    seriesProductIds,
    sourceOf: (id) => board.scripts.find((x) => x.id === id),
    jobOf,
    refs,
    actions,
    onCardKey,
    selected,
    onSelectClick,
    dragProps,
    customiseId,
    clearCustomise: () => setCustomiseId(null),
    isDimmed,
    testChoice,
  };

  return (
    <section
      ref={root}
      aria-label="Bảng kịch bản"
      className="relative min-h-full px-6 pt-2 pb-8"
      onPointerDown={onBoardPointerDown}
      onKeyDown={(e) => {
        if (e.key === "Escape" && selected.length) setSelection([]);
      }}
    >
      {box && (
        <div
          aria-hidden
          className="pointer-events-none absolute z-10 rounded-sm border border-ring bg-ring/10"
          style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        />
      )}
      {scripts.length === 0 ? (
        pending ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,400px),1fr))] gap-4">
            {[0, 1].map((i) => (
              <div key={i} className="rounded-xl border bg-card p-4">
                <Bars count={5} />
              </div>
            ))}
          </div>
        ) : (
          <p className="px-1 pt-2 text-muted-foreground">Chưa có kịch bản.</p>
        )
      ) : layout === "list" ? (
        <ListView scripts={scripts} activeId={view.activeId} setView={setView} {...shared} />
      ) : (
        <Gallery scripts={scripts} full={scripts.length <= FULL_CARDS_MAX} {...shared} />
      )}

      {shownNotice && (
        <div className="pointer-events-none sticky bottom-4 z-20 mt-4 flex flex-col items-center gap-2">
          {shownNotice && (
            <div
              role="status"
              className="pointer-events-auto flex items-center gap-2 rounded-full border bg-popover py-1 pr-1 pl-4 text-popover-foreground shadow-lg"
            >
              {shownNotice.text}
              {shownNotice.undoOf && (
                <span className="text-muted-foreground tabular-nums">#{undoNotice + 1}</span>
              )}
              {shownNotice.restore || shownNotice.undoOf ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-full"
                    onClick={() =>
                      shownNotice.undoOf
                        ? actions.undoChange(shownNotice.undoOf)
                        : restore(shownNotice.restore ?? [])
                    }
                  >
                    Hoàn tác
                  </Button>
                  {shownNotice.undoOf && (
                    <Button
                      variant="ghost-muted"
                      size="icon-sm"
                      className="rounded-full"
                      aria-label="Đóng"
                      onClick={closeNotice}
                    >
                      <X />
                    </Button>
                  )}
                </>
              ) : (
                <Button
                  variant="ghost-muted"
                  size="icon-sm"
                  className="rounded-full"
                  aria-label="Đóng"
                  onClick={closeNotice}
                >
                  <X />
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SharedProps {
  sessionId: string;
  seriesProductIds: readonly string[];
  sourceOf: (id: string) => Script | undefined;
  jobOf: (id: string) => VideoJob | null | undefined;
  refs: string[];
  actions: CardActions;
  onCardKey: (e: KeyboardEvent<HTMLElement>, id: string) => void;
  selected: string[];
  onSelectClick: (e: MouseEvent, id: string) => boolean;
  dragProps: (
    script: Script,
    number: number,
  ) => {
    onPointerDown: (e: PointerEvent<HTMLElement>) => void;
    onDragStart: (e: DragEvent<HTMLElement>) => void;
  };
  customiseId: string | null;
  clearCustomise: () => void;
  isDimmed: (id: string) => boolean;
  testChoice: { isTest: (id: string) => boolean; pick: (id: string) => void } | null;
}

function moveFocus(
  e: KeyboardEvent<HTMLElement>,
  container: Element,
  keys: { prev: string[]; next: string[] },
): boolean {
  const step = keys.next.includes(e.key) ? 1 : keys.prev.includes(e.key) ? -1 : 0;
  if (!step) return false;
  const cards = [...container.querySelectorAll<HTMLElement>("[data-card]")];
  const current = cards.indexOf(document.activeElement as HTMLElement);
  if (current < 0) return false;
  e.preventDefault();
  cards[current + step]?.focus();
  return true;
}

function moveFocusInGallery(e: KeyboardEvent<HTMLElement>): boolean {
  const gallery = e.currentTarget.closest("[data-gallery]");
  if (!gallery) return false;
  return moveFocus(e, gallery, {
    prev: ["ArrowLeft", "ArrowUp"],
    next: ["ArrowRight", "ArrowDown"],
  });
}

function Gallery({ scripts, full, ...shared }: SharedProps & { scripts: Script[]; full: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFlip(ref, scripts);
  return (
    <div
      ref={ref}
      data-gallery
      className={cn(
        "relative grid gap-4",
        full
          ? "grid-cols-[repeat(auto-fill,minmax(min(100%,400px),1fr))]"
          : "grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))]",
      )}
    >
      {scripts.map((script, i) =>
        full ? (
          <ScriptCard key={script.id} script={script} number={i + 1} inGallery {...shared} />
        ) : (
          <CompactCard key={script.id} script={script} number={i + 1} {...shared} />
        ),
      )}
    </div>
  );
}

function ListView({
  scripts,
  activeId,
  setView,
  ...shared
}: SharedProps & {
  scripts: Script[];
  activeId: string | null;
  setView: (patch: { activeId: string }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFlip(ref, scripts);
  const active = scripts.find((s) => s.id === activeId) ?? scripts[0];
  const number = active ? scripts.indexOf(active) + 1 : 0;

  return (
    <div className="grid grid-cols-[minmax(160px,min(320px,40%))_minmax(0,1fr)] items-start gap-5">
      <div
        ref={ref}
        role="listbox"
        aria-label="Kịch bản"
        className="relative sticky top-2 flex max-h-[calc(100vh-8rem)] flex-col gap-0.5 overflow-y-auto"
        onKeyDown={(e) => moveFocus(e, e.currentTarget, { prev: ["ArrowUp"], next: ["ArrowDown"] })}
      >
        {scripts.map((script, i) => {
          const isActive = script.id === active?.id;
          const isRef = shared.refs.includes(script.id);
          const isSelected = shared.selected.includes(script.id);
          const seconds = script.status === "ready" ? estimateSeconds(script.lines) : 0;
          return (
            <CardMenu key={script.id} script={script} shared={shared}>
              <div
                data-flip={script.id}
                data-card
                data-script-id={script.id}
                role="option"
                aria-selected={isActive}
                tabIndex={0}
                className={cn(
                  "group relative flex cursor-pointer items-stretch rounded-lg outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring",
                  isActive ? "bg-accent" : "hover:bg-accent/60",
                  isSelected && "ring-2 ring-ring/60 ring-inset",
                  shared.isDimmed(script.id) && DIMMED,
                )}
                onClick={(e) => {
                  if (!shared.onSelectClick(e, script.id)) setView({ activeId: script.id });
                }}
                onFocus={() => setView({ activeId: script.id })}
                onKeyDown={(e) => shared.onCardKey(e, script.id)}
                {...shared.dragProps(script, i + 1)}
              >
                <DragHandle className="top-2.5 left-0" />
                <div className="min-w-0 flex-1 px-2.5 py-2">
                  <span className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground tabular-nums">#{i + 1}</span>
                    {isRef && <RefMark />}
                    <span
                      className={cn(
                        "truncate font-medium",
                        script.status === "failed" && "text-muted-foreground",
                      )}
                    >
                      {script.title || "…"}
                    </span>
                    <VersionTag script={script} />
                    {script.pinned && <Pin className="size-3 shrink-0" />}
                    <ChangeMark mark={script.mark} />
                    {shared.jobOf(script.id) !== undefined && (
                      <Clapperboard
                        className="size-3 shrink-0 text-muted-foreground"
                        aria-label="Đã gửi làm video"
                      />
                    )}
                    <span className="flex-1" />
                    {seconds > 0 && (
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {formatSecondsShort(seconds)}
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      "mt-0.5 block truncate text-xs text-muted-foreground",
                      script.status === "writing" && "shimmer",
                    )}
                  >
                    {script.status === "failed" ? "Chưa viết được." : script.hook || "Đang viết…"}
                  </span>
                </div>
              </div>
            </CardMenu>
          );
        })}
      </div>
      {active && <ScriptCard key={active.id} script={active} number={number} {...shared} />}
    </div>
  );
}

function ScriptCard({
  script,
  number,
  inGallery,
  ...shared
}: SharedProps & { script: Script; number: number; inGallery?: boolean }) {
  const { refs, actions, onCardKey, selected, customiseId, clearCustomise } = shared;
  const job = shared.jobOf(script.id);
  const isSent = job !== undefined;
  const assets = useWorkspace().assets;
  const [prompting, setPrompting] = useState(false);
  const [tab, setTab] = useState<CardTab>("lines");
  const staging = useStaging(shared.sessionId, script);
  useEffect(() => {
    if (customiseId !== script.id) return;
    setPrompting(true);
    clearCustomise();
  }, [customiseId, script.id, clearCustomise]);
  const [editing, setEditing] = useState<LineEdit | null>(null);
  const [saving, setSaving] = useState<SavingLine | null>(null);
  const [removing, setRemoving] = useState(false);
  const [seenAt, setSeenAt] = useState(script.updatedAt);
  const [revealAt, setRevealAt] = useState<string | null>(null);
  if (script.updatedAt !== seenAt) {
    setSeenAt(script.updatedAt);
    setRevealAt(saving || removing ? null : script.updatedAt);
  }
  const savedOnBoard =
    saving && (script.updatedAt !== saving.at || script.lines[saving.index]?.text !== saving.was);
  if (saving?.sent && savedOnBoard) setSaving(null);
  const reveal = revealAt !== null;
  const latestLines = useRef(script.lines);
  useEffect(() => {
    latestLines.current = script.lines;
  });
  const refocusLine = useRef<number | null>(null);

  const liveWriting = useLiveWriting(script.id);
  const writing = script.status === "writing" || liveWriting;
  const isRef = refs.includes(script.id);
  const dimmed = shared.isDimmed(script.id);
  const inPlace = editsInPlace(isSent, job);
  const lineEditable =
    script.status === "ready" && !liveWriting && !script.changing && !(inGallery && dimmed);
  const shownLines = script.lines.map((line, i) =>
    editing?.index === i && lineEditable
      ? { ...line, text: editing.text }
      : saving?.inPlace && !savedOnBoard && saving.index === i
        ? { ...line, text: saving.text }
        : line,
  );
  const seconds = shownLines.length ? estimateSeconds(shownLines) : 0;
  const openLine = (index: number) => {
    const was = script.lines[index]?.text;
    if (was === undefined) return;
    setRevealAt(null);
    setEditing({ index, was, text: was });
  };
  const closeLine = (keyboard: boolean) => {
    if (keyboard && editing) refocusLine.current = editing.index;
    setEditing(null);
  };
  const saveLine = async (keyboard: boolean) => {
    const edit = editing;
    closeLine(keyboard);
    if (!edit) return;
    const text = edit.text.replace(/\s+/g, " ").trim();
    if (!text || text === edit.was) return;
    const at = script.updatedAt;
    setSaving({ ...edit, text, at, inPlace, sent: false });
    const saved = await actions.editLine(script.id, { index: edit.index, was: edit.was, text });
    if (saved && saved !== "failed" && !saved.copied) {
      setSaving((current) => current && { ...current, inPlace: true, sent: true });
      return;
    }
    setSaving(null);
    if (saved !== "failed") return;
    const now = latestLines.current[edit.index]?.text;
    if (now !== undefined) setEditing({ index: edit.index, was: now, text: edit.text });
  };
  const removeLine = async () => {
    const edit = editing;
    closeLine(false);
    if (!edit) return;
    setRemoving(true);
    const removed = await actions.removeLine(script.id, { index: edit.index, was: edit.was });
    setRemoving(false);
    if (removed) return;
    const now = latestLines.current[edit.index]?.text;
    if (now !== undefined) setEditing({ index: edit.index, was: now, text: edit.text });
  };
  const undo = script.changeUndo;
  const earlier =
    undo && !undo.copy
      ? undo.lines
      : undo?.copy && script.brief.kind === "copy"
        ? shared.sourceOf(script.brief.sourceId)?.lines
        : undefined;
  const rewrote = (i: number) =>
    Boolean(
      earlier &&
        earlier.length === script.lines.length &&
        earlier[i]?.text !== script.lines[i]?.text,
    );
  const speaker = (line: Script["lines"][number]) =>
    assets.find((a) => a.id === line.characterId)?.name ?? line.speaker;

  return (
    <CardMenu script={script} shared={shared}>
      <article
        data-flip={inGallery ? script.id : undefined}
        data-card={inGallery || undefined}
        data-reader={inGallery ? undefined : true}
        data-script-id={inGallery ? script.id : undefined}
        tabIndex={inGallery ? 0 : undefined}
        className={cn(
          "group relative flex flex-col rounded-xl border bg-card p-4 shadow-xs/5 outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring",
          "cursor-grab active:cursor-grabbing",
          inGallery && selected.includes(script.id) && "ring-2 ring-ring/60",
          inGallery && dimmed && cn(DIMMED, "cursor-pointer"),
        )}
        title={inGallery && dimmed ? "Chọn làm video thử" : undefined}
        onKeyDown={(e) => inGallery && onCardKey(e, script.id)}
        onClick={(e) => {
          if (!inGallery || shared.onSelectClick(e, script.id)) return;
          if (dimmed && isCardClick(e)) shared.testChoice?.pick(script.id);
        }}
        {...shared.dragProps(script, number)}
      >
        <DragHandle className="top-[19px] left-0.5" />
        <header>
          <CardMeta script={script} number={number} isRef={isRef}>
            {!isSent && <StagingMark scriptId={script.id} staging={staging} actions={actions} />}
            {script.status === "ready" && script.lines.length > 0 && (
              <CardTabs value={tab} onChange={setTab} staging={staging} />
            )}
            {isSent && <SentBadge sessionId={shared.sessionId} job={job} staging={staging} />}
            {!inGallery &&
              shared.testChoice &&
              script.status === "ready" &&
              !shared.testChoice.isTest(script.id) && (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => shared.testChoice?.pick(script.id)}
                >
                  Chọn làm video thử
                </Button>
              )}
          </CardMeta>
          {script.title ? (
            <h3 className="mt-1.5 font-semibold leading-snug text-balance" data-selectable>
              {script.title}
            </h3>
          ) : (
            <Bars count={1} className="mt-2" />
          )}
        </header>

        {tab === "staging" && script.status === "ready" && script.lines.length > 0 ? (
          <ShotBrief sessionId={shared.sessionId} script={script} className="mt-3" />
        ) : script.lines.length > 0 ? (
          <div className="relative mt-3">
            <dl
              key={revealAt ?? "quiet"}
              className={cn(
                "grid cursor-text grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 leading-relaxed transition-opacity",
                writing && "opacity-45",
              )}
              data-selectable
            >
              {withOccurrenceKeys(shownLines, (line) => line.text).map(({ item: line, key }, i) => {
                const style: CSSProperties | undefined = reveal
                  ? { animationDelay: `${i * 70}ms` }
                  : undefined;
                return (
                  <Fragment key={editing?.index === i ? `editing-${i}` : key}>
                    <dt className={cn("text-muted-foreground", reveal && "line-in")} style={style}>
                      {speaker(line)}
                    </dt>
                    <dd className={cn(reveal && "line-in")} style={style}>
                      {editing?.index === i && lineEditable ? (
                        <LineEditor
                          label={`Lời thoại ${i + 1}`}
                          initial={editing.text}
                          note={
                            inPlace
                              ? undefined
                              : "Đã có video nên thay đổi lưu thành bản mới. Video cũ giữ nguyên."
                          }
                          onChange={(text) =>
                            setEditing((current) => current && { ...current, text })
                          }
                          onSave={(keyboard) => void saveLine(keyboard)}
                          onCancel={() => closeLine(true)}
                          onRemove={script.lines.length > 1 ? () => void removeLine() : undefined}
                        />
                      ) : (
                        <LineText
                          text={line.text}
                          highlighted={rewrote(i)}
                          editable={lineEditable && !saving && !removing && !editing}
                          focusOnMount={refocusLine}
                          index={i}
                          onOpen={() => openLine(i)}
                        />
                      )}
                    </dd>
                  </Fragment>
                );
              })}
            </dl>
            {writing && <div className="shimmer pointer-events-none absolute inset-0 rounded-md" />}
          </div>
        ) : writing ? (
          <Bars count={5} className="mt-4" />
        ) : (
          <div className="mt-3 flex items-center gap-2 text-muted-foreground">
            Chưa viết được.
            <Button variant="outline" size="xs" onClick={() => actions.retry(script.id)}>
              <RotateCw />
              Thử lại
            </Button>
          </div>
        )}

        <footer className="mt-auto flex min-h-7 items-end gap-2 pt-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
            {(script.lines.length > 0 || script.changing) && (
              <ProductPicker
                script={script}
                seriesProductIds={shared.seriesProductIds}
                disabled={script.status !== "ready"}
                onPick={(productId) => actions.setProduct(script.id, productId)}
              />
            )}
            {seconds > 0 && (
              <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                {formatSeconds(seconds)}
              </span>
            )}
          </div>
          <div
            className={cn(
              "flex shrink-0 items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100",
              prompting && "opacity-100",
            )}
          >
            {isSent && (
              <IconAction label="Sửa" onClick={() => actions.edit(script.id)}>
                <Pencil />
              </IconAction>
            )}
            {script.status === "ready" && (
              <>
                <IconAction label="Tạo biến thể" onClick={() => actions.variant(script.id)}>
                  <CopyPlus />
                </IconAction>
                <IconAction
                  label="Tùy chỉnh"
                  pressed={prompting}
                  onClick={() => setPrompting(!prompting)}
                >
                  <WandSparkles />
                </IconAction>
              </>
            )}
            <RefAction script={script} isRef={isRef} actions={actions} />
            <PinAction script={script} actions={actions} />
            <IconAction label="Xóa" onClick={() => actions.remove(script.id)}>
              <Trash2 />
            </IconAction>
          </div>
        </footer>

        {prompting && (
          <VariantForm
            onSubmit={(direction) => {
              actions.variant(script.id, direction);
              setPrompting(false);
            }}
            onCancel={() => setPrompting(false)}
          />
        )}
      </article>
    </CardMenu>
  );
}

function CompactCard({
  script,
  number,
  ...shared
}: SharedProps & { script: Script; number: number }) {
  const { refs, actions, onCardKey, selected, customiseId, clearCustomise } = shared;
  const job = shared.jobOf(script.id);
  const isSent = job !== undefined;
  const [prompting, setPrompting] = useState(false);
  useEffect(() => {
    if (customiseId !== script.id) return;
    setPrompting(true);
    clearCustomise();
  }, [customiseId, script.id, clearCustomise]);
  const isRef = refs.includes(script.id);
  const liveWriting = useLiveWriting(script.id);
  const writing = script.status === "writing" || liveWriting;
  const dimmed = shared.isDimmed(script.id);
  const staging = useStaging(shared.sessionId, script);
  return (
    <CardMenu script={script} shared={shared} canOpen>
      <article
        data-flip={script.id}
        data-card
        data-script-id={script.id}
        aria-label={script.title || "Kịch bản"}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: cards are focusable for opening (Enter) and deleting
        tabIndex={0}
        className={cn(
          "group relative flex cursor-pointer flex-col rounded-xl border bg-card p-3.5 shadow-xs/5 outline-none transition-opacity hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring",
          selected.includes(script.id) && "ring-2 ring-ring/60",
          dimmed && DIMMED,
        )}
        title={dimmed ? "Chọn làm video thử" : undefined}
        onClick={(e) => {
          if (shared.onSelectClick(e, script.id) || !isCardClick(e)) return;
          if (dimmed) shared.testChoice?.pick(script.id);
          else actions.open(script.id);
        }}
        onKeyDown={(e) => onCardKey(e, script.id)}
        {...shared.dragProps(script, number)}
      >
        <DragHandle className="top-[17px] left-0.5" />
        <header>
          <CardMeta script={script} number={number} isRef={isRef}>
            {isSent ? (
              <SentBadge sessionId={shared.sessionId} job={job} staging={staging} />
            ) : (
              <StagingMark scriptId={script.id} staging={staging} actions={actions} />
            )}
          </CardMeta>
          <h3 className="mt-1 line-clamp-2 font-semibold leading-snug text-balance">
            {script.title || <Bars count={1} className="pt-1" />}
          </h3>
        </header>
        <p
          className={cn(
            "mt-1 line-clamp-2 leading-snug text-pretty text-muted-foreground",
            writing && "shimmer rounded",
          )}
        >
          {script.status === "failed" ? "Chưa viết được." : script.hook || "Đang viết…"}
        </p>
        <footer className="mt-auto flex items-end pt-2">
          <span className="flex-1 pb-1.5 text-xs text-muted-foreground tabular-nums">
            {script.status === "ready" && formatSeconds(estimateSeconds(script.lines))}
          </span>
          <div
            className={cn(
              "flex opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100",
              prompting && "opacity-100",
            )}
          >
            <IconAction label="Mở" onClick={() => actions.open(script.id)}>
              <Maximize2 />
            </IconAction>
            {isSent && (
              <IconAction label="Sửa" onClick={() => actions.edit(script.id)}>
                <Pencil />
              </IconAction>
            )}
            {script.status === "ready" && (
              <>
                <IconAction label="Tạo biến thể" onClick={() => actions.variant(script.id)}>
                  <CopyPlus />
                </IconAction>
                <IconAction
                  label="Tùy chỉnh"
                  pressed={prompting}
                  onClick={() => setPrompting(!prompting)}
                >
                  <WandSparkles />
                </IconAction>
              </>
            )}
            {script.status === "failed" && (
              <IconAction label="Thử lại" onClick={() => actions.retry(script.id)}>
                <RotateCw />
              </IconAction>
            )}
            <RefAction script={script} isRef={isRef} actions={actions} />
            <PinAction script={script} actions={actions} />
            <IconAction label="Xóa" onClick={() => actions.remove(script.id)}>
              <Trash2 />
            </IconAction>
          </div>
        </footer>
        {prompting && (
          <VariantForm
            onSubmit={(direction) => {
              actions.variant(script.id, direction);
              setPrompting(false);
            }}
            onCancel={() => setPrompting(false)}
          />
        )}
      </article>
    </CardMenu>
  );
}

function CardMenu({
  script,
  shared,
  canOpen,
  children,
}: {
  script: Script;
  shared: SharedProps;
  canOpen?: boolean;
  children: ReactElement;
}) {
  const { refs, actions, selected } = shared;
  const group = selected.length > 1 && selected.includes(script.id) ? selected : null;
  const isSent = shared.jobOf(script.id) !== undefined;

  return (
    <ContextMenu>
      <ContextMenuTrigger render={children} />
      <ContextMenuPopup>
        {group ? (
          <>
            <MenuItem onClick={() => actions.refMany(group)}>
              <MessageSquarePlus />
              Nhắc {group.length} kịch bản trong chat
            </MenuItem>
            <GroupPinItem ids={group} shared={shared} />
            <ContextMenuSeparator />
            <MenuItem destructive onClick={() => actions.removeMany(group)}>
              <Trash2 />
              Xóa {group.length} kịch bản
            </MenuItem>
          </>
        ) : (
          <>
            {canOpen && (
              <MenuItem onClick={() => actions.open(script.id)}>
                <Maximize2 />
                Mở
              </MenuItem>
            )}
            {shared.testChoice &&
              script.status === "ready" &&
              !shared.testChoice.isTest(script.id) && (
                <MenuItem onClick={() => shared.testChoice?.pick(script.id)}>
                  <Clapperboard />
                  Chọn làm video thử
                </MenuItem>
              )}
            {isSent && (
              <MenuItem onClick={() => actions.edit(script.id)}>
                <Pencil />
                Sửa
              </MenuItem>
            )}
            {script.status === "ready" && (
              <>
                <MenuItem onClick={() => actions.variant(script.id)}>
                  <CopyPlus />
                  Tạo biến thể
                </MenuItem>
                <MenuItem onClick={() => actions.customise(script.id)}>
                  <WandSparkles />
                  Tùy chỉnh
                </MenuItem>
              </>
            )}
            {script.status === "failed" && (
              <MenuItem onClick={() => actions.retry(script.id)}>
                <RotateCw />
                Thử lại
              </MenuItem>
            )}
            <ContextMenuSeparator />
            <MenuItem onClick={() => actions.toggleRef(script.id)}>
              {refs.includes(script.id) ? <MessageSquare /> : <MessageSquarePlus />}
              {refs.includes(script.id) ? "Bỏ nhắc trong chat" : "Nhắc trong chat"}
            </MenuItem>
            <MenuItem onClick={() => actions.pin(script.id, !script.pinned)}>
              {script.pinned ? <PinOff /> : <Pin />}
              {script.pinned ? "Bỏ ghim" : "Ghim"}
            </MenuItem>
            <ContextMenuSeparator />
            <MenuItem destructive onClick={() => actions.remove(script.id)}>
              <Trash2 />
              Xóa
            </MenuItem>
          </>
        )}
      </ContextMenuPopup>
    </ContextMenu>
  );
}

function GroupPinItem({ ids, shared }: { ids: string[]; shared: SharedProps }) {
  const board = useBoard(shared.sessionId);
  const allPinned = ids.every((id) => board?.scripts.find((s) => s.id === id)?.pinned);
  return (
    <MenuItem onClick={() => shared.actions.pinMany(ids, !allPinned)}>
      {allPinned ? <PinOff /> : <Pin />}
      {allPinned ? `Bỏ ghim ${ids.length} kịch bản` : `Ghim ${ids.length} kịch bản`}
    </MenuItem>
  );
}

function DragHandle({ className }: { className?: string }) {
  return (
    <GripVertical
      aria-hidden
      className={cn(
        "absolute size-3.5 cursor-grab text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing",
        className,
      )}
    />
  );
}

function VariantForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (direction: string) => void;
  onCancel: () => void;
}) {
  const [direction, setDirection] = useState("");
  return (
    <form
      className="mt-3 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(direction);
      }}
    >
      <Input
        autoFocus
        size="sm"
        value={direction}
        placeholder="Bản mới khác bản này thế nào?"
        aria-label="Hướng của biến thể"
        onChange={(e) => setDirection(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      <Button type="submit" variant="outline" size="sm">
        Tạo
      </Button>
    </form>
  );
}

function RefMark() {
  return (
    <MessageSquare className="size-3 shrink-0 text-foreground" aria-label="Đang nhắc trong chat" />
  );
}

function VersionTag({ script }: { script: Script }) {
  if (!script.version) return null;
  return <span className="whitespace-nowrap">· bản {script.version}</span>;
}

function StagingMark({
  scriptId,
  staging,
  actions,
}: {
  scriptId: string;
  staging: ScriptStaging;
  actions: CardActions;
}) {
  if (staging.status === "staging") {
    return (
      <span className="flex shrink-0 items-center gap-1 text-2xs whitespace-nowrap">
        <LoaderCircle className="size-3 animate-spin" />
        <span className="shimmer-text">Đang dàn dựng</span>
      </span>
    );
  }
  if (!staging.canStage) return null;
  return (
    <Button
      variant="outline"
      size="xs"
      className="h-5 px-1.5 text-2xs"
      onClick={(e) => {
        e.stopPropagation();
        actions.stage(scriptId);
      }}
    >
      {STAGE_LABEL[staging.status]}
    </Button>
  );
}

function SentBadge({
  sessionId,
  job,
  staging,
}: {
  sessionId: string;
  job: VideoJob | null | undefined;
  staging: ScriptStaging;
}) {
  const label =
    staging.status === "staging"
      ? "Đang dàn dựng"
      : !job || job.status === "idle"
        ? "Chờ tạo"
        : hasVideo(job)
          ? "Có video"
          : job.status === "review"
            ? "Chờ xem cảnh chính"
            : job.status === "stopped"
              ? "Video đã dừng"
              : job.status === "failed"
                ? "Video lỗi"
                : "Đang tạo video";
  return (
    <Link
      to="/sessions/$sessionId/videos"
      params={{ sessionId }}
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-2xs font-medium whitespace-nowrap text-muted-foreground hover:text-foreground",
        job?.status === "failed" && "text-destructive-foreground",
      )}
    >
      <Clapperboard className="size-3" />
      {label}
    </Link>
  );
}

type CardTab = "lines" | "staging";
const CARD_TABS: { id: CardTab; label: string }[] = [
  { id: "lines", label: "Lời thoại" },
  { id: "staging", label: "Dàn dựng" },
];

function CardTabs({
  value,
  onChange,
  staging,
}: {
  value: CardTab;
  onChange: (tab: CardTab) => void;
  staging: ScriptStaging;
}) {
  return (
    <fieldset className="flex shrink-0 rounded-[var(--control-radius)] border p-px">
      <legend className="sr-only">Xem</legend>
      {CARD_TABS.map((t) => (
        <Button
          key={t.id}
          size="xs"
          variant="ghost-muted"
          className={cn("h-5 px-1.5 text-2xs", value === t.id && "bg-accent text-foreground")}
          aria-pressed={value === t.id}
          onClick={() => onChange(t.id)}
        >
          {staging.status === "staging" && t.id === "staging" ? (
            <span className="shimmer-text" title="Đang dàn dựng">
              {t.label}
            </span>
          ) : staging.status === "failed" && t.id === "staging" ? (
            <span className="text-destructive-foreground" title="Chưa lên được dàn dựng">
              {t.label}
            </span>
          ) : (
            t.label
          )}
        </Button>
      ))}
    </fieldset>
  );
}

function CardMeta({
  script,
  number,
  isRef,
  children,
}: {
  script: Script;
  number: number;
  isRef: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-5 items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
      <span className="whitespace-nowrap">#{number}</span>
      <VersionTag script={script} />
      <ChangeMark mark={script.mark} />
      {isRef && <RefMark />}
      {script.pinned && <Pin className="size-3 shrink-0" aria-label="Đã ghim" />}
      <span className="flex-1" />
      {children}
    </div>
  );
}

function ChangeMark({ mark }: { mark: Script["mark"] }) {
  if (!mark) return null;
  return <span className="whitespace-nowrap">· {mark === "new" ? "Mới" : "Vừa sửa"}</span>;
}

function IconAction({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost-muted"
      size="icon-sm"
      className="relative"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      data-pressed={pressed || undefined}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function RefAction({
  script,
  isRef,
  actions,
}: {
  script: Script;
  isRef: boolean;
  actions: CardActions;
}) {
  return (
    <IconAction
      label={isRef ? "Bỏ nhắc trong chat" : "Nhắc trong chat"}
      pressed={isRef}
      onClick={() => actions.toggleRef(script.id)}
    >
      {isRef ? <MessageSquare /> : <MessageSquarePlus />}
    </IconAction>
  );
}

function PinAction({ script, actions }: { script: Script; actions: CardActions }) {
  return (
    <IconAction
      label={script.pinned ? "Bỏ ghim" : "Ghim"}
      onClick={() => actions.pin(script.id, !script.pinned)}
    >
      {script.pinned ? <PinOff /> : <Pin />}
    </IconAction>
  );
}

function LineText({
  text,
  highlighted,
  editable,
  index,
  focusOnMount,
  onOpen,
}: {
  text: string;
  highlighted: boolean;
  editable: boolean;
  index: number;
  focusOnMount: RefObject<number | null>;
  onOpen: () => void;
}) {
  if (!editable) {
    return (
      <span className={cn(highlighted && "-mx-1 block rounded-sm bg-accent px-1")}>{text}</span>
    );
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: a button would stop the line from being selected for copying
    <span
      role="button"
      tabIndex={0}
      ref={(el) => {
        if (el && focusOnMount.current === index) {
          focusOnMount.current = null;
          el.focus();
        }
      }}
      className={cn(
        "group/line -mx-1 block cursor-text rounded-sm px-1 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        highlighted ? "bg-accent" : "hover:bg-accent/40",
      )}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        if (window.getSelection()?.toString()) return;
        onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        onOpen();
      }}
    >
      {text}
      <Pencil
        className="ml-1.5 inline size-3 align-baseline text-muted-foreground/70 opacity-0 transition-opacity group-hover/line:opacity-100 group-focus-visible/line:opacity-100"
        aria-hidden
      />
    </span>
  );
}

function LineEditor({
  label,
  initial,
  note,
  onChange,
  onSave,
  onCancel,
  onRemove,
}: {
  label: string;
  initial: string;
  note?: string;
  onChange: (text: string) => void;
  onSave: (keyboard: boolean) => void;
  onCancel: () => void;
  onRemove?: () => void;
}) {
  const done = useRef(false);
  const finishWith = (handler: () => void) => {
    if (done.current) return;
    done.current = true;
    handler();
  };
  const finish = (save: boolean, keyboard: boolean) =>
    finishWith(() => (save ? onSave(keyboard) : onCancel()));
  return (
    <>
      <fieldset
        aria-label={label}
        className="-mx-1 flex min-w-0 items-start gap-1"
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) finish(true, false);
        }}
      >
        <Textarea
          autoFocus
          rows={1}
          defaultValue={initial}
          aria-label={label}
          className="field-sizing-content min-h-0 flex-1 rounded-sm px-1 py-0 leading-relaxed"
          onFocus={(e) => {
            const end = e.currentTarget.value.length;
            e.currentTarget.setSelectionRange(end, end);
          }}
          onChange={(e) => onChange(e.currentTarget.value)}
          onContextMenu={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              finish(true, true);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              finish(false, true);
            }
          }}
        />
        {onRemove && (
          <Button
            variant="ghost-muted"
            size="icon-xs"
            className="-my-0.5"
            aria-label="Xóa lời thoại"
            title="Xóa lời thoại"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => finishWith(onRemove)}
          >
            <Trash2 />
          </Button>
        )}
      </fieldset>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </>
  );
}

const PLACEHOLDER_BAR_WIDTHS = ["w-2/3", "w-full", "w-5/6", "w-11/12", "w-3/4", "w-4/5"] as const;

function Bars({ count, className }: { count: 1 | 2 | 3 | 4 | 5 | 6; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)} role="status" aria-label="Đang viết">
      {PLACEHOLDER_BAR_WIDTHS.slice(0, count).map((width) => (
        <div key={width} className={cn("shimmer h-3 rounded bg-muted", width)} />
      ))}
    </div>
  );
}

function useFlip(container: RefObject<HTMLElement | null>, scripts: Script[]) {
  const positions = useRef<Map<string, { x: number; y: number }> | null>(null);
  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const previous = positions.current;
    const next = new Map<string, { x: number; y: number }>();
    const motion = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let appeared = 0;
    for (const el of root.querySelectorAll<HTMLElement>(":scope > [data-flip]")) {
      const id = el.dataset.flip as string;
      const at = { x: el.offsetLeft, y: el.offsetTop };
      next.set(id, at);
      if (!previous || !motion) continue;
      const before = previous.get(id);
      if (before) {
        const dx = before.x - at.x;
        const dy = before.y - at.y;
        if (dx || dy) {
          el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
            duration: 380,
            easing: EASE,
          });
        }
        continue;
      }
      const script = scripts.find((s) => s.id === id);
      const source =
        script?.brief.kind === "variant" ? previous.get(script.brief.sourceId) : undefined;
      if (source) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        el.animate(
          [
            {
              transform: `translate(${source.x - at.x}px, ${source.y - at.y}px) scale(0.92)`,
              opacity: 0,
            },
            { transform: "none", opacity: 1 },
          ],
          { duration: 460, easing: EASE },
        );
      } else {
        el.animate(
          [
            { opacity: 0, transform: "translateY(8px)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 300, easing: EASE, delay: Math.min(appeared++, 12) * 40, fill: "backwards" },
        );
      }
    }
    positions.current = next;
  });
}
