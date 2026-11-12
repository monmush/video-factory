import { Link, Outlet, useMatches, useRouter, useRouterState } from "@tanstack/react-router";
import {
  Gauge,
  House,
  LibraryBig,
  type LucideIcon,
  PanelLeft,
  PanelRight,
  Settings,
} from "lucide-react";
import { type PointerEvent, useEffect, useState } from "react";
import { onChatFocusRequest } from "@/lib/board";
import { lastPath, type Section, TABS, useSection } from "@/lib/sections";
import { usePersistentNumber, usePersistentToggle } from "@/lib/shell-state";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";
import { AssetsSidebar } from "./assets-sidebar";
import { Breadcrumb } from "./breadcrumb";
import { SessionChat } from "./session-chat";
import { Sidebar } from "./sidebar";
import { Button } from "./ui/button";
import { UsageDialog } from "./usage-dialog";

/**
 * Desktop shell. An icon rail on the far left switches areas (Tạo video,
 * Thư viện) and opens usage and settings. The active area decides the sidebar
 * next to the rail; the content sits in a bordered card of its own. Sessions
 * additionally get their collapsible chat panel on the right of the card.
 */
export function AppShell() {
  const section = useSection();
  const [sidebarOpen, toggleSidebar] = usePersistentToggle("sidebar-open", true);
  const [panelOpen, togglePanel, setPanelOpen] = usePersistentToggle("panel-open", true);
  // "Nhắc trong chat" on a card opens the chat if it is closed.
  useEffect(() => onChatFocusRequest(() => setPanelOpen(true)), [setPanelOpen]);
  const panel = useSidePanel();
  const isMac = window.hyan.platform === "darwin";
  const hasSidebar = section !== "settings";
  const showSidebar = hasSidebar && sidebarOpen;
  const [usageOpen, setUsageOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth, saveSidebarWidth] = usePersistentNumber(
    "sidebar-width",
    SIDEBAR_WIDTH.initial,
  );
  const [panelWidth, setPanelWidth, savePanelWidth] = usePersistentNumber(
    "panel-width",
    PANEL_WIDTH.initial,
  );

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Derive the tab from the URL itself (not from route matches) so the pair can
  // never be out of step while a navigation is in flight.
  useEffect(() => {
    if (pathname === "/settings") return;
    lastPath[pathname.startsWith("/assets") ? "assets" : "generate"] = pathname;
  }, [pathname]);

  return (
    <div
      className={cn(
        "grid h-full grid-rows-[var(--titlebar-height)_minmax(0,1fr)] bg-sidebar text-sidebar-foreground",
      )}
      style={{
        gridTemplateColumns: `52px ${showSidebar ? clamp(sidebarWidth, SIDEBAR_WIDTH) : 0}px minmax(0,1fr)`,
      }}
    >
      <header
        className={cn(
          "app-drag col-span-full flex items-center gap-1 px-2",
          // Leave room for the macOS traffic lights (positioned in main/index.ts).
          isMac && "pl-[78px]",
        )}
      >
        {hasSidebar && (
          <Button
            variant="ghost-muted"
            size="icon-sm"
            className="app-no-drag hover:bg-sidebar-row-hover"
            aria-label="Thanh bên"
            title="Thanh bên"
            aria-expanded={sidebarOpen}
            onClick={toggleSidebar}
          >
            <PanelLeft />
          </Button>
        )}
        <Breadcrumb />
        <span className="flex-1" />
        {panel && (
          <Button
            variant="ghost-muted"
            size="icon-sm"
            className="app-no-drag hover:bg-sidebar-row-hover"
            aria-label={panel.label}
            title={panel.label}
            aria-expanded={panelOpen}
            onClick={togglePanel}
          >
            <PanelRight />
          </Button>
        )}
      </header>

      <NavRail active={section} onUsage={() => setUsageOpen(true)} />
      <UsageDialog open={usageOpen} onOpenChange={setUsageOpen} />

      <aside
        className={cn("relative min-h-0", !showSidebar && "invisible")}
        aria-label={section === "assets" ? "Danh mục thư viện" : "Series và video"}
      >
        <div className="h-full overflow-y-auto">
          {hasSidebar && (
            <div className="px-3.5 pt-1.5 pb-1 font-medium text-base">
              {TABS.find((t) => t.id === section)?.label}
            </div>
          )}
          {section === "assets" ? <AssetsSidebar /> : section === "generate" ? <Sidebar /> : null}
        </div>
        {showSidebar && (
          <ResizeHandle
            edge="right"
            bounds={SIDEBAR_WIDTH}
            width={clamp(sidebarWidth, SIDEBAR_WIDTH)}
            onResize={setSidebarWidth}
            onCommit={saveSidebarWidth}
          />
        )}
      </aside>

      {/* Content card: its own surface, inset from the window chrome. */}
      <div className="mr-2 mb-2 flex min-h-0 min-w-0 overflow-hidden rounded-xl border bg-background text-foreground">
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
        {panel && panelOpen && (
          <aside
            className="relative flex shrink-0 flex-col border-l"
            style={{ width: clamp(panelWidth, PANEL_WIDTH) }}
            aria-label={panel.label}
          >
            <ResizeHandle
              edge="left"
              bounds={PANEL_WIDTH}
              width={clamp(panelWidth, PANEL_WIDTH)}
              onResize={setPanelWidth}
              onCommit={savePanelWidth}
              onCollapse={togglePanel}
            />
            <SessionChat key={panel.sessionId} sessionId={panel.sessionId} />
          </aside>
        )}
      </div>
    </div>
  );
}

interface WidthBounds {
  initial: number;
  min: number;
  max: number;
  /** Released below this, the panel closes instead (and keeps its last width). */
  collapseBelow?: number;
}

const SIDEBAR_WIDTH: WidthBounds = { initial: 224, min: 180, max: 420 };
const PANEL_WIDTH: WidthBounds = { initial: 320, min: 280, max: 560, collapseBelow: 200 };
const clamp = (w: number, b: WidthBounds) => Math.min(b.max, Math.max(b.min, w));

/**
 * Drag handle on a panel edge: the sidebar's right edge or the chat's left
 * edge. Drag to resize, double-click to reset; the width is saved when the
 * drag ends. With `onCollapse`, dragging well past the minimum closes the panel.
 */
function ResizeHandle({
  edge,
  bounds,
  width,
  onResize,
  onCommit,
  onCollapse,
}: {
  edge: "left" | "right";
  bounds: WidthBounds;
  width: number;
  onResize: (w: number) => void;
  onCommit: (w: number) => void;
  onCollapse?: () => void;
}) {
  const start = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const originX = e.clientX;
    const direction = edge === "right" ? 1 : -1;
    let raw = width;
    document.body.style.cursor = "col-resize";
    const move = (ev: globalThis.PointerEvent) => {
      raw = width + (ev.clientX - originX) * direction;
      onResize(clamp(raw, bounds));
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      document.body.style.cursor = "";
      if (onCollapse && bounds.collapseBelow && raw < bounds.collapseBelow) {
        // Reopening brings back the width it had before this drag.
        onResize(width);
        onCommit(width);
        onCollapse();
      } else {
        onCommit(clamp(raw, bounds));
      }
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only affordance; the panel toggles cover keyboard users.
    <div
      className={cn(
        "absolute inset-y-0 z-10 w-2 cursor-col-resize",
        edge === "right" ? "-right-1" : "-left-1",
      )}
      title="Kéo để đổi độ rộng"
      onPointerDown={start}
      onDoubleClick={() => {
        onResize(bounds.initial);
        onCommit(bounds.initial);
      }}
    />
  );
}

const railItem =
  "app-no-drag grid size-9 cursor-pointer place-items-center rounded-[var(--control-radius)] text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-sidebar-row-selected aria-[current=page]:text-sidebar-foreground aria-[current=page]:shadow-xs aria-[current=page]:ring-1 aria-[current=page]:ring-sidebar-border [&_svg]:size-[18px]";

/**
 * Narrow icon rail on the far left: the areas of the app at the top, usage and
 * settings at the bottom. Labels show as tooltips.
 */
function NavRail({ active, onUsage }: { active: Section; onUsage: () => void }) {
  const router = useRouter();

  return (
    <nav aria-label="Khu vực" className="flex min-h-0 flex-col items-center gap-1.5 pt-1 pb-3">
      {TABS.map((tab) => {
        const Icon = TAB_ICONS[tab.id];
        return (
          <button
            key={tab.id}
            type="button"
            className={railItem}
            aria-label={tab.label}
            title={tab.label}
            aria-current={active === tab.id ? "page" : undefined}
            onClick={() => {
              if (active !== tab.id) router.history.push(lastPath[tab.id]);
            }}
          >
            <Icon />
          </button>
        );
      })}
      <span className="flex-1" />
      <button
        type="button"
        className={railItem}
        aria-label="Mức sử dụng"
        title="Mức sử dụng"
        onClick={onUsage}
      >
        <Gauge />
      </button>
      <Link
        to="/settings"
        className={railItem}
        aria-label="Cài đặt"
        title="Cài đặt"
        aria-current={active === "settings" ? "page" : undefined}
      >
        <Settings />
      </Link>
    </nav>
  );
}

const TAB_ICONS: Record<Exclude<Section, "settings">, LucideIcon> = {
  generate: House,
  assets: LibraryBig,
};

/** Which side panel the current route offers, if any: sessions get their chat. */
function useSidePanel(): { label: string; sessionId: string } | null {
  const matches = useMatches();
  const workspace = useWorkspace();
  const ids = matches.map((m) => m.routeId as string);
  if (ids.some((id) => id.startsWith("/sessions/$sessionId"))) {
    const sessionId = (matches.at(-1)?.params as { sessionId?: string } | undefined)?.sessionId;
    if (sessionId && workspace.sessions.some((s) => s.id === sessionId)) {
      // No visible title: the panel is plainly a chat. The label names it for
      // the toggle's tooltip and screen readers.
      return { label: "Chat", sessionId };
    }
  }
  return null;
}
