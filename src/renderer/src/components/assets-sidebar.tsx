import { Link } from "@tanstack/react-router";
import {
  Clapperboard,
  LayoutGrid,
  type LucideIcon,
  Mountain,
  Package,
  Palette,
  UserRound,
} from "lucide-react";
import { ASSET_CATEGORIES, type AssetCategoryId } from "@/lib/asset-categories";

const ICONS: Record<AssetCategoryId, LucideIcon> = {
  characters: UserRound,
  products: Package,
  environments: Mountain,
  styles: Palette,
  scenes: Clapperboard,
};

const row =
  "flex items-center gap-2.5 rounded-[var(--control-radius)] px-2.5 py-1.5 text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground [&.active]:bg-sidebar-row-selected [&.active]:text-sidebar-foreground";

/** Sidebar of the Thư viện tab: shared assets by category. */
export function AssetsSidebar() {
  return (
    <div className="flex flex-col gap-1 px-1 py-2">
      <Link to="/assets" activeOptions={{ exact: true }} className={row}>
        <LayoutGrid className="size-4" />
        Tất cả
      </Link>

      <div className="px-2.5 pt-4 pb-1 text-xs text-sidebar-muted-foreground">Danh mục</div>
      {ASSET_CATEGORIES.map((category) => {
        const Icon = ICONS[category.id];
        return (
          <Link
            key={category.id}
            to="/assets/$category"
            params={{ category: category.id }}
            className={row}
          >
            <Icon className="size-4" />
            {category.label}
          </Link>
        );
      })}
    </div>
  );
}
