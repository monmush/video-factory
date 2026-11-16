import type { Asset, Script } from "@shared/ipc";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";
import { AssetThumb } from "./asset-picker";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "./ui/menu";

// One product per video, picked on the script card (docs/SCRIPT_BOARD_DECISIONS.md,
// "Product per video"): the series' products first, then the rest of the
// library (picking one adds it to the series), then none. The change rewrites
// only what is about the product, in the main process.

const NONE = "none";

export function ProductPicker({
  script,
  seriesProductIds,
  disabled,
  onPick,
}: {
  script: Script;
  seriesProductIds: readonly string[];
  disabled?: boolean;
  onPick: (productId: string | null) => void;
}) {
  const { assets } = useWorkspace();
  const products = assets.filter((a) => a.kind === "product");
  const current = products.find((p) => p.id === script.productIds[0]);
  const inSeries = products.filter((p) => seriesProductIds.includes(p.id));
  const others = products.filter((p) => !seriesProductIds.includes(p.id));
  const changing = script.status === "writing" && script.changing === "product";

  if (changing) {
    return (
      <span className="shimmer rounded text-xs text-muted-foreground">Đang đổi sản phẩm…</span>
    );
  }
  return (
    <Menu>
      <MenuTrigger
        disabled={disabled}
        className={cn(
          "-mx-1 flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent",
        )}
        aria-label="Sản phẩm"
      >
        {current ? (
          <>
            <AssetThumb asset={current} className="size-5 rounded" />
            <span className="truncate">{current.name}</span>
          </>
        ) : (
          <span>Không có sản phẩm</span>
        )}
        {!disabled && <ChevronDown className="size-3 shrink-0 opacity-60" />}
      </MenuTrigger>
      <MenuPopup align="start" className="max-h-80 w-64 overflow-y-auto">
        <MenuRadioGroup
          value={current?.id ?? NONE}
          onValueChange={(value) => {
            const next = value === NONE ? null : String(value);
            if (next !== (current?.id ?? null)) onPick(next);
          }}
        >
          {inSeries.length > 0 && (
            <MenuGroup>
              <MenuGroupLabel>Series</MenuGroupLabel>
              {inSeries.map((p) => (
                <ProductItem key={p.id} product={p} />
              ))}
            </MenuGroup>
          )}
          {others.length > 0 && (
            <MenuGroup>
              <MenuGroupLabel>Thư viện</MenuGroupLabel>
              {others.map((p) => (
                <ProductItem key={p.id} product={p} />
              ))}
            </MenuGroup>
          )}
          <MenuGroup>
            {products.length > 0 && <div className="my-1 h-px bg-border" />}
            <MenuRadioItem value={NONE}>Không có sản phẩm</MenuRadioItem>
          </MenuGroup>
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

function ProductItem({ product }: { product: Asset }) {
  return (
    <MenuRadioItem value={product.id}>
      <span className="flex min-w-0 items-center gap-2">
        <AssetThumb asset={product} className="size-5 rounded" />
        <span className="truncate">{product.name}</span>
      </span>
    </MenuRadioItem>
  );
}
