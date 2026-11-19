import { useMatches } from "@tanstack/react-router";

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

export const lastPath: Record<Exclude<Section, "settings">, string> = {
  generate: "/",
  assets: "/assets",
};
