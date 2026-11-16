import type { Asset } from "@shared/ipc";
import { evenMix, mixTotal, type ProductMix, shortNames } from "@shared/product-mix";
import { Plus, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { useWorkspace } from "@/lib/workspace";
import { AssetThumb } from "./asset-picker";
import { Page } from "./page";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";

// "Thiết lập": the batch's own settings, one row each
// (src/shared/batch-settings.ts). Experiment branch: the Media level lives on
// the Video tab, in view while videos are made; here is the product mix, the
// target for scripts not yet written (src/shared/product-mix.ts).

export function BatchSettings({ sessionId }: { sessionId: string }) {
  const { sessions, series, assets } = useWorkspace();
  const session = sessions.find((s) => s.id === sessionId);
  const own = series.find((s) => s.id === session?.seriesId);
  const [error, setError] = useState<string | null>(null);
  if (!session) return null;

  const save = async (mix: ProductMix) => {
    setError(null);
    try {
      await api.invoke("session:update", {
        id: sessionId,
        settings: { productMix: mix.length ? mix : null },
      });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Page className="max-w-2xl pt-6">
      <div className="flex flex-col divide-y rounded-lg border">
        <SettingRow label="Sản phẩm">
          <MixEditor
            saved={session.settings?.productMix ?? []}
            products={assets.filter((a) => a.kind === "product")}
            seriesProductIds={own?.productIds ?? []}
            onSave={save}
          />
        </SettingRow>
      </div>
      {error && <p className="mt-2 text-xs text-destructive-foreground">{error}</p>}
    </Page>
  );
}

/**
 * The mix as a row of products with their shares. Adding or removing one
 * splits evenly again; a typed share is saved once the shares add up to 100.
 */
function MixEditor({
  saved,
  products,
  seriesProductIds,
  onSave,
}: {
  saved: ProductMix;
  products: Asset[];
  seriesProductIds: readonly string[];
  onSave: (mix: ProductMix) => void;
}) {
  const [draft, setDraft] = useState(saved);
  const savedKey = JSON.stringify(saved);
  // A change saved elsewhere (the chat) replaces the draft.
  useEffect(() => setDraft(JSON.parse(savedKey) as ProductMix), [savedKey]);
  const names = shortNames(products.map((p) => p.name));
  const shortName = (id: string) => names[products.findIndex((p) => p.id === id)] ?? "?";
  const unused = products.filter((p) => !draft.some((e) => e.productId === p.id));
  const inSeries = unused.filter((p) => seriesProductIds.includes(p.id));
  const others = unused.filter((p) => !seriesProductIds.includes(p.id));
  const total = mixTotal(draft);

  const respread = (ids: string[]) => {
    const next = evenMix(ids);
    setDraft(next);
    onSave(next);
  };
  const setShare = (id: string, value: string) => {
    const share = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    const next = draft.map((e) => (e.productId === id ? { ...e, share } : e));
    setDraft(next);
    if (mixTotal(next) === 100 && next.every((e) => e.share > 0)) onSave(next);
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
      {draft.length === 0 && <span className="text-xs text-muted-foreground">Theo series</span>}
      {draft.map((entry) => {
        const product = products.find((p) => p.id === entry.productId);
        return (
          <span key={entry.productId} className="flex items-center gap-1.5">
            {product && <AssetThumb asset={product} className="size-5 rounded" />}
            <span className="text-xs">{shortName(entry.productId)}</span>
            <Input
              size="sm"
              type="number"
              min={1}
              max={100}
              aria-label={`Tỉ lệ ${product?.name ?? ""}`}
              className="w-14"
              value={String(entry.share)}
              onChange={(e) => setShare(entry.productId, e.target.value)}
            />
            <span className="text-xs text-muted-foreground">%</span>
            <Button
              variant="ghost-muted"
              size="icon-xs"
              aria-label={`Bỏ ${product?.name ?? ""}`}
              onClick={() =>
                respread(draft.map((e) => e.productId).filter((id) => id !== entry.productId))
              }
            >
              <X />
            </Button>
          </span>
        );
      })}
      {draft.length > 0 && total !== 100 && (
        <span className="text-xs text-destructive-foreground tabular-nums">Tổng {total}%</span>
      )}
      {unused.length > 0 && (
        <Menu>
          <MenuTrigger render={<Button variant="outline" size="xs" />}>
            <Plus />
            Thêm
          </MenuTrigger>
          <MenuPopup align="end" className="max-h-80 w-60 overflow-y-auto">
            {[
              { label: "Series", list: inSeries },
              { label: "Thư viện", list: others },
            ]
              .filter((g) => g.list.length)
              .map((g) => (
                <MenuGroup key={g.label}>
                  <MenuGroupLabel>{g.label}</MenuGroupLabel>
                  {g.list.map((p) => (
                    <MenuItem
                      key={p.id}
                      onClick={() => respread([...draft.map((e) => e.productId), p.id])}
                    >
                      <AssetThumb asset={p} className="size-5 rounded" />
                      <span className="truncate">{p.name}</span>
                    </MenuItem>
                  ))}
                </MenuGroup>
              ))}
          </MenuPopup>
        </Menu>
      )}
    </div>
  );
}

function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center gap-3 px-4 py-2">
      <span className="flex-1 font-medium">{label}</span>
      {children}
    </div>
  );
}
