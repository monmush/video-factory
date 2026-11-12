import { Link, useMatches } from "@tanstack/react-router";
import { useWorkspace } from "@/lib/workspace";

/** Visible location: series, then the screen or session within it. */
export function Breadcrumb() {
  const matches = useMatches();
  const workspace = useWorkspace();
  const leaf = matches.at(-1);
  const params = (leaf?.params ?? {}) as { seriesId?: string; sessionId?: string };
  const routeIds = matches.map((m) => m.routeId as string);
  if (routeIds.some((id) => id.startsWith("/assets"))) return null;

  const session = workspace.sessions.find((s) => s.id === params.sessionId);
  const series = workspace.series.find((s) => s.id === (params.seriesId ?? session?.seriesId));

  let current: string | null = null;
  if (routeIds.includes("/settings")) current = "Cài đặt";
  else if (routeIds.includes("/series/new")) current = "Series mới";
  else if (session) current = session.name;

  const showParent = series && current;

  return (
    <nav aria-label="Vị trí" className="flex min-w-0 items-center gap-1.5 px-1 text-xs">
      {showParent && (
        <>
          <Link
            to="/series/$seriesId"
            params={{ seriesId: series.id }}
            className="app-no-drag max-w-64 truncate rounded px-1 py-0.5 text-muted-foreground hover:text-foreground"
          >
            {series.name}
          </Link>
          <span className="text-muted-foreground">/</span>
        </>
      )}
      <span className="max-w-72 truncate font-medium">{current ?? series?.name}</span>
    </nav>
  );
}
