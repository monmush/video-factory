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
import { Badge } from "@/components/ui/badge";
import { ASSET_CATEGORIES, type AssetCategoryId } from "@/lib/asset-categories";
import { CATEGORY_KIND } from "@/lib/asset-kinds";

const ICONS: Record<AssetCategoryId, LucideIcon> = {
  characters: UserRound,
  products: Package,
  environments: Mountain,
  styles: Palette,
  scenes: Clapperboard,
};

const rowLayout = "flex items-center gap-2.5 rounded-[var(--control-radius)] px-2.5 py-1.5";

const row = `${rowLayout} text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground [&.active]:bg-sidebar-row-selected [&.active]:text-sidebar-foreground`;

const comingSoonRow = `${rowLayout} text-sidebar-muted-foreground/60`;

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
        if (!CATEGORY_KIND[category.id]) {
          return (
            <div key={category.id} className={comingSoonRow}>
              <Icon className="size-4" />
              <span className="flex-1">{category.label}</span>
              <Badge>Sắp có</Badge>
            </div>
          );
        }
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
