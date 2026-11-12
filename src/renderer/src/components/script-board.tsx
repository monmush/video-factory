import { boardOrder, estimateSeconds, formatSeconds, formatSecondsShort } from "@shared/board";
import type { Asset, Script } from "@shared/ipc";
import {
  ChevronRight,
  CopyPlus,
  GripVertical,
  Maximize2,
  MessageSquare,
  MessageSquarePlus,
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
  FULL_CARDS_MAX,
  requestChatFocus,
  startScriptDrag,
  toggleRef,
  useBoard,
  useBoardView,
} from "@/lib/board";
import { useLiveWriting } from "@/lib/chat";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";
import { AssetThumb } from "./asset-picker";
import { Button } from "./ui/button";
import {
  ContextMenu,
  ContextMenuPopup,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { Input } from "./ui/input";
import { MenuItem } from "./ui/menu";

// The script board of a session (docs/SCRIPT_BOARD_DECISIONS.md):
//   - up to FULL_CARDS_MAX scripts open as full cards side by side; more open
//     in the list/detail reader (the toggle can override either way);
//   - no selection: a compact card opens on click, a list row reads;
//     "Nhắc trong chat" (or `#` in the composer) adds a script as a chat
//     reference, marked on its card;
//   - several scripts are selected by dragging a box over empty board space,
//     or with Cmd/Shift-click; Esc or a click on empty space clears;
//   - cards and rows drag onto the chat to reference them (the whole
//     selection when the dragged card is in it); right-click offers the
//     card's actions, for the whole selection where that makes sense;
//   - card buttons make a new card beside the original; chat edits in place;
//   - no warnings on cards: the writer fixes its own output before it lands.
//     The estimated length is neutral information, never coloured.

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

interface CardActions {
  variant: (id: string, direction?: string) => void;
  pin: (id: string, pinned: boolean) => void;
  remove: (id: string) => void;
  retry: (id: string) => void;
  /** Adds or removes the script from the chat references. */
  toggleRef: (id: string) => void;
  open: (id: string) => void;
  /** Several scripts at once (right-click on a selection). */
  removeMany: (ids: string[]) => void;
  pinMany: (ids: string[], pinned: boolean) => void;
  refMany: (ids: string[]) => void;
  /** Opens the card's "Tùy chỉnh" prompt. */
  customise: (id: string) => void;
}

interface Notice {
  text: string;
  /** Deleted scripts the notice can bring back. */
  restore?: string[];
}

/** Clicks on controls, or while text is selected, are not card clicks. */
function isCardClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (target.closest("button, a, input, textarea, form")) return false;
  return !window.getSelection()?.toString();
}

export function ScriptBoard({ sessionId }: { sessionId: string }) {
  const board = useBoard(sessionId);
  const [view, setView] = useBoardView(sessionId);
  const session = useWorkspace().sessions.find((s) => s.id === sessionId);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [customiseId, setCustomiseId] = useState<string | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!board || !session) return null;
  const scripts = boardOrder(board.scripts);
  const editable = !session.approvedAt;
  const pending = board.messages.some((m) => m.pending);
  const refs = view.refs.filter((id) => scripts.some((s) => s.id === id));
  const selected = selection.filter((id) => scripts.some((s) => s.id === id));
  const layout = boardLayout(view, scripts.length);

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (error) {
      setNotice({ text: errorMessage(error) });
    }
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
    customise: (id) => {
      if (layout === "list") setView({ activeId: id });
      setCustomiseId(id);
    },
    retry: (id) => run(() => api.invoke("board:retry", { sessionId, scriptId: id })),
    toggleRef: (id) => {
      if (toggleRef(sessionId, id)) requestChatFocus(sessionId);
    },
    open: (id) => setView({ layout: "list", activeId: id }),
  };

  const restore = (ids: string[]) =>
    run(async () => {
      await api.invoke("board:restore", { sessionId, ids });
      setNotice(null);
    });

  /** Keyboard on a focused card or row: Enter opens, Delete removes that card. */
  const onCardKey = (e: KeyboardEvent<HTMLElement>, id: string) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter") {
      e.preventDefault();
      actions.open(id);
    } else if ((e.key === "Delete" || e.key === "Backspace") && editable) {
      e.preventDefault();
      actions.remove(id);
    }
  };

  // Cmd/Ctrl/Shift-click adds a card to the selection or takes it out.
  const onSelectClick = (e: MouseEvent, id: string) => {
    if (!(e.metaKey || e.ctrlKey || e.shiftKey) || !isCardClick(e)) return false;
    e.preventDefault();
    setSelection((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
    return true;
  };

  // Dragging a card or row: the whole selection when the card is in it.
  const dragProps = (script: Script, number: number) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      // Dialogue and staging stay selectable as text; controls stay clickable.
      e.currentTarget.draggable =
        editable &&
        !(e.target as HTMLElement).closest("dl, [data-staging], button, input, textarea, form");
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

  // A box dragged over empty board space selects the cards it touches.
  const onBoardPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (e.button !== 0 || target.closest("[data-card], button, a, input, textarea, form")) return;
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
      // A plain click on empty space clears the selection.
      if (!moved) setSelection(base);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    // No text selection while drawing the box.
    e.preventDefault();
  };

  const shared: SharedProps = {
    sessionId,
    editable,
    refs,
    actions,
    onCardKey,
    selected,
    onSelectClick,
    dragProps,
    customiseId,
    clearCustomise: () => setCustomiseId(null),
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only box selection; cards stay keyboard-reachable
    <div
      ref={root}
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

      {notice && (
        <div className="pointer-events-none sticky bottom-4 z-20 mt-4 flex flex-col items-center gap-2">
          {notice && (
            <div
              role="status"
              className="pointer-events-auto flex items-center gap-2 rounded-full border bg-popover py-1 pr-1 pl-4 text-popover-foreground shadow-lg"
            >
              {notice.text}
              {notice.restore ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full"
                  onClick={() => restore(notice.restore ?? [])}
                >
                  Hoàn tác
                </Button>
              ) : (
                <Button
                  variant="ghost-muted"
                  size="icon-sm"
                  className="rounded-full"
                  aria-label="Đóng"
                  onClick={() => setNotice(null)}
                >
                  <X />
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
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
  editable: boolean;
  /** Scripts referenced in the chat composer. */
  refs: string[];
  actions: CardActions;
  onCardKey: (e: KeyboardEvent<HTMLElement>, id: string) => void;
  /** Scripts selected on the board (box or Cmd/Shift-click). */
  selected: string[];
  /** Handles a modifier click as selection; returns true if it did. */
  onSelectClick: (e: MouseEvent, id: string) => boolean;
  dragProps: (
    script: Script,
    number: number,
  ) => {
    onPointerDown: (e: PointerEvent<HTMLElement>) => void;
    onDragStart: (e: DragEvent<HTMLElement>) => void;
  };
  /** A card whose "Tùy chỉnh" prompt the right-click menu asked to open. */
  customiseId: string | null;
  clearCustomise: () => void;
}

/** Arrow keys move focus between the [data-card] elements in a container. */
function moveFocus(e: KeyboardEvent<HTMLElement>, keys: { prev: string[]; next: string[] }) {
  const step = keys.next.includes(e.key) ? 1 : keys.prev.includes(e.key) ? -1 : 0;
  if (!step) return;
  const cards = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-card]")];
  const current = cards.indexOf(document.activeElement as HTMLElement);
  if (current < 0) return;
  e.preventDefault();
  cards[current + step]?.focus();
}

function Gallery({ scripts, full, ...shared }: SharedProps & { scripts: Script[]; full: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFlip(ref, scripts);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move between the focusable cards inside
    <div
      ref={ref}
      className={cn(
        "relative grid gap-4",
        full
          ? "grid-cols-[repeat(auto-fill,minmax(min(100%,400px),1fr))]"
          : "grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))]",
      )}
      onKeyDown={(e) =>
        moveFocus(e, { prev: ["ArrowLeft", "ArrowUp"], next: ["ArrowRight", "ArrowDown"] })
      }
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
        onKeyDown={(e) => moveFocus(e, { prev: ["ArrowUp"], next: ["ArrowDown"] })}
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
                  "group relative flex cursor-pointer items-stretch rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive ? "bg-accent" : "hover:bg-accent/60",
                  isSelected && "ring-2 ring-ring/60 ring-inset",
                )}
                onClick={(e) => {
                  if (!shared.onSelectClick(e, script.id)) setView({ activeId: script.id });
                }}
                onFocus={() => setView({ activeId: script.id })}
                onKeyDown={(e) => shared.onCardKey(e, script.id)}
                {...shared.dragProps(script, i + 1)}
              >
                {shared.editable && <DragHandle className="top-2.5 left-0" />}
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
                    {script.pinned && <Pin className="size-3 shrink-0" />}
                    <MarkBadge mark={script.mark} />
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

/** A full, readable script with its actions at the bottom right. */
function ScriptCard({
  script,
  number,
  inGallery,
  ...shared
}: SharedProps & { script: Script; number: number; inGallery?: boolean }) {
  const { editable, refs, actions, onCardKey, selected, customiseId, clearCustomise } = shared;
  const assets = useWorkspace().assets;
  const [prompting, setPrompting] = useState(false);
  const [showStaging, setShowStaging] = useState(false);
  // "Tùy chỉnh" chosen from the right-click menu opens this card's prompt.
  useEffect(() => {
    if (customiseId !== script.id) return;
    setPrompting(true);
    clearCustomise();
  }, [customiseId, script.id, clearCustomise]);
  // Text writes in when it arrives or changes, not when the board is reopened.
  const firstVersion = useRef(script.updatedAt);
  const reveal = script.updatedAt !== firstVersion.current;

  const liveWriting = useLiveWriting(script.id);
  const writing = script.status === "writing" || liveWriting;
  const isRef = refs.includes(script.id);
  const products = script.productIds.flatMap((id) => assets.find((a) => a.id === id) ?? []);
  const seconds = script.lines.length ? estimateSeconds(script.lines) : 0;
  const speaker = (line: Script["lines"][number]) =>
    assets.find((a) => a.id === line.characterId)?.name ?? line.speaker;

  return (
    // Focusable in the gallery for the arrow keys, Enter and Delete.
    <CardMenu script={script} shared={shared}>
      <article
        data-flip={inGallery ? script.id : undefined}
        data-card={inGallery || undefined}
        data-script-id={inGallery ? script.id : undefined}
        tabIndex={inGallery ? 0 : undefined}
        className={cn(
          "group relative flex flex-col rounded-xl border bg-card p-4 shadow-xs/5 outline-none focus-visible:ring-2 focus-visible:ring-ring",
          editable && "cursor-grab active:cursor-grabbing",
          inGallery && selected.includes(script.id) && "ring-2 ring-ring/60",
        )}
        onKeyDown={(e) => inGallery && onCardKey(e, script.id)}
        onClick={(e) => inGallery && shared.onSelectClick(e, script.id)}
        {...shared.dragProps(script, number)}
      >
        {editable && <DragHandle className="top-4.5 left-0.5" />}
        <header className="flex items-start gap-2">
          <span className="flex items-center gap-1 pt-0.5 text-xs text-muted-foreground tabular-nums">
            #{number}
            {isRef && <RefMark />}
          </span>
          <div className="min-w-0 flex-1">
            {script.title ? (
              <h3
                className="line-clamp-2 font-semibold leading-snug"
                title={script.title}
                data-selectable
              >
                {script.title}
              </h3>
            ) : (
              <Bars count={1} className="pt-1" />
            )}
            {script.hook && (
              <p
                className="mt-0.5 line-clamp-2 leading-snug text-muted-foreground"
                title={script.hook}
                data-selectable
              >
                {script.hook}
              </p>
            )}
          </div>
          {script.pinned && <Pin className="mt-1 size-3.5 shrink-0" aria-label="Đã ghim" />}
          <MarkBadge mark={script.mark} />
        </header>

        {script.lines.length > 0 ? (
          <div className="relative mt-3">
            <dl
              key={script.updatedAt}
              className={cn(
                "grid cursor-text grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 leading-relaxed transition-opacity",
                writing && "opacity-45",
              )}
              data-selectable
            >
              {script.lines.map((line, i) => {
                const style: CSSProperties | undefined = reveal
                  ? { animationDelay: `${i * 70}ms` }
                  : undefined;
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity; the list is replaced as a whole
                  <Fragment key={i}>
                    <dt className={cn("text-muted-foreground", reveal && "line-in")} style={style}>
                      {speaker(line)}
                    </dt>
                    <dd className={cn(reveal && "line-in")} style={style}>
                      {line.text}
                    </dd>
                  </Fragment>
                );
              })}
            </dl>
            {writing && <div className="shimmer pointer-events-none absolute inset-0 rounded-md" />}
            {script.staging && (
              <div className="mt-3">
                <button
                  type="button"
                  className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  aria-expanded={showStaging}
                  onClick={() => setShowStaging(!showStaging)}
                >
                  <ChevronRight
                    className={cn("size-3.5 transition-transform", showStaging && "rotate-90")}
                  />
                  Dàn dựng
                </button>
                {showStaging && (
                  <p
                    className="mt-1 cursor-text pl-4.5 text-xs leading-relaxed text-muted-foreground"
                    data-selectable
                    data-staging
                  >
                    {script.staging}
                  </p>
                )}
              </div>
            )}
          </div>
        ) : writing ? (
          <Bars count={5} className="mt-4" />
        ) : (
          <div className="mt-3 flex items-center gap-2 text-muted-foreground">
            Chưa viết được.
            {editable && (
              <Button variant="outline" size="xs" onClick={() => actions.retry(script.id)}>
                <RotateCw />
                Thử lại
              </Button>
            )}
          </div>
        )}

        <footer className="mt-auto flex min-h-7 items-end gap-2 pt-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
            {products.map((product) => (
              <ProductTag key={product.id} product={product} />
            ))}
            {seconds > 0 && (
              <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                {formatSeconds(seconds)}
              </span>
            )}
          </div>
          {editable && (
            <div
              className={cn(
                "flex shrink-0 items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100",
                prompting && "opacity-100",
              )}
            >
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
          )}
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

/** Title and hook only. A click (or Enter) opens the reader. */
function CompactCard({
  script,
  number,
  ...shared
}: SharedProps & { script: Script; number: number }) {
  const { editable, refs, actions, onCardKey, selected, customiseId, clearCustomise } = shared;
  const [prompting, setPrompting] = useState(false);
  useEffect(() => {
    if (customiseId !== script.id) return;
    setPrompting(true);
    clearCustomise();
  }, [customiseId, script.id, clearCustomise]);
  const isRef = refs.includes(script.id);
  const liveWriting = useLiveWriting(script.id);
  const writing = script.status === "writing" || liveWriting;
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
          "group relative flex cursor-pointer flex-col rounded-xl border bg-card p-3.5 shadow-xs/5 outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring",
          selected.includes(script.id) && "ring-2 ring-ring/60",
        )}
        onClick={(e) => {
          if (shared.onSelectClick(e, script.id)) return;
          if (isCardClick(e)) actions.open(script.id);
        }}
        onKeyDown={(e) => onCardKey(e, script.id)}
        {...shared.dragProps(script, number)}
      >
        {editable && <DragHandle className="top-4.5 left-0.5" />}
        <header className="flex items-start gap-2">
          <span className="flex items-center gap-1 pt-0.5 text-xs text-muted-foreground tabular-nums">
            #{number}
            {isRef && <RefMark />}
          </span>
          <h3 className="min-w-0 flex-1 font-semibold leading-snug line-clamp-2">
            {script.title || <Bars count={1} className="pt-1" />}
          </h3>
          {script.pinned && <Pin className="mt-1 size-3.5 shrink-0" aria-label="Đã ghim" />}
          <MarkBadge mark={script.mark} />
        </header>
        <p
          className={cn(
            "mt-1 line-clamp-2 leading-snug text-muted-foreground",
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
            {editable && script.status === "ready" && (
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
            {editable && script.status === "failed" && (
              <IconAction label="Thử lại" onClick={() => actions.retry(script.id)}>
                <RotateCw />
              </IconAction>
            )}
            {editable && <RefAction script={script} isRef={isRef} actions={actions} />}
            {editable && <PinAction script={script} actions={actions} />}
            {editable && (
              <IconAction label="Xóa" onClick={() => actions.remove(script.id)}>
                <Trash2 />
              </IconAction>
            )}
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

// ---------------------------------------------------------------- right-click

/**
 * Right-click on a card or row: the same actions as its buttons. On a card
 * that is part of a selection, the menu acts on the whole selection.
 */
function CardMenu({
  script,
  shared,
  canOpen,
  children,
}: {
  script: Script;
  shared: SharedProps;
  /** Compact cards also offer "Mở". */
  canOpen?: boolean;
  children: ReactElement;
}) {
  const { editable, refs, actions, selected } = shared;
  const group = selected.length > 1 && selected.includes(script.id) ? selected : null;
  if (!editable && !canOpen) return children;

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
            {editable && script.status === "ready" && (
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
            {editable && script.status === "failed" && (
              <MenuItem onClick={() => actions.retry(script.id)}>
                <RotateCw />
                Thử lại
              </MenuItem>
            )}
            {editable && (
              <>
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
          </>
        )}
      </ContextMenuPopup>
    </ContextMenu>
  );
}

/** Pins the whole selection, or unpins it when every script is already pinned. */
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

// ---------------------------------------------------------------- small parts

/** Shows on hover where a card can be grabbed to drag it onto the chat. */
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

/** The card's prompt for a guided variant. Enter creates, Esc closes. */
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

/** Marks a script that is referenced in the chat composer. */
function RefMark() {
  return (
    <MessageSquare className="size-3 shrink-0 text-foreground" aria-label="Đang nhắc trong chat" />
  );
}

function MarkBadge({ mark }: { mark: Script["mark"] }) {
  if (!mark) return null;
  return (
    <span className="shrink-0 rounded-full border bg-accent px-1.5 py-px text-2xs font-medium text-accent-foreground">
      {mark === "new" ? "Mới" : "Đã sửa"}
    </span>
  );
}

function ProductTag({ product }: { product: Asset }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <AssetThumb asset={product} className="size-5 rounded" />
      <span className="truncate">{product.name}</span>
    </span>
  );
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

/** Placeholder bars while text is being written. */
function Bars({ count, className }: { count: number; className?: string }) {
  const widths = ["w-2/3", "w-full", "w-5/6", "w-11/12", "w-3/4", "w-4/5"];
  return (
    <div className={cn("flex flex-col gap-2", className)} role="status" aria-label="Đang viết">
      {Array.from({ length: count }, (_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
          key={i}
          className={cn("shimmer h-3 rounded bg-muted", widths[i % widths.length])}
        />
      ))}
    </div>
  );
}

/**
 * FLIP animation for the cards in `container` ([data-flip] children): cards
 * that moved slide to their new place, a variant grows out of its source, and
 * other new cards fade in. Runs after every render; positions are relative to
 * the container, so scrolling does not count as movement.
 */
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
