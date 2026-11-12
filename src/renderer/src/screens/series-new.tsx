import type { StagedImage } from "@shared/ipc";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AssetDialog } from "@/components/asset-dialog";
import { SeriesAssetFields } from "@/components/asset-picker";
import { Composer } from "@/components/composer";
import { api } from "@/lib/api";
import { useDraft } from "@/lib/drafts";
import { errorMessage } from "@/lib/errors";
import { refreshWorkspace } from "@/lib/workspace";

/**
 * Create a series: one description plus the library assets it uses. Nothing is
 * saved until it is sent, so leaving this page leaves no empty series behind.
 */
export function SeriesNewPage() {
  const navigate = useNavigate();
  const [name, setName, clearName] = useDraft("series-new:name", "");
  const [guidance, setGuidance, clearGuidance] = useDraft("series-new:guidance", "");
  const [characterIds, setCharacterIds, clearCharacters] = useDraft<string[]>(
    "series-new:characters",
    [],
  );
  const [productIds, setProductIds, clearProducts] = useDraft<string[]>("series-new:products", []);
  const [environmentIds, setEnvironmentIds, clearEnvironments] = useDraft<string[]>(
    "series-new:environments",
    [],
  );
  // Images dropped on the composer open as a new environment, added to this series once saved.
  const [dropped, setDropped] = useState<StagedImage[] | null>(null);

  const dropImages = async (files: File[]) => {
    setError(null);
    try {
      const staged = await api.invoke("assets:stage-paths", api.pathsForFiles(files));
      if (staged.length === 0) setError("Chỉ nhận ảnh PNG, JPG hoặc WebP, tối đa 25 MB.");
      else setDropped(staged);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const series = await api.invoke("series:create", {
        name,
        guidance,
        characterIds,
        productIds,
        environmentIds,
      });
      await refreshWorkspace();
      for (const clear of [
        clearName,
        clearGuidance,
        clearCharacters,
        clearProducts,
        clearEnvironments,
      ])
        clear();
      await navigate({ to: "/series/$seriesId", params: { seriesId: series.id } });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-8 pt-8 pb-[18vh]">
      <h1 className="mb-6 text-center text-2xl font-semibold">Series mới</h1>
      <Composer
        value={guidance}
        onChange={setGuidance}
        onSubmit={create}
        busy={busy}
        rows={4}
        autoFocus
        placeholder="Mô tả series: nhân vật, bối cảnh, giọng điệu, cách nhắc đến sản phẩm…"
        submitLabel="Tạo series"
        onDropFiles={dropImages}
        dropHint="Thả ảnh để lưu thành bối cảnh"
        header={
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tên series (không bắt buộc)"
            aria-label="Tên series"
            className="block w-full border-b bg-transparent px-4 py-3 font-medium outline-none placeholder:font-normal placeholder:text-placeholder"
          />
        }
      >
        <div className="px-1.5 pb-0.5">
          <SeriesAssetFields
            value={{ characterIds, productIds, environmentIds }}
            onChange={(next) => {
              setCharacterIds(next.characterIds);
              setProductIds(next.productIds);
              setEnvironmentIds(next.environmentIds);
            }}
          />
        </div>
      </Composer>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        Kéo thả ảnh bối cảnh bạn thích vào đây để dùng làm tham chiếu.
      </p>
      {error && <p className="mt-3 text-destructive-foreground">{error}</p>}
      {dropped && (
        <AssetDialog
          kind="environment"
          open
          initialImages={dropped}
          onOpenChange={(open) => !open && setDropped(null)}
          onCreated={(asset) => setEnvironmentIds([...environmentIds, asset.id])}
        />
      )}
    </div>
  );
}
