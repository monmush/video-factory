import type { Asset, AssetKind, StagedImage } from "@shared/ipc";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Check, Plus } from "lucide-react";
import { type DragEvent, useState } from "react";
import characterPhoto from "@/assets/start/character.webp";
import placePhoto from "@/assets/start/place.webp";
import productPhoto from "@/assets/start/product.webp";
import { AssetDialog } from "@/components/asset-dialog";
import { AssetThumb } from "@/components/asset-picker";
import { ProductImportDialog } from "@/components/product-import-dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useDraft } from "@/lib/drafts";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

const TILES: { kind: AssetKind; label: string; hint: string }[] = [
  {
    kind: "product",
    label: "Sản phẩm",
    hint: "Ảnh sản phẩm thật",
  },
  {
    kind: "character",
    label: "Nhân vật",
    hint: "Người trong video",
  },
  {
    kind: "environment",
    label: "Bối cảnh",
    hint: "Không bắt buộc",
  },
];

const SUGGESTED_ORDER: AssetKind[] = ["product", "character"];
const CELLS_SHOWN = 3;

const STOCK_PHOTO: Record<AssetKind, { src: string; position: string }> = {
  product: { src: productPhoto, position: "object-[75%_45%]" },
  character: { src: characterPhoto, position: "object-[65%_30%]" },
  environment: { src: placePhoto, position: "object-[35%_60%]" },
};

const CELL_FIT: Record<AssetKind, string> = {
  product: "bg-background [&_img]:object-contain",
  character: "[&_img]:object-[50%_18%]",
  environment: "",
};

const INVALID_IMAGES = "Chỉ nhận ảnh PNG, JPG hoặc WebP, tối đa 25 MB.";

type Creating = { kind: AssetKind; images?: StagedImage[] };

export function StartPage() {
  const navigate = useNavigate();
  const assets = useWorkspace().assets;
  const [, setProducts] = useDraft<string[]>("series-new:products", []);
  const [, setCharacters] = useDraft<string[]>("series-new:characters", []);
  const [, setEnvironments] = useDraft<string[]>("series-new:environments", []);
  const [creating, setCreating] = useState<Creating | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const ofKind = (kind: AssetKind) => assets.filter((a) => a.kind === kind);
  const suggested = SUGGESTED_ORDER.find((kind) => ofKind(kind).length === 0) ?? null;

  const selectCreated = (kind: AssetKind, created: Asset[]) => {
    const ids = created.map((a) => a.id);
    const append = (current: string[]) => [
      ...current,
      ...ids.filter((id) => !current.includes(id)),
    ];
    if (kind === "product") setProducts(append);
    else if (kind === "character") setCharacters(append);
    else setEnvironments(append);
    setFresh((current) => new Set([...current, ...ids]));
  };

  const dropImages = async (kind: AssetKind, files: File[]) => {
    setError(null);
    try {
      const staged = await api.invoke("assets:stage-paths", api.pathsForFiles(files));
      if (staged.length === 0) setError(INVALID_IMAGES);
      else setCreating({ kind, images: staged });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const close = (open: boolean) => !open && setCreating(null);

  return (
    <div className="@container mx-auto flex min-h-full max-w-3xl flex-col justify-center px-8 pt-8 pb-[14vh]">
      <h1 className="mb-8 text-center text-2xl font-semibold text-balance">
        Chuẩn bị video đầu tiên
      </h1>
      <div className="grid grid-cols-1 gap-3 @xl:grid-cols-3">
        {TILES.map((tile) => (
          <StartTile
            key={tile.kind}
            kind={tile.kind}
            label={tile.label}
            hint={tile.hint}
            assets={ofKind(tile.kind)}
            fresh={fresh}
            suggested={suggested === tile.kind}
            onCreate={() => {
              setError(null);
              setCreating({ kind: tile.kind });
            }}
            onDropFiles={(files) => dropImages(tile.kind, files)}
          />
        ))}
      </div>
      {error && <p className="mt-3 text-center text-destructive-foreground">{error}</p>}
      <div className="mt-8 flex justify-center">
        <Button
          size="lg"
          variant={suggested ? "outline" : "default"}
          onClick={() => navigate({ to: "/series/new" })}
        >
          Tạo series
          <ArrowRight />
        </Button>
      </div>
      {creating?.kind === "product" ? (
        <ProductImportDialog
          open
          initialImages={creating.images}
          onOpenChange={close}
          onCreated={(created) => selectCreated("product", created)}
        />
      ) : (
        creating && (
          <AssetDialog
            kind={creating.kind}
            open
            initialImages={creating.images}
            onOpenChange={close}
            onCreated={(asset) => selectCreated(creating.kind, [asset])}
          />
        )
      )}
    </div>
  );
}

function StartTile({
  kind,
  label,
  hint,
  assets,
  fresh,
  suggested,
  onCreate,
  onDropFiles,
}: {
  kind: AssetKind;
  label: string;
  hint: string;
  assets: Asset[];
  fresh: Set<string>;
  suggested: boolean;
  onCreate: () => void;
  onDropFiles: (files: File[]) => void;
}) {
  const [over, setOver] = useState(false);
  const filled = assets.length > 0;
  const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");

  return (
    <button
      type="button"
      aria-label={`Thêm ${label.toLowerCase()}`}
      onClick={onCreate}
      onDragOver={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        setOver(false);
        onDropFiles([...event.dataTransfer.files]);
      }}
      className={cn(
        "group flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-card text-left outline-none transition-[border-color,background-color,box-shadow,scale] duration-200 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]",
        suggested && "border-primary shadow-xs ring-[3px] ring-primary/20",
        over && "border-foreground/40 bg-accent/50",
      )}
    >
      <span className="block h-32 w-full shrink-0 overflow-hidden @xl:aspect-[16/10] @xl:h-auto">
        {filled ? (
          <OwnCollage kind={kind} assets={assets} fresh={fresh} />
        ) : (
          <img
            src={STOCK_PHOTO[kind].src}
            alt=""
            draggable={false}
            className={cn(
              "size-full object-cover transition-[filter,opacity] duration-300 dark:brightness-[.85]",
              STOCK_PHOTO[kind].position,
              !suggested &&
                "opacity-80 saturate-50 group-hover:opacity-100 group-hover:saturate-100",
              over && "opacity-100 saturate-100",
            )}
          />
        )}
      </span>
      <span className="flex w-full items-end gap-3 p-4">
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center gap-1.5 font-medium">
            {label}
            {filled && <Check aria-label="Đã có" className="size-3.5 text-muted-foreground" />}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {filled ? assets.map((asset) => asset.name).join(", ") : hint}
          </span>
        </span>
        {!filled && (
          <span
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-full border transition-colors",
              suggested
                ? "border-primary text-primary"
                : "text-muted-foreground group-hover:text-foreground",
            )}
          >
            <Plus className="size-4" />
          </span>
        )}
      </span>
    </button>
  );
}

function OwnCollage({
  kind,
  assets,
  fresh,
}: {
  kind: AssetKind;
  assets: Asset[];
  fresh: Set<string>;
}) {
  const newestFirst = [...assets].reverse();
  const shown = newestFirst.slice(0, CELLS_SHOWN - 1);
  const overflow = assets.length - shown.length;
  const columns = shown.length + 1;

  return (
    <span
      className="grid size-full gap-1.5 bg-muted p-1.5 dark:bg-input/40"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {shown.map((asset) => (
        <AssetThumb
          key={asset.id}
          asset={asset}
          className={cn(
            "size-full rounded-[10px] border-0",
            CELL_FIT[kind],
            fresh.has(asset.id) &&
              "transition-[opacity,scale] duration-300 ease-out starting:scale-95 starting:opacity-0",
          )}
        />
      ))}
      <span className="flex flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-foreground/25 text-xs font-medium text-muted-foreground transition-colors group-hover:border-foreground/50 group-hover:text-foreground">
        <Plus className="size-4" />
        Thêm
        {overflow > 0 && <span className="tabular-nums">Đã có {assets.length}</span>}
      </span>
    </span>
  );
}
