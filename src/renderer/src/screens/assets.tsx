import { type Asset, type AssetInput, type AssetKind, mediaUrl } from "@shared/ipc";
import { useParams } from "@tanstack/react-router";
import { ImagePlus, Plus } from "lucide-react";
import { type DragEvent, useState } from "react";
import { AssetDialog } from "@/components/asset-dialog";
import { Page, Placeholder } from "@/components/page";
import { ProductImportDialog } from "@/components/product-import-dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { findCategory } from "@/lib/asset-categories";
import { ASSET_KINDS, CATEGORY_KIND } from "@/lib/asset-kinds";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { refreshWorkspace, useWorkspace } from "@/lib/workspace";
import { NotFound } from "./not-found";

const CARD = "x-hyan/asset";

/** The update input for an asset unchanged except for its set contents. */
export const withContains = (asset: Asset, contains: string[]): AssetInput => ({
  kind: asset.kind,
  name: asset.name,
  handle: asset.handle,
  description: asset.description,
  images: asset.images.map((img) => ({
    source: "asset" as const,
    assetId: asset.id,
    id: img.id,
    angle: img.angle,
  })),
  contains,
});

/** Shared asset library. Reference: references/ui-patterns/fal-assets. */
export function AssetsPage() {
  const { category } = useParams({ strict: false }) as { category?: string };
  const found = findCategory(category);
  const workspace = useWorkspace();
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [note, setNote] = useState<string | null>(null);

  if (category && !found) return <NotFound />;

  // "Tất cả" shows every asset; implemented categories show their own kind;
  // the rest stay placeholders until built.
  const kind: AssetKind | undefined = found ? CATEGORY_KIND[found.id] : undefined;
  const implemented = !found || kind !== undefined;
  const assets = kind ? workspace.assets.filter((a) => a.kind === kind) : workspace.assets;
  const copy = kind ? ASSET_KINDS[kind] : null;
  const isProducts = kind === "product";

  /** Library drag and drop: dropping a product card onto another puts it in that set. */
  const groupInto = async (childId: string, targetId: string) => {
    const child = workspace.assets.find((a) => a.id === childId);
    const target = workspace.assets.find((a) => a.id === targetId);
    if (!child || !target || child.id === target.id) return;
    // Dropping onto a member of a set adds to that member's set.
    const parent = workspace.assets.find((a) => a.contains?.includes(target.id)) ?? target;
    if (parent.id === child.id || parent.contains?.includes(child.id)) return;
    setNote(null);
    try {
      const previous = workspace.assets.find((a) => a.contains?.includes(child.id));
      if (previous) {
        await api.invoke(
          "assets:update",
          previous.id,
          withContains(
            previous,
            (previous.contains ?? []).filter((c) => c !== child.id),
          ),
        );
      }
      await api.invoke(
        "assets:update",
        parent.id,
        withContains(parent, [...(parent.contains ?? []), child.id]),
      );
      setNote(`Đã thêm ${child.name} vào bộ ${parent.name}.`);
    } catch (e) {
      setNote(errorMessage(e));
    }
    await refreshWorkspace();
  };

  return (
    <Page>
      <div className="mb-6 flex items-center gap-2">
        <h1 className="flex-1 text-2xl font-semibold">{found?.label ?? "Thư viện"}</h1>
        {isProducts && assets.length > 0 && (
          <Button variant="outline" onClick={() => setImporting(true)}>
            <ImagePlus />
            Nhập nhiều ảnh
          </Button>
        )}
        {copy && assets.length > 0 && (
          <Button onClick={() => setCreating(true)}>
            <Plus />
            {copy.create}
          </Button>
        )}
      </div>

      {isProducts && assets.length > 1 && (
        <p className="-mt-4 mb-5 text-xs text-muted-foreground">
          {note ?? "Kéo một sản phẩm thả vào sản phẩm khác để ghép thành bộ (ví dụ hộp quà)."}
        </p>
      )}

      {!implemented ? (
        <Placeholder title={`Chưa có ${found?.label.toLowerCase()}`} />
      ) : assets.length === 0 ? (
        kind ? (
          <EmptyKind
            kind={kind}
            onCreate={() => setCreating(true)}
            onImport={isProducts ? () => setImporting(true) : undefined}
          />
        ) : (
          <Placeholder title="Chưa có tài nguyên" />
        )
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-5">
          {assets.map((asset) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              memberOf={workspace.assets.find((a) => a.contains?.includes(asset.id))?.name}
              draggable={isProducts}
              onDropAsset={isProducts ? (id) => groupInto(id, asset.id) : undefined}
              onOpen={() => setEditing(asset)}
            />
          ))}
        </div>
      )}

      {kind && <AssetDialog kind={kind} open={creating} onOpenChange={setCreating} />}
      {isProducts && <ProductImportDialog open={importing} onOpenChange={setImporting} />}
      {editing && (
        <AssetDialog
          kind={editing.kind}
          asset={editing}
          open
          onOpenChange={(open) => !open && setEditing(null)}
        />
      )}
    </Page>
  );
}

function AssetCard({
  asset,
  memberOf,
  draggable,
  onDropAsset,
  onOpen,
}: {
  asset: Asset;
  memberOf?: string;
  draggable?: boolean;
  onDropAsset?: (assetId: string) => void;
  onOpen: () => void;
}) {
  const [over, setOver] = useState(false);
  const cover = asset.images[0];
  const Icon = ASSET_KINDS[asset.kind].icon;
  const members = asset.contains?.length ?? 0;

  const dragOver = (event: DragEvent) => {
    if (!onDropAsset || !event.dataTransfer.types.includes(CARD)) return;
    event.preventDefault();
    setOver(true);
  };

  return (
    <button
      type="button"
      onClick={onOpen}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData(CARD, asset.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={dragOver}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData(CARD);
        if (id && id !== asset.id) onDropAsset?.(id);
      }}
      className="group cursor-pointer text-left"
    >
      <div
        className={cn(
          "aspect-[3/4] overflow-hidden rounded-xl border bg-muted transition-shadow",
          over && "ring-2 ring-foreground/40",
        )}
      >
        {cover ? (
          <img
            src={mediaUrl.asset(asset.id, cover.file)}
            alt=""
            loading="lazy"
            draggable={false}
            className="size-full object-contain transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="grid size-full place-items-center text-muted-foreground">
            <Icon className="size-8" />
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <span className="min-w-0 truncate font-medium">{asset.name}</span>
        {members > 0 && (
          <span className="shrink-0 rounded-md bg-accent px-1.5 py-0.5 text-2xs">
            Gồm {members}
          </span>
        )}
      </div>
      <div className="flex gap-2 text-xs text-muted-foreground">
        <span className="truncate font-mono">@{asset.handle}</span>
        <span className="shrink-0">· {asset.images.length} ảnh</span>
      </div>
      {memberOf && (
        <div className="truncate text-2xs text-muted-foreground">Trong bộ: {memberOf}</div>
      )}
    </button>
  );
}

function EmptyKind({
  kind,
  onCreate,
  onImport,
}: {
  kind: AssetKind;
  onCreate: () => void;
  onImport?: () => void;
}) {
  const copy = ASSET_KINDS[kind];
  const Icon = copy.icon;
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-20 text-center">
      <div className="grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <div className="font-medium">Chưa có {copy.noun}</div>
      <p className="max-w-sm text-muted-foreground">{copy.emptyLibrary}</p>
      <div className="flex gap-2">
        {onImport && (
          <Button onClick={onImport}>
            <ImagePlus />
            Nhập nhiều ảnh
          </Button>
        )}
        <Button variant={onImport ? "outline" : "default"} onClick={onCreate}>
          <Plus />
          {copy.create}
        </Button>
      </div>
    </div>
  );
}
