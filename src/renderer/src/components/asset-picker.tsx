import { type Asset, type AssetKind, mediaUrl, type Series } from "@shared/ipc";
import { Check, ImagePlus, Plus, X } from "lucide-react";
import { useState } from "react";
import { ASSET_KINDS } from "@/lib/asset-kinds";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";
import { AssetDialog } from "./asset-dialog";
import { ProductImportDialog } from "./product-import-dialog";
import { Button } from "./ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from "./ui/dialog";

const LABEL: Record<AssetKind, { title: string }> = {
  character: { title: "Nhân vật" },
  product: { title: "Sản phẩm" },
  environment: { title: "Bối cảnh" },
};

export const assetLabel = (kind: AssetKind) => LABEL[kind].title;

/**
 * Each kind keeps its own thumbnail shape wherever assets appear together, so
 * they read apart at a glance: round faces, square products, wide places.
 */
const THUMB_SHAPE: Record<AssetKind, Record<"sm" | "md", string>> = {
  character: {
    sm: "size-5.5 rounded-full [&_img]:object-[50%_18%]",
    md: "size-7 rounded-full [&_img]:object-[50%_18%]",
  },
  product: { sm: "size-5.5 rounded-[5px]", md: "size-7 rounded-md" },
  environment: { sm: "h-5.5 w-8 rounded-[5px]", md: "h-7 w-10.5 rounded-md" },
};
export const thumbShape = (kind: AssetKind, size: "sm" | "md") => THUMB_SHAPE[kind][size];

export type SeriesAssetIds = Pick<Series, "characterIds" | "productIds" | "environmentIds">;
const SERIES_KINDS = [
  ["character", "characterIds"],
  ["product", "productIds"],
  ["environment", "environmentIds"],
] as const;

/** The assets a series uses: one labelled row per kind. */
export function SeriesAssetFields({
  value,
  onChange,
}: {
  value: SeriesAssetIds;
  onChange: (value: SeriesAssetIds) => void;
}) {
  return (
    <div className="grid w-full grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2">
      {SERIES_KINDS.map(([kind, field]) => (
        <div key={kind} className="contents">
          <span className="flex h-7 items-center text-xs text-muted-foreground">
            {LABEL[kind].title}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            <AssetChips
              kind={kind}
              ids={value[field]}
              onChange={(ids) => onChange({ ...value, [field]: ids })}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function AssetThumb({ asset, className }: { asset: Asset; className?: string }) {
  const cover = asset.images[0];
  const Icon = ASSET_KINDS[asset.kind].icon;
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-md border bg-muted text-muted-foreground",
        className,
      )}
    >
      {cover ? (
        <img
          src={mediaUrl.asset(asset.id, cover.file)}
          alt=""
          draggable={false}
          className="size-full object-cover"
        />
      ) : (
        <Icon className="size-1/2" />
      )}
    </span>
  );
}

/** Selected library assets as removable chips, ending with the button that opens the picker. */
export function AssetChips({
  kind,
  ids,
  onChange,
}: {
  kind: AssetKind;
  ids: string[];
  onChange: (ids: string[]) => void;
}) {
  const [picking, setPicking] = useState(false);
  const assets = useWorkspace().assets;
  const selected = ids.flatMap((id) => assets.find((a) => a.id === id) ?? []);

  return (
    <>
      {selected.map((asset) => (
        <span
          key={asset.id}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-[var(--control-radius)] border bg-background pr-1 text-xs",
            asset.kind === "character" ? "pl-[3px]" : "pl-0.5",
          )}
        >
          <AssetThumb asset={asset} className={cn("border-0", thumbShape(asset.kind, "sm"))} />
          <span className="max-w-32 truncate">{asset.name}</span>
          <button
            type="button"
            className="grid size-4.5 cursor-pointer place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={`Bỏ ${asset.name}`}
            onClick={() => onChange(ids.filter((id) => id !== asset.id))}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <Button
        variant="ghost-muted"
        size="icon-sm"
        aria-label={`Chọn ${LABEL[kind].title.toLowerCase()}`}
        title="Chọn từ thư viện"
        onClick={() => setPicking(true)}
      >
        <Plus />
      </Button>
      <AssetPicker
        kind={kind}
        open={picking}
        onOpenChange={setPicking}
        selected={ids}
        onConfirm={onChange}
      />
    </>
  );
}

/** Choose which library assets of one kind a series uses. */
export function AssetPicker({
  kind,
  open,
  onOpenChange,
  selected,
  onConfirm,
}: {
  kind: AssetKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: string[];
  onConfirm: (ids: string[]) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-2xl">
        {/* Mounted per opening, so the draft selection always starts from the saved one. */}
        <PickerBody
          kind={kind}
          selected={selected}
          onConfirm={(ids) => {
            onConfirm(ids);
            onOpenChange(false);
          }}
        />
      </DialogPopup>
    </Dialog>
  );
}

function PickerBody({
  kind,
  selected,
  onConfirm,
}: {
  kind: AssetKind;
  selected: string[];
  onConfirm: (ids: string[]) => void;
}) {
  const assets = useWorkspace().assets.filter((a) => a.kind === kind);
  const [draft, setDraft] = useState(selected);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const { title } = LABEL[kind];
  const copy = ASSET_KINDS[kind];
  // Anything created from here is meant for this series: select it straight away.
  const select = (created: Asset[]) =>
    setDraft((ids) => [...ids, ...created.map((a) => a.id).filter((id) => !ids.includes(id))]);
  const createButtons = (
    <>
      {kind === "product" && (
        <Button variant="outline" onClick={() => setImporting(true)}>
          <ImagePlus />
          Nhập nhiều ảnh
        </Button>
      )}
      <Button variant="outline" onClick={() => setCreating(true)}>
        <Plus />
        {copy.create}
      </Button>
    </>
  );
  const toggle = (id: string) =>
    setDraft((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]));

  return (
    <>
      <DialogHeader>
        <DialogTitle>Chọn {title.toLowerCase()}</DialogTitle>
      </DialogHeader>
      {assets.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
          <p className="text-muted-foreground">Thư viện chưa có {title.toLowerCase()}.</p>
          <div className="flex gap-2">{createButtons}</div>
        </div>
      ) : (
        <div className="grid min-h-0 grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-4 overflow-y-auto p-5">
          {assets.map((asset) => {
            const on = draft.includes(asset.id);
            return (
              <button
                key={asset.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(asset.id)}
                className="group cursor-pointer text-left outline-none"
              >
                <div
                  className={cn(
                    "relative aspect-[3/4] overflow-hidden rounded-xl border bg-muted group-focus-visible:ring-2 group-focus-visible:ring-ring",
                    on && "ring-2 ring-foreground",
                  )}
                >
                  <AssetThumb asset={asset} className="size-full rounded-none border-0" />
                  {on && (
                    <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-foreground text-background">
                      <Check className="size-3" />
                    </span>
                  )}
                </div>
                <div className="mt-1.5 truncate text-xs font-medium">{asset.name}</div>
              </button>
            );
          })}
        </div>
      )}
      <DialogFooter>
        {assets.length > 0 && createButtons}
        <span className="flex-1 text-right text-xs text-muted-foreground">
          {draft.length > 0 && `Đã chọn ${draft.length}`}
        </span>
        <Button onClick={() => onConfirm(draft)}>Xong</Button>
      </DialogFooter>
      {/* Opened on top of the picker, so the page underneath never changes. */}
      <AssetDialog
        kind={kind}
        open={creating}
        onOpenChange={setCreating}
        onCreated={(asset) => select([asset])}
      />
      {kind === "product" && (
        <ProductImportDialog open={importing} onOpenChange={setImporting} onCreated={select} />
      )}
    </>
  );
}
