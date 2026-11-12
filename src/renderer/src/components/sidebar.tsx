import type { Series, Session } from "@shared/ipc";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  Ellipsis,
  Folder,
  FolderOpen,
  type LucideIcon,
  Pencil,
  Pin,
  PinOff,
  Plus,
  SquareArrowOutUpRight,
  Trash2,
} from "lucide-react";
import { type CSSProperties, Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useCreateActions } from "@/lib/actions";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { refreshWorkspace, useWorkspace } from "@/lib/workspace";
import { DeleteSeriesDialog } from "./delete-series-dialog";
import { DeleteSessionDialog } from "./delete-session-dialog";
import { Button } from "./ui/button";
import {
  ContextMenu,
  ContextMenuPopup,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const VISIBLE_SESSIONS = 3;

/** Pinned items first, otherwise in their saved order. */
function pinnedFirst<T extends { pinnedAt?: string }>(items: T[]): T[] {
  return [...items.filter((i) => i.pinnedAt), ...items.filter((i) => !i.pinnedAt)];
}

export function Sidebar() {
  const workspace = useWorkspace();
  const { createSeries } = useCreateActions();

  return (
    <div className="flex flex-col gap-1 px-1 py-2">
      <button
        type="button"
        className="flex h-8 cursor-pointer items-center gap-2.5 rounded-[var(--control-radius)] px-2.5 font-medium hover:bg-sidebar-row-hover"
        onClick={createSeries}
      >
        <Plus className="size-4 text-sidebar-muted-foreground" />
        Tạo series
      </button>

      <div className="px-2.5 pt-4 pb-1 text-xs text-sidebar-muted-foreground">Series</div>
      {workspace.series.length === 0 && (
        <p className="px-2.5 text-sidebar-muted-foreground">Chưa có series.</p>
      )}
      {pinnedFirst(workspace.series).map((series) => (
        <SeriesFolder
          key={series.id}
          series={series}
          sessions={pinnedFirst(workspace.sessions.filter((s) => s.seriesId === series.id))}
        />
      ))}
    </div>
  );
}

type RowAction =
  | { label: string; icon: LucideIcon; onClick: () => void; destructive?: boolean }
  | "separator";

/** The same actions in the ⋯ menu and the right-click menu. */
function RowActionItems({ actions }: { actions: RowAction[] }) {
  return actions.map((action, i) =>
    action === "separator" ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: static list
      <ContextMenuSeparator key={i} />
    ) : (
      <MenuItem key={action.label} destructive={action.destructive} onClick={action.onClick}>
        <action.icon />
        {action.label}
      </MenuItem>
    ),
  );
}

async function setPinned(kind: "series" | "session", id: string, pinned: boolean) {
  await api.invoke(kind === "series" ? "series:update" : "session:update", { id, pinned });
  await refreshWorkspace();
}

function SeriesFolder({ series, sessions }: { series: Series; sessions: Session[] }) {
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { createSession } = useCreateActions();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { seriesId?: string; sessionId?: string };
  const current = params.seriesId === series.id || sessions.some((s) => s.id === params.sessionId);
  const visible = showAll ? sessions : sessions.slice(0, VISIBLE_SESSIONS);
  const FolderIcon = open ? FolderOpen : Folder;
  const pinned = Boolean(series.pinnedAt);
  const menuShown = menuOpen || contextOpen;

  const actions: RowAction[] = [
    {
      label: "Mở series",
      icon: SquareArrowOutUpRight,
      onClick: () => navigate({ to: "/series/$seriesId", params: { seriesId: series.id } }),
    },
    {
      label: pinned ? "Bỏ ghim" : "Ghim",
      icon: pinned ? PinOff : Pin,
      onClick: () => setPinned("series", series.id, !pinned),
    },
    "separator",
    { label: "Xóa", icon: Trash2, destructive: true, onClick: () => setDeleting(true) },
  ];

  return (
    <div>
      <ContextMenu onOpenChange={setContextOpen}>
        <ContextMenuTrigger
          className={cn(
            "group relative flex items-center rounded-[var(--control-radius)] hover:bg-sidebar-row-hover",
            current && "font-medium",
            menuShown && "bg-sidebar-row-hover",
          )}
        >
          <Tooltip disabled={menuShown}>
            <TooltipTrigger
              delay={600}
              render={
                <button
                  type="button"
                  className="flex h-8 min-w-0 flex-1 cursor-pointer items-center text-left"
                  aria-expanded={open}
                  onClick={() => setOpen(!open)}
                />
              }
            >
              <span className="grid w-8 shrink-0 place-items-center text-sidebar-muted-foreground">
                <FolderIcon className="size-4" />
              </span>
              <span className="min-w-0 flex-1 truncate pr-14">{series.name}</span>
            </TooltipTrigger>
            <SeriesCard series={series} sessionCount={sessions.length} />
          </Tooltip>
          {pinned && (
            <Pin
              aria-label="Đã ghim"
              className="absolute right-2.5 size-3.5 text-sidebar-muted-foreground group-focus-within:opacity-0 group-hover:opacity-0"
            />
          )}
          <div
            className={cn(
              "absolute right-1 flex opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
              menuShown && "opacity-100",
            )}
          >
            <Menu open={menuOpen} onOpenChange={setMenuOpen}>
              <MenuTrigger
                render={
                  <Button
                    variant="ghost-muted"
                    size="icon-xs"
                    aria-label={`Tùy chọn ${series.name}`}
                    title="Tùy chọn"
                  />
                }
              >
                <Ellipsis />
              </MenuTrigger>
              <MenuPopup align="start">
                <RowActionItems actions={actions} />
              </MenuPopup>
            </Menu>
            <Button
              variant="ghost-muted"
              size="icon-xs"
              aria-label={`Tạo video cho ${series.name}`}
              title="Tạo video"
              onClick={() => createSession(series.id)}
            >
              <Plus />
            </Button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuPopup>
          <RowActionItems actions={actions} />
        </ContextMenuPopup>
      </ContextMenu>
      <DeleteSeriesDialog series={series} open={deleting} onOpenChange={setDeleting} />

      {open && (
        <div className="mb-2 ml-3 flex flex-col gap-px">
          {visible.map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
          {sessions.length > VISIBLE_SESSIONS && (
            <button
              type="button"
              className="px-2.5 py-2 text-left text-sidebar-muted-foreground hover:text-sidebar-foreground"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? "Thu gọn" : "Xem thêm"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Hover card: the full name, the series direction and how many videos it has. */
function SeriesCard({ series, sessionCount }: { series: Series; sessionCount: number }) {
  return (
    <TooltipPopup className="flex w-72 flex-col gap-1.5">
      <div className="font-medium [overflow-wrap:anywhere]">{series.name}</div>
      {series.guidance && (
        <p className="line-clamp-4 leading-relaxed text-muted-foreground">{series.guidance}</p>
      )}
      <div className="flex items-center gap-1.5 pt-0.5 text-xs text-muted-foreground">
        <Folder className="size-3.5" />
        {sessionCount > 0 ? `${sessionCount} video` : "Chưa có video"}
      </div>
    </TooltipPopup>
  );
}

function SessionRow({ session }: { session: Session }) {
  const [renaming, setRenaming] = useState(false);
  const renameAfterMenu = useRef(false);
  const [deleting, setDeleting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pinned = Boolean(session.pinnedAt);

  const actions: RowAction[] = [
    {
      label: "Đổi tên",
      icon: Pencil,
      // Opened once the menu has fully closed, so its focus handling can't blur the input.
      onClick: () => {
        renameAfterMenu.current = true;
      },
    },
    {
      label: pinned ? "Bỏ ghim" : "Ghim",
      icon: pinned ? PinOff : Pin,
      onClick: () => setPinned("session", session.id, !pinned),
    },
    "separator",
    { label: "Xóa", icon: Trash2, destructive: true, onClick: () => setDeleting(true) },
  ];

  return (
    <Fragment>
      {renaming ? (
        <RenameInput session={session} onDone={() => setRenaming(false)} />
      ) : (
        <ContextMenu
          onOpenChange={setMenuOpen}
          onOpenChangeComplete={(open) => {
            if (!open && renameAfterMenu.current) {
              renameAfterMenu.current = false;
              setRenaming(true);
            }
          }}
        >
          <ContextMenuTrigger
            render={
              <Link
                to="/sessions/$sessionId"
                params={{ sessionId: session.id }}
                className={cn(
                  "group/session flex items-center gap-2 rounded-[var(--control-radius)] px-2.5 py-2 hover:bg-sidebar-row-hover [&.active]:bg-sidebar-row-selected",
                  menuOpen && "bg-sidebar-row-hover",
                )}
                activeOptions={{ exact: false }}
                onDoubleClick={() => setRenaming(true)}
              />
            }
          >
            <ScrollingName name={session.name} />
            {pinned && (
              <Pin
                aria-label="Đã ghim"
                className="size-3.5 shrink-0 text-sidebar-muted-foreground"
              />
            )}
          </ContextMenuTrigger>
          {/* No focus return: it would land after "Đổi tên" opens the input and blur it. */}
          <ContextMenuPopup finalFocus={false}>
            <RowActionItems actions={actions} />
          </ContextMenuPopup>
        </ContextMenu>
      )}
      <DeleteSessionDialog session={session} open={deleting} onOpenChange={setDeleting} />
    </Fragment>
  );
}

/**
 * A name that fits shows as is. A long one fades at the right edge and, after a
 * short hover, glides left at reading speed to show its end, then returns on leave.
 */
function ScrollingName({ name }: { name: string }) {
  const outer = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the name changes
  useLayoutEffect(() => {
    const measure = () => {
      if (outer.current && inner.current) {
        setOverflow(Math.max(0, inner.current.scrollWidth - outer.current.clientWidth));
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (outer.current) observer.observe(outer.current);
    return () => observer.disconnect();
  }, [name]);

  // The right-edge fade (styles.css) clears as the end arrives.
  const shift = overflow;
  const style = {
    "--shift": `-${shift}px`,
    // About 25 px per second at a constant pace, so the words can be read as they pass.
    "--dur": `${Math.min(14000, Math.max(1500, (shift / 25) * 1000))}ms`,
  } as CSSProperties;

  return (
    <span
      ref={outer}
      className={cn(
        "scrolling-name min-w-0 flex-1 overflow-hidden whitespace-nowrap",
        overflow > 0 && "is-overflowing",
      )}
      style={style}
    >
      <span ref={inner} className="inline-block">
        {name}
      </span>
    </span>
  );
}

function RenameInput({ session, onDone }: { session: Session; onDone: () => void }) {
  const [value, setValue] = useState(session.name);
  const done = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  // Focus on the next frame, once the row it replaces is gone.
  useEffect(() => {
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const finish = async (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const name = value.trim();
    if (save && name && name !== session.name) {
      await api.invoke("session:update", { id: session.id, name });
      await refreshWorkspace();
    }
    onDone();
  };

  return (
    <input
      ref={input}
      aria-label="Tên video"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
      className="h-9 rounded-[var(--control-radius)] bg-sidebar-row-selected px-2.5 outline-none ring-1 ring-ring"
    />
  );
}
