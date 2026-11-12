import { useMatches } from "@tanstack/react-router";

/**
 * Top-level areas of the app, chosen with the icon rail on the left. Each one owns
 * its sidebar and content. "generate" is always the first item and the default.
 * "settings" is reached from the gear icon at the bottom of the rail and has no sidebar.
 */
export type Section = "generate" | "assets" | "settings";

export const TABS: { id: Exclude<Section, "settings">; label: string }[] = [
  { id: "generate", label: "Tạo video" },
  { id: "assets", label: "Thư viện" },
];

export function useSection(): Section {
  const ids = useMatches().map((m) => m.routeId as string);
  if (ids.some((id) => id.startsWith("/assets"))) return "assets";
  if (ids.includes("/settings")) return "settings";
  return "generate";
}

/** Where each tab was last left, so switching tabs returns to the same place. */
export const lastPath: Record<Exclude<Section, "settings">, string> = {
  generate: "/",
  assets: "/assets",
};
