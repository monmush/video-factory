import { Navigate } from "@tanstack/react-router";
import { useWorkspace } from "@/lib/workspace";

/** Opens the most recent series; with none yet, goes straight to creating one. */
export function HomePage() {
  const latest = useWorkspace().series.at(-1);
  if (latest) return <Navigate to="/series/$seriesId" params={{ seriesId: latest.id }} replace />;
  return <Navigate to="/series/new" replace />;
}
