import { cleanHandleInput, HANDLE_PATTERN, toHandle } from "@shared/handle";
import {
  type Asset,
  type BatchProductItem,
  MAX_CHARACTER_IMAGES,
  MAX_IMPORT_PHOTOS,
  type ProductGroupingResult,
  type StagedImage,
} from "@shared/ipc";
import { GripVertical, ImagePlus, LoaderCircle, Plus, Sparkles, X } from "lucide-react";
import { type DragEvent, type ReactNode, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { refreshWorkspace, useWorkspace } from "@/lib/workspace";
import { Button } from "./ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

// Batch product import. Photos are dropped in bulk, grouped into products by
// AI (or by hand), reviewed on a drag-and-drop board, then created together.
//   - drag a photo between products, into "Chưa xếp nhóm", "Bỏ qua" or "Sản phẩm mới"
//   - drag a product (by its handle) onto another to put it in that set; drag it
//     to "Tách khỏi bộ" to take it out again. Sets are one level deep.

const PHOTO = "x-hyan/photo";
const GROUP = "x-hyan/group";

interface Photo {
  key: string;
  url: string;
}

interface Group {
  key: string;
  name: string;
  handle: string;
  handleTouched: boolean;
  description: string;
  photos: string[];
  include: boolean;
  /** Key of the set this product belongs to. */
  parent: string | null;
  note?: string;
}

let nextKey = 0;
const newKey = () => `g${++nextKey}`;

const emptyGroup = (photos: string[] = []): Group => ({
  key: newKey(),
  name: "",
  handle: "",
  handleTouched: false,
  description: "",
  photos,
  include: true,
  parent: null,
});

export function ProductImportDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new products after they are created. */
  onCreated?: (assets: Asset[]) => void;
}) {
  // "busy": work in flight, closing waits. "dirty": photos added, closing asks first.
  const [guard, setGuard] = useState<"busy" | "dirty" | null>(null);
  const [closeRequests, setCloseRequests] = useState(0);
  const requestClose = (next: boolean) => {
    if (next) return onOpenChange(true);
    if (guard === "busy") return;
    if (guard === "dirty") return setCloseRequests((n) => n + 1);
    onOpenChange(false);
  };
  return (
    // Clicking outside never closes it: a stray click must not lose an import.
    <Dialog open={open} onOpenChange={requestClose} disablePointerDismissal>
      <DialogPopup className="h-[calc(100vh-3rem)] max-w-6xl" showCloseButton={guard !== "busy"}>
        {open && (
          <ImportBoard
            closeRequests={closeRequests}
            onGuardChange={setGuard}
            onCreated={onCreated}
            onDone={() => {
              setGuard(null);
              onOpenChange(false);
            }}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}

function ImportBoard({
  closeRequests,
  onGuardChange,
  onCreated,
  onDone,
}: {
  closeRequests: number;
  onGuardChange: (guard: "busy" | "dirty" | null) => void;
  onCreated?: (assets: Asset[]) => void;
  onDone: () => void;
}) {
  const workspace = useWorkspace();
  const [photos, setPhotos] = useState<Map<string, Photo>>(new Map());
  const [phase, setPhase] = useState<"pick" | "review">("pick");
  const [groups, setGroups] = useState<Group[]>([]);
  const [unassigned, setUnassigned] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<{ key: string; reason: string }[]>([]);
  const [grouping, setGrouping] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragKind, setDragKind] = useState<"photo" | "group" | null>(null);

  const busy = grouping || saving;
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirty = photos.size > 0;
  useEffect(
    () => onGuardChange(busy || adding ? "busy" : dirty ? "dirty" : null),
    [busy, adding, dirty, onGuardChange],
  );
  useEffect(() => {
    if (closeRequests > 0) setConfirmDiscard(true);
  }, [closeRequests]);
  const cancel = () => (dirty ? setConfirmDiscard(true) : onDone());

  // ---- adding photos -------------------------------------------------------

  const room = MAX_IMPORT_PHOTOS - photos.size;

  const addPhotos = (staged: StagedImage[], offered: number) => {
    const accepted = staged.slice(0, Math.max(0, room));
    const notes = [
      offered > staged.length ? `Bỏ qua ${offered - staged.length} tệp không phải ảnh.` : null,
      accepted.length < staged.length
        ? `Tối đa ${MAX_IMPORT_PHOTOS} ảnh mỗi lần nhập; đã bỏ bớt ảnh thừa.`
        : null,
    ].filter(Boolean);
    setNote(notes.length ? notes.join(" ") : null);
    setPhotos((current) => {
      const next = new Map(current);
      for (const s of accepted) next.set(s.id, { key: s.id, url: s.url });
      return next;
    });
    setUnassigned((current) => [...current, ...accepted.map((s) => s.id)]);
  };

  const withAdding = async (task: () => Promise<void>) => {
    setAdding(true);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(`Không thêm được ảnh: ${errorMessage(e)}`);
    } finally {
      setAdding(false);
    }
  };

  const pickPhotos = () =>
    withAdding(async () => {
      const staged = await api.invoke("assets:pick-images");
      addPhotos(staged, staged.length);
    });

  const dropFiles = (event: DragEvent) => {
    const files = [...event.dataTransfer.files];
    if (files.length === 0 || adding || busy || room <= 0) return false;
    const paths = api.pathsForFiles(files);
    if (paths.length) {
      void withAdding(async () =>
        addPhotos(await api.invoke("assets:stage-paths", paths), paths.length),
      );
    }
    return true;
  };

  // ---- AI grouping ---------------------------------------------------------

  const autoGroup = async () => {
    const keys = [...photos.keys()];
    setGrouping(true);
    setError(null);
    try {
      const result = await api.invoke("products:group", { stagedIds: keys });
      applyGrouping(result, keys);
      setPhase("review");
    } catch (e) {
      setError(`Không xếp nhóm được: ${errorMessage(e)}`);
    } finally {
      setGrouping(false);
    }
  };

  const applyGrouping = (result: ProductGroupingResult, keys: string[]) => {
    const made = result.products.map((p) => ({
      ...emptyGroup(p.images.map((i) => keys[i] as string)),
      name: p.name,
      handle: toHandle(p.name),
      description: p.description,
      note: p.note,
    }));
    result.products.forEach((p, i) => {
      for (const child of p.contains) {
        const target = made[child];
        if (target) target.parent = made[i]?.key ?? null;
      }
    });
    const placed = new Set([
      ...made.flatMap((g) => g.photos),
      ...result.skipped.map((s) => keys[s.image]),
    ]);
    setGroups(made);
    setSkipped(result.skipped.map((s) => ({ key: keys[s.image] as string, reason: s.reason })));
    setUnassigned(keys.filter((k) => !placed.has(k)));
    setNote(
      result.source === "fixture" ? "Chế độ thử: chưa gọi AI, mỗi ảnh là một sản phẩm." : null,
    );
  };

  // ---- editing groups ------------------------------------------------------

  const updateGroup = (key: string, patch: Partial<Group>) =>
    setGroups((current) => current.map((g) => (g.key === key ? { ...g, ...patch } : g)));

  /** Removes a photo from wherever it is now. */
  const detachPhoto = (photo: string) => {
    setGroups((current) =>
      current.map((g) => ({ ...g, photos: g.photos.filter((p) => p !== photo) })),
    );
    setUnassigned((current) => current.filter((p) => p !== photo));
    setSkipped((current) => current.filter((s) => s.key !== photo));
  };

  /** Takes a photo out of this import entirely. */
  const removePhoto = (photo: string) => {
    detachPhoto(photo);
    setPhotos((current) => {
      const next = new Map(current);
      next.delete(photo);
      return next;
    });
  };

  const removeButton = (key: string, label: string, onClick: () => void) => (
    // key keeps React happy when several buttons render in one list
    <span key={`remove-${key}`} className="contents">
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={onClick}
        className="absolute top-1 right-1 grid size-6 cursor-pointer place-items-center rounded-md bg-black/60 text-white opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    </span>
  );

  const movePhotoToGroup = (photo: string, groupKey: string) => {
    const target = groups.find((g) => g.key === groupKey);
    if (!target || target.photos.includes(photo)) return;
    if (target.photos.length >= MAX_CHARACTER_IMAGES) {
      setNote(`Mỗi sản phẩm tối đa ${MAX_CHARACTER_IMAGES} ảnh.`);
      return;
    }
    detachPhoto(photo);
    setGroups((current) =>
      current.map((g) => (g.key === groupKey ? { ...g, photos: [...g.photos, photo] } : g)),
    );
  };

  const movePhotoToNewGroup = (photo: string) => {
    detachPhoto(photo);
    setGroups((current) => [...current, emptyGroup([photo])]);
  };

  const unassignPhoto = (photo: string) => {
    detachPhoto(photo);
    setUnassigned((current) => [...current, photo]);
  };

  const skipPhoto = (photo: string) => {
    detachPhoto(photo);
    setSkipped((current) => [...current, { key: photo, reason: "Bỏ qua thủ công" }]);
  };

  const removeGroup = (key: string) => {
    const group = groups.find((g) => g.key === key);
    if (!group) return;
    setGroups((current) =>
      current
        .filter((g) => g.key !== key)
        .map((g) => (g.parent === key ? { ...g, parent: null } : g)),
    );
    setUnassigned((current) => [...current, ...group.photos]);
  };

  /** Puts `child` into the set `parentKey` (one level deep). */
  const nestGroup = (child: string, onto: string) => {
    if (child === onto) return;
    const target = groups.find((g) => g.key === onto);
    const dragged = groups.find((g) => g.key === child);
    if (!target || !dragged) return;
    const parentKey = target.parent ?? target.key;
    if (parentKey === child) return;
    if (groups.some((g) => g.parent === child)) {
      setNote("Một bộ không thể nằm trong bộ khác. Tách các sản phẩm của bộ này trước.");
      return;
    }
    updateGroup(child, { parent: parentKey });
  };

  // ---- drag and drop -------------------------------------------------------

  const startDrag = (event: DragEvent, kind: "photo" | "group", key: string) => {
    event.dataTransfer.setData(kind === "photo" ? PHOTO : GROUP, key);
    event.dataTransfer.effectAllowed = "move";
    setDragKind(kind);
  };

  const dropTarget = (handlers: {
    photo?: (key: string) => void;
    group?: (key: string) => void;
    files?: boolean;
  }) => ({
    onDragOver: (event: DragEvent) => {
      const types = event.dataTransfer.types;
      if (
        (handlers.photo && types.includes(PHOTO)) ||
        (handlers.group && types.includes(GROUP)) ||
        (handlers.files && types.includes("Files"))
      ) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setDragKind(null);
      const photo = event.dataTransfer.getData(PHOTO);
      const group = event.dataTransfer.getData(GROUP);
      if (photo && handlers.photo) handlers.photo(photo);
      else if (group && handlers.group) handlers.group(group);
      else if (handlers.files) dropFiles(event);
    },
  });

  // ---- validation and create -----------------------------------------------

  const included = groups.filter((g) => g.include);
  const takenHandles = new Set(workspace.assets.map((a) => a.handle));
  const problems = new Map<string, string>();
  for (const g of included) {
    const clash = included.some((o) => o !== g && o.handle === g.handle && g.handle);
    if (!g.name.trim()) problems.set(g.key, "Cần đặt tên");
    else if (g.photos.length === 0) problems.set(g.key, "Cần ít nhất một ảnh");
    else if (!HANDLE_PATTERN.test(g.handle)) problems.set(g.key, "Mã gắn thẻ không hợp lệ");
    else if (takenHandles.has(g.handle)) problems.set(g.key, `@${g.handle} đã có trong thư viện`);
    else if (clash) problems.set(g.key, `@${g.handle} bị trùng`);
  }
  const canCreate = included.length > 0 && problems.size === 0 && !busy && !adding;

  const create = async () => {
    setSaving(true);
    setError(null);
    const index = new Map(included.map((g, i) => [g.key, i]));
    const items: BatchProductItem[] = included.map((g) => ({
      input: {
        kind: "product",
        name: g.name,
        handle: g.handle,
        description: g.description,
        images: g.photos.map((id) => ({
          source: "staged" as const,
          id,
          origin: "upload" as const,
        })),
      },
      containsIndexes: included
        .filter((c) => c.parent === g.key)
        .map((c) => index.get(c.key))
        .filter((i): i is number => i !== undefined),
    }));
    try {
      const created = await api.invoke("assets:create-batch", items);
      await refreshWorkspace();
      onCreated?.(created);
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  };

  // ---- render --------------------------------------------------------------

  const thumb = (key: string, extra?: ReactNode) => {
    const photo = photos.get(key);
    if (!photo) return null;
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: pointer drag-and-drop on the review board; every item also has buttons
      <div
        key={key}
        draggable={!busy}
        onDragStart={(e) => startDrag(e, "photo", key)}
        onDragEnd={() => setDragKind(null)}
        className="group relative size-28 shrink-0 cursor-grab overflow-hidden rounded-lg border bg-background active:cursor-grabbing"
      >
        <img src={photo.url} alt="" className="size-full object-contain" draggable={false} />
        {extra}
      </div>
    );
  };

  const topLevel = groups.filter((g) => g.parent === null);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Nhập nhiều sản phẩm</DialogTitle>
      </DialogHeader>

      {phase === "pick" ? (
        <div
          className="m-4 flex min-h-0 flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-dashed bg-muted/50 p-6"
          {...dropTarget({ files: true })}
        >
          {photos.size === 0 ? (
            <div className="flex max-w-sm flex-col items-center gap-3 text-center">
              <div className="grid size-11 place-items-center rounded-xl bg-background text-muted-foreground shadow-xs">
                <ImagePlus className="size-5" />
              </div>
              <div className="font-medium">Thả ảnh sản phẩm vào đây</div>
              <p className="text-xs text-muted-foreground">Tối đa {MAX_IMPORT_PHOTOS} ảnh</p>
            </div>
          ) : (
            // Large previews so photos can be checked before grouping.
            <div className="grid max-h-full w-full grid-cols-[repeat(auto-fill,minmax(168px,1fr))] content-start gap-3 overflow-y-auto">
              {[...photos.values()].map((photo) => (
                <div
                  key={photo.key}
                  className="group relative aspect-[3/4] overflow-hidden rounded-lg border bg-background"
                >
                  <img
                    src={photo.url}
                    alt=""
                    className="size-full object-contain"
                    draggable={false}
                  />
                  {removeButton(photo.key, "Bỏ ảnh này", () => removePhoto(photo.key))}
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button variant="outline" disabled={adding || busy || room <= 0} onClick={pickPhotos}>
              {adding ? <LoaderCircle className="animate-spin" /> : <ImagePlus />}
              {photos.size ? `Thêm ảnh (${photos.size}/${MAX_IMPORT_PHOTOS})` : "Chọn ảnh"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_260px] overflow-hidden">
          {/* Products, with set members nested under their set. */}
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
            {dragKind === "group" && (
              <DropZone
                label="Thả vào đây để tách khỏi bộ"
                {...dropTarget({ group: (key) => updateGroup(key, { parent: null }) })}
              />
            )}
            {topLevel.map((group) => (
              <div key={group.key} className="flex flex-col gap-2">
                <GroupRow
                  group={group}
                  problem={group.include ? problems.get(group.key) : undefined}
                  busy={busy}
                  thumb={thumb}
                  onChange={(patch) => updateGroup(group.key, patch)}
                  onRemove={() => removeGroup(group.key)}
                  onDragStart={(e) => startDrag(e, "group", group.key)}
                  onDragEnd={() => setDragKind(null)}
                  dropProps={dropTarget({
                    photo: (p) => movePhotoToGroup(p, group.key),
                    group: (g) => nestGroup(g, group.key),
                  })}
                  onPhotoOut={unassignPhoto}
                />
                {groups
                  .filter((g) => g.parent === group.key)
                  .map((child) => (
                    <div key={child.key} className="ml-8 border-l-2 pl-3">
                      <GroupRow
                        group={child}
                        problem={child.include ? problems.get(child.key) : undefined}
                        busy={busy}
                        thumb={thumb}
                        onChange={(patch) => updateGroup(child.key, patch)}
                        onRemove={() => removeGroup(child.key)}
                        onDragStart={(e) => startDrag(e, "group", child.key)}
                        onDragEnd={() => setDragKind(null)}
                        dropProps={dropTarget({
                          photo: (p) => movePhotoToGroup(p, child.key),
                          group: (g) => nestGroup(g, child.key),
                        })}
                        onPhotoOut={unassignPhoto}
                      />
                    </div>
                  ))}
              </div>
            ))}
            <button
              type="button"
              disabled={busy}
              onClick={() => setGroups((current) => [...current, emptyGroup()])}
              {...dropTarget({ photo: movePhotoToNewGroup })}
              className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed py-4 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            >
              <Plus className="size-4" />
              Sản phẩm mới
            </button>
          </div>

          {/* Trays: photos not in any product yet, and photos set aside. */}
          <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto border-l p-4">
            <Tray title="Chưa xếp nhóm" {...dropTarget({ photo: unassignPhoto, files: true })}>
              {unassigned.map((key) =>
                thumb(
                  key,
                  removeButton(key, "Bỏ ảnh khỏi lần nhập", () => removePhoto(key)),
                ),
              )}
              {room > 0 && (
                <button
                  type="button"
                  disabled={adding || busy}
                  onClick={pickPhotos}
                  className="grid size-20 cursor-pointer place-items-center rounded-lg border border-dashed text-muted-foreground hover:bg-accent/50"
                  aria-label="Thêm ảnh"
                  title="Thêm ảnh"
                >
                  {adding ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <ImagePlus className="size-4" />
                  )}
                </button>
              )}
            </Tray>
            <Tray title="Bỏ qua" {...dropTarget({ photo: skipPhoto })}>
              {skipped.map((s) =>
                thumb(
                  s.key,
                  <>
                    <span
                      className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-0.5 text-2xs text-white"
                      title={s.reason}
                    >
                      {s.reason}
                    </span>
                    {removeButton(s.key, "Bỏ ảnh khỏi lần nhập", () => removePhoto(s.key))}
                  </>,
                ),
              )}
            </Tray>
          </aside>
        </div>
      )}

      {(note || error) && (
        <p
          className={cn(
            "border-t px-5 py-2 text-xs",
            error ? "bg-destructive-surface text-destructive-foreground" : "text-muted-foreground",
          )}
        >
          {error ?? note}
        </p>
      )}

      {confirmDiscard && dirty && !busy ? (
        <DialogFooter className="bg-warning-surface">
          <span className="flex-1 text-warning-foreground">
            Đóng sẽ bỏ {photos.size} ảnh và cách xếp nhóm hiện tại. Chưa có sản phẩm nào được tạo.
          </span>
          <Button variant="outline" onClick={() => setConfirmDiscard(false)}>
            Ở lại
          </Button>
          <Button variant="ghost-muted" onClick={onDone}>
            Bỏ và đóng
          </Button>
        </DialogFooter>
      ) : (
        <DialogFooter>
          {phase === "pick" ? (
            <>
              <span className="flex-1" />
              <Button
                variant="ghost-muted"
                disabled={photos.size === 0 || busy || adding}
                onClick={() => {
                  setNote(null);
                  setPhase("review");
                }}
              >
                Tự xếp nhóm
              </Button>
              <Button disabled={photos.size === 0 || busy || adding} onClick={autoGroup}>
                {grouping ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
                {grouping ? "Đang xếp nhóm…" : "Xếp nhóm tự động"}
              </Button>
            </>
          ) : (
            <>
              <span className="flex-1 text-xs text-muted-foreground">
                {problems.size > 0 ? `${problems.size} sản phẩm cần sửa` : null}
              </span>
              <Button variant="outline" disabled={busy} onClick={cancel}>
                Hủy
              </Button>
              <Button disabled={!canCreate} onClick={create}>
                {saving && <LoaderCircle className="animate-spin" />}
                Tạo {included.length} sản phẩm
              </Button>
            </>
          )}
        </DialogFooter>
      )}
    </>
  );
}

function GroupRow({
  group,
  problem,
  busy,
  thumb,
  onChange,
  onRemove,
  onDragStart,
  onDragEnd,
  dropProps,
  onPhotoOut,
}: {
  group: Group;
  problem?: string;
  busy: boolean;
  thumb: (key: string, extra?: ReactNode) => ReactNode;
  onChange: (patch: Partial<Group>) => void;
  onRemove: () => void;
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
  dropProps: { onDragOver: (e: DragEvent) => void; onDrop: (e: DragEvent) => void };
  onPhotoOut: (photo: string) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: pointer drag-and-drop on the review board; every item also has buttons
    <div
      className={cn(
        "flex gap-3 rounded-xl border bg-card p-3 transition-colors",
        over && "border-foreground/40 bg-accent",
        !group.include && "opacity-60",
      )}
      onDragOver={(e) => {
        dropProps.onDragOver(e);
        if (e.defaultPrevented) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        dropProps.onDrop(e);
      }}
    >
      <div className="flex flex-col items-center gap-2 pt-1">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer drag-and-drop on the review board; every item also has buttons */}
        <span
          draggable={!busy}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          className="cursor-grab text-muted-foreground active:cursor-grabbing"
          title="Kéo vào sản phẩm khác để ghép thành bộ"
        >
          <GripVertical className="size-4" />
        </span>
        <input
          type="checkbox"
          aria-label="Tạo sản phẩm này"
          checked={group.include}
          onChange={(e) => onChange({ include: e.target.checked })}
          className="size-4 cursor-pointer accent-foreground"
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <Input
            size="sm"
            className="max-w-72"
            value={group.name}
            placeholder="Tên sản phẩm"
            onValueChange={(name) =>
              onChange(group.handleTouched ? { name } : { name, handle: toHandle(name) })
            }
          />
          <Input
            size="sm"
            className="max-w-48 [&_input]:font-mono"
            value={group.handle ? `@${group.handle}` : ""}
            placeholder="@ma-gan-the"
            onValueChange={(value) =>
              onChange({ handle: cleanHandleInput(value), handleTouched: true })
            }
          />
          <span className="flex-1" />
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label="Bỏ nhóm này"
            title="Bỏ nhóm"
            disabled={busy}
            onClick={onRemove}
          >
            <X />
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {group.photos.map((key) =>
            thumb(
              key,
              <button
                type="button"
                aria-label="Bỏ ảnh khỏi sản phẩm"
                title="Bỏ ảnh khỏi sản phẩm"
                onClick={() => onPhotoOut(key)}
                className="absolute top-1 right-1 grid size-6 cursor-pointer place-items-center rounded-md bg-black/60 text-white opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
              >
                <X className="size-3.5" />
              </button>,
            ),
          )}
          {group.photos.length === 0 && (
            <div className="grid h-20 flex-1 place-items-center rounded-lg border border-dashed text-xs text-muted-foreground">
              Thả ảnh vào đây
            </div>
          )}
        </div>

        <Textarea
          value={group.description}
          placeholder="Mô tả"
          onChange={(e) => onChange({ description: e.target.value })}
          // Grows with its text so the whole description is readable without scrolling.
          className="min-h-20 [field-sizing:content]"
        />

        {(problem || group.note) && (
          <p
            className={cn(
              "text-xs",
              problem ? "text-destructive-foreground" : "text-warning-foreground",
            )}
          >
            {problem ?? group.note}
          </p>
        )}
      </div>
    </div>
  );
}

function Tray({
  title,
  children,
  onDragOver,
  onDrop,
}: {
  title: string;
  children: ReactNode;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: pointer drag-and-drop on the review board; every item also has buttons
    <section
      className={cn("flex flex-col gap-2 rounded-xl border border-dashed p-3", over && "bg-accent")}
      onDragOver={(e) => {
        onDragOver(e);
        if (e.defaultPrevented) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        onDrop(e);
      }}
    >
      <div className="font-medium">{title}</div>
      <div className="flex min-h-20 flex-wrap gap-2">{children}</div>
    </section>
  );
}

function DropZone({
  label,
  onDragOver,
  onDrop,
}: {
  label: string;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: pointer drag-and-drop on the review board; every item also has buttons
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="grid place-items-center rounded-xl border border-dashed py-3 text-xs text-muted-foreground"
    >
      {label}
    </div>
  );
}
