import { formatCost } from "@shared/credits";
import { cleanHandleInput, HANDLE_PATTERN, toHandle } from "@shared/handle";
import {
  type AngleId,
  type Asset,
  type AssetKind,
  type CoreAngle,
  type GenerateAnglesResult,
  type ImageOrigin,
  type ImageRef,
  MAX_CHARACTER_IMAGES,
  mediaUrl,
  type PlaceFinding,
  type StagedImage,
} from "@shared/ipc";
import { findingLabel, isFlagged } from "@shared/place-check";
import {
  guessVoiceTraits,
  suggestVoice,
  takenVoiceIds,
  type VoiceId,
  voiceById,
} from "@shared/voices";
import { ImagePlus, LoaderCircle, Sparkles, Star, TriangleAlert, Upload, X } from "lucide-react";
import { type DragEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { ASSET_KINDS } from "@/lib/asset-kinds";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { refreshWorkspace, useWorkspace } from "@/lib/workspace";
import { ANGLE_LABELS, AngleGenerator, PendingAngleTile } from "./angle-generator";
import { Button } from "./ui/button";
import { Dialog, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from "./ui/dialog";
import { ButtonPrice, HoldButton } from "./ui/hold-button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { VoiceField } from "./voice-field";

interface DraftImage {
  key: string;
  ref: ImageRef;
  url: string;
  origin: ImageOrigin;
  angle?: AngleId;
  /**
   * Places: what the check found (src/shared/place-check.ts); null when
   * nothing was or it could not run; missing until asked.
   */
  check?: PlaceFinding | null;
  /** Places: a cleaned photo's original, which "Dùng ảnh gốc" brings back. */
  original?: DraftImage;
}

const fromStaged = (
  s: StagedImage,
  origin: ImageOrigin = "upload",
  angle?: AngleId,
): DraftImage => ({
  key: s.id,
  ref: { source: "staged", id: s.id },
  url: s.url,
  origin,
  angle,
});

const fromAsset = (asset: Asset): DraftImage[] =>
  asset.images.map((img) => ({
    key: img.id,
    ref: { source: "asset", assetId: asset.id, id: img.id },
    url: mediaUrl.asset(asset.id, img.file),
    origin: img.origin ?? "upload",
    angle: img.angle,
    check: img.placeCheck,
    original: img.original && {
      key: img.id,
      ref: { source: "asset", assetId: asset.id, id: img.id, restore: true },
      url: mediaUrl.asset(asset.id, img.original.file),
      origin: img.original.origin ?? "upload",
      angle: img.angle,
      check: img.original.placeCheck ?? null,
    },
  }));

/** The ref sent on save, carrying the image's label and origin. */
const toRef = (image: DraftImage): ImageRef =>
  image.ref.source === "staged"
    ? { ...image.ref, origin: image.origin, angle: image.angle }
    : { ...image.ref, angle: image.angle };

/**
 * Create or edit a library asset (character or product): reference images, a
 * name, an @handle for prompts and a visual description (optionally written by
 * AI from the images). Kind-specific wording and rules live in ASSET_KINDS.
 */
export function AssetDialog({
  open,
  onOpenChange,
  kind,
  asset,
  onCreated,
  initialImages,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: AssetKind;
  /** Edit this asset; omit to create a new one. */
  asset?: Asset;
  /** Called with the new asset after a create (not after an edit). */
  onCreated?: (asset: Asset) => void;
  /** Create only: images already staged elsewhere, shown when the dialog opens. */
  initialImages?: StagedImage[];
}) {
  // The form reports whether closing must wait (work in flight) or needs a
  // confirmation (unsaved AI images, which cost money). X and Escape go through here.
  const [guard, setGuard] = useState<CloseGuard>(null);
  const [closeRequests, setCloseRequests] = useState(0);

  const requestClose = (next: boolean) => {
    if (next) return onOpenChange(true);
    if (guard === "busy") return;
    if (guard === "unsaved-ai") return setCloseRequests((n) => n + 1);
    onOpenChange(false);
  };

  return (
    // Clicking outside never closes it: a stray click must not lose edits.
    <Dialog open={open} onOpenChange={requestClose} disablePointerDismissal>
      <DialogPopup className="max-w-4xl" showCloseButton={guard !== "busy"}>
        {/* Remount per open so every opening starts from the saved state. */}
        {open && (
          <CharacterForm
            kind={asset?.kind ?? kind}
            character={asset}
            closeRequests={closeRequests}
            onGuardChange={setGuard}
            onCreated={onCreated}
            initialImages={initialImages}
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

type CloseGuard = "busy" | "unsaved-ai" | null;

function CharacterForm({
  kind,
  character,
  closeRequests,
  onGuardChange,
  onCreated,
  initialImages,
  onDone,
}: {
  kind: AssetKind;
  character?: Asset;
  onCreated?: (asset: Asset) => void;
  initialImages?: StagedImage[];
  /** Increments when the user tries to close while unsaved AI images exist. */
  closeRequests: number;
  onGuardChange: (guard: CloseGuard) => void;
  onDone: () => void;
}) {
  const workspace = useWorkspace();
  const copy = ASSET_KINDS[kind];
  const [images, setImages] = useState<DraftImage[]>(() =>
    character
      ? fromAsset(character)
      : (initialImages ?? []).slice(0, MAX_CHARACTER_IMAGES).map((s) => fromStaged(s)),
  );
  const [name, setName] = useState(character?.name ?? "");
  const [handle, setHandle] = useState(character?.handle ?? "");
  const [handleTouched, setHandleTouched] = useState(Boolean(character));
  const [description, setDescription] = useState(character?.description ?? "");
  const [previousDescription, setPreviousDescription] = useState<string | null>(null);
  // The text as last rendered, read after the describe call returns.
  const latestDescription = useRef(description);
  latestDescription.current = description;
  const [describing, setDescribing] = useState(false);
  const [describeNote, setDescribeNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAngles, setPendingAngles] = useState<CoreAngle[]>([]);
  const [angleNote, setAngleNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Places: photos being checked, the one being cleaned, and a cleaned
  // version waiting for "Dùng ảnh này" or "Bỏ".
  const isPlace = kind === "environment";
  const asked = useRef(new Set<string>());
  const [checking, setChecking] = useState<Set<string>>(new Set());
  const [cleaning, setCleaning] = useState<string | null>(null);
  const [review, setReview] = useState<{
    key: string;
    image: StagedImage;
    check: PlaceFinding | null;
  } | null>(null);
  const [cleanPrice, setCleanPrice] = useState<number | null>(null);
  // Products only: the set this product is (members) and the set it belongs to.
  const [contains, setContains] = useState<string[]>(character?.contains ?? []);
  const members = contains
    .map((id) => workspace.assets.find((a) => a.id === id))
    .filter((a): a is Asset => Boolean(a));
  const memberOf = character
    ? workspace.assets.find((a) => a.contains?.includes(character.id))
    : undefined;
  // Characters only: a voice picked by hand (or saved) is kept; until then the
  // rule suggests one from the name and description, avoiding voices in use.
  const [pickedVoice, setPickedVoice] = useState<VoiceId | null>(
    voiceById(character?.voiceId)?.id ?? null,
  );
  const voiceId =
    pickedVoice ??
    suggestVoice(
      guessVoiceTraits(name, description),
      takenVoiceIds(workspace.assets, character?.id),
    );

  // How the dialog's actions interact: only one change to the image list at a
  // time, and nothing that would lose in-flight (possibly paid) work.
  const generating = pendingAngles.length > 0;
  const inFlight = describing || generating || saving || cleaning !== null;
  const busy = inFlight || adding || review !== null;
  const unsavedAi =
    review !== null || images.some((i) => i.origin === "ai" && i.ref.source === "staged");
  const anyFlagged = isPlace && images.some((i) => isFlagged(i.check));

  // Places: every photo not checked yet is looked at once (free; nothing waits for it).
  useEffect(() => {
    if (!isPlace) return;
    const todo = images.filter((i) => i.check === undefined && !asked.current.has(i.key));
    if (!todo.length) return;
    for (const image of todo) asked.current.add(image.key);
    const keys = todo.map((i) => i.key);
    setChecking((current) => new Set([...current, ...keys]));
    api
      .invoke("assets:check-place", { images: todo.map((i) => i.ref) })
      .catch(() => todo.map(() => null))
      .then((found) =>
        setImages((current) =>
          current.map((image) => {
            const at = keys.indexOf(image.key);
            return at < 0 || image.check !== undefined
              ? image
              : { ...image, check: found[at] ?? null };
          }),
        ),
      )
      .finally(() =>
        setChecking((current) => new Set([...current].filter((key) => !keys.includes(key)))),
      );
  }, [images, isPlace]);

  useEffect(() => {
    if (!anyFlagged || cleanPrice !== null) return;
    api
      .invoke("assets:estimate-clean")
      .then((r) => setCleanPrice(r.cost))
      .catch(() => undefined);
  }, [anyFlagged, cleanPrice]);

  const clean = async (key: string) => {
    const target = images.find((i) => i.key === key);
    if (!target || !isFlagged(target.check)) return;
    setCleaning(key);
    setError(null);
    setAngleNote(null);
    try {
      const result = await api.invoke("assets:clean-place-photo", {
        image: target.ref,
        finding: target.check,
      });
      setReview({ key, image: result.image, check: result.finding });
      setAngleNote(
        result.source === "fixture"
          ? "Chế độ thử: ảnh mẫu là bản sao ảnh gốc, chưa gọi API."
          : result.cost !== null
            ? `Đã dùng khoảng ${formatCost(result.cost)}.`
            : null,
      );
    } catch (e) {
      setError(`Không làm sạch được ảnh: ${errorMessage(e)}`);
    } finally {
      setCleaning(null);
    }
  };

  /** The cleaned photo takes the original's place; the original can come back until and after saving. */
  const acceptCleaned = () => {
    if (!review) return;
    setImages((current) =>
      current.map((image) =>
        image.key === review.key
          ? {
              key: review.image.id,
              ref: { source: "staged", id: review.image.id, cleanOf: toRef(image) },
              url: review.image.url,
              origin: "ai",
              angle: image.angle,
              check: review.check ?? null,
              original: image,
            }
          : image,
      ),
    );
    setReview(null);
    setAngleNote(null);
  };

  const restoreOriginal = (key: string) =>
    setImages((current) =>
      current.map((image) => (image.key === key && image.original ? image.original : image)),
    );

  const reviewed = review && images.find((i) => i.key === review.key);

  useEffect(() => {
    onGuardChange(inFlight ? "busy" : unsavedAi ? "unsaved-ai" : null);
  }, [inFlight, unsavedAi, onGuardChange]);

  useEffect(() => {
    if (closeRequests > 0) setConfirmDiscard(true);
  }, [closeRequests]);

  const cancel = () => {
    if (unsavedAi && !confirmDiscard) setConfirmDiscard(true);
    else onDone();
  };

  const setAngle = (key: string, angle: AngleId | undefined) =>
    setImages((current) => current.map((i) => (i.key === key ? { ...i, angle } : i)));

  const onAnglesResult = (result: GenerateAnglesResult | null, message?: string) => {
    setPendingAngles([]);
    if (!result) {
      setError(`Không tạo được góc nhìn: ${message}`);
      return;
    }
    setImages((current) => [
      ...current,
      ...result.images.map((img) => fromStaged(img, "ai", img.angle)),
    ]);
    const failed = result.failed.map((f) => ANGLE_LABELS[f.angle]).join(", ");
    setAngleNote(
      [
        result.source === "fixture"
          ? "Chế độ thử: ảnh mẫu là bản sao ảnh gốc, chưa gọi API."
          : result.cost !== null
            ? `Đã dùng khoảng ${formatCost(result.cost)} trên fal.`
            : null,
        failed ? `Không tạo được: ${failed}.` : null,
        result.images.length ? "Bỏ ảnh nào chưa đạt trước khi lưu." : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
  };

  useEffect(() => {
    if (!handleTouched) setHandle(toHandle(name));
  }, [name, handleTouched]);

  const handleTaken = workspace.assets.some((a) => a.handle === handle && a.id !== character?.id);
  const handleError = !handle
    ? null
    : !HANDLE_PATTERN.test(handle)
      ? "Chỉ dùng chữ thường không dấu, số và dấu gạch ngang."
      : handleTaken
        ? `@${handle} đã được dùng trong thư viện.`
        : null;
  const canSave = name.trim().length > 0 && handle.length > 0 && !handleError && !busy;

  // Slots left under the per-character limit, counting images still generating.
  const freeSlots = Math.max(0, MAX_CHARACTER_IMAGES - images.length - pendingAngles.length);

  const canAdd = !adding && !saving && freeSlots > 0;

  /** Adds staged images up to the limit and explains anything left out. */
  const addStaged = (staged: StagedImage[], offered: number) => {
    const accepted = staged.slice(0, freeSlots);
    const notes = [
      offered > staged.length
        ? `Bỏ qua ${offered - staged.length} tệp không phải ảnh PNG, JPG, WebP hoặc quá 25 MB.`
        : null,
      accepted.length < staged.length
        ? `Mỗi ${copy.noun} tối đa ${MAX_CHARACTER_IMAGES} ảnh; đã bỏ bớt ảnh thừa.`
        : null,
    ].filter(Boolean);
    setAngleNote(notes.length ? notes.join(" ") : null);
    setImages((current) => [...current, ...accepted.map((s) => fromStaged(s))]);
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

  const pickImages = () =>
    withAdding(async () => {
      const staged = await api.invoke("assets:pick-images");
      addStaged(staged, staged.length);
    });

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (!canAdd) return;
    const paths = api.pathsForFiles([...event.dataTransfer.files]);
    if (paths.length === 0) return;
    void withAdding(async () =>
      addStaged(await api.invoke("assets:stage-paths", paths), paths.length),
    );
  };

  const makeCover = (key: string) =>
    setImages((current) => {
      const picked = current.find((i) => i.key === key);
      return picked ? [picked, ...current.filter((i) => i.key !== key)] : current;
    });

  const describe = async () => {
    const before = description;
    setDescribing(true);
    setError(null);
    try {
      const result = await api.invoke("assets:describe", {
        kind,
        name,
        images: images.map((i) => i.ref),
      });
      // Text typed while the call ran wins over the generated one.
      if (latestDescription.current === before) {
        setPreviousDescription(before);
        setDescription(result.description);
      }
      setDescribeNote(
        result.source === "fixture"
          ? "Chế độ thử: đây là mô tả mẫu, chưa gọi API."
          : result.source === "claude-code"
            ? "Viết bằng Claude trên máy này, tính vào gói Claude của bạn."
            : result.cost !== null
              ? `Đã dùng ${formatCost(result.cost)} trên fal.`
              : null,
      );
    } catch (e) {
      setError(`Không tạo được mô tả: ${errorMessage(e)}`);
    } finally {
      setDescribing(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const input = {
      kind,
      name,
      handle,
      description,
      images: images.map(toRef),
      contains: kind === "product" ? contains : undefined,
      voiceId: kind === "character" ? voiceId : undefined,
    };
    try {
      if (character) await api.invoke("assets:update", character.id, input);
      else {
        const created = await api.invoke("assets:create", input);
        await refreshWorkspace();
        onCreated?.(created);
      }
      await refreshWorkspace();
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!character) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setError(null);
    try {
      await api.invoke("assets:delete", character.id);
      await refreshWorkspace();
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setConfirmDelete(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{character ? copy.titleEdit : copy.titleNew}</DialogTitle>
      </DialogHeader>

      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_340px] overflow-y-auto">
        {/* Reference images: drop anywhere in this panel. */}
        <section
          aria-label="Ảnh tham chiếu"
          className={cn(
            "m-3 mr-0 flex min-h-[440px] flex-col rounded-xl border border-dashed bg-muted/50 transition-colors",
            dragging && "border-ring bg-accent",
          )}
          onDragOver={(e) => {
            e.preventDefault();
            if (canAdd) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          {images.length === 0 ? (
            <div className="m-auto flex max-w-xs flex-col items-center gap-3 p-6 text-center">
              <div className="grid size-11 place-items-center rounded-xl bg-background text-muted-foreground shadow-xs">
                <ImagePlus className="size-5" />
              </div>
              <div className="font-medium">Thêm ảnh tham chiếu</div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {copy.emptyImagesHint}
              </p>
              <Button variant="outline" disabled={!canAdd} onClick={pickImages}>
                {adding ? <LoaderCircle className="animate-spin" /> : <Upload />}
                {adding ? "Đang thêm ảnh…" : "Tải ảnh lên"}
              </Button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 p-3">
                {images.map((image, index) => (
                  <div key={image.key} className="flex flex-col gap-1.5">
                    <figure className="group relative aspect-[3/4] overflow-hidden rounded-lg bg-background">
                      <img
                        src={image.url}
                        alt=""
                        className="size-full object-contain"
                        draggable={false}
                      />
                      {image.origin === "ai" && (
                        <span
                          className="absolute top-2 left-2 rounded-md bg-black/60 px-1.5 py-0.5 text-2xs font-medium text-white"
                          title="Ảnh tạo bằng AI từ ảnh gốc"
                        >
                          AI
                        </span>
                      )}
                      {checking.has(image.key) ? (
                        <span className="absolute right-2 bottom-2 grid size-5 place-items-center rounded-md bg-black/60 text-white">
                          <LoaderCircle className="size-3 animate-spin" />
                        </span>
                      ) : (
                        isFlagged(image.check) && (
                          <span
                            className="absolute right-2 bottom-2 grid size-5 place-items-center rounded-md bg-warning-surface text-warning-foreground"
                            title={findingLabel(image.check) ?? undefined}
                          >
                            <TriangleAlert className="size-3" />
                          </span>
                        )
                      )}
                      {cleaning === image.key && (
                        <span className="absolute inset-0 grid place-items-center bg-background/60">
                          <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
                        </span>
                      )}
                      {index === 0 ? (
                        <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-1.5 py-0.5 text-2xs text-white">
                          Ảnh chính
                        </span>
                      ) : (
                        <Button
                          size="xs"
                          variant="secondary"
                          className="absolute bottom-2 left-2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                          onClick={() => makeCover(image.key)}
                        >
                          <Star />
                          Đặt làm ảnh chính
                        </Button>
                      )}
                      <Button
                        size="icon-xs"
                        variant="secondary"
                        aria-label="Bỏ ảnh"
                        title="Bỏ ảnh"
                        className="absolute top-2 right-2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                        onClick={() => {
                          if (review?.key === image.key) setReview(null);
                          setImages((c) => c.filter((i) => i.key !== image.key));
                        }}
                      >
                        <X />
                      </Button>
                    </figure>
                    {copy.views.length > 0 && (
                      <select
                        aria-label="Góc chụp"
                        value={image.angle ?? ""}
                        onChange={(e) =>
                          setAngle(image.key, (e.target.value || undefined) as AngleId | undefined)
                        }
                        className={cn(
                          "w-full cursor-pointer rounded-md bg-transparent px-1 py-0.5 text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                          image.angle ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        <option value="">Chưa gắn góc</option>
                        {copy.views.map((a) => (
                          <option key={a} value={a}>
                            {ANGLE_LABELS[a]}
                          </option>
                        ))}
                      </select>
                    )}
                    {isPlace && isFlagged(image.check) && (
                      <>
                        <p className="text-xs text-warning-foreground">
                          {findingLabel(image.check)}
                        </p>
                        {review?.key !== image.key && (
                          <HoldButton
                            size="xs"
                            tone="outline"
                            className="self-start"
                            disabled={busy || cleaning !== null}
                            onHold={() => clean(image.key)}
                          >
                            Giữ để làm sạch
                            {cleanPrice !== null && (
                              <ButtonPrice>~{formatCost(cleanPrice)}</ButtonPrice>
                            )}
                          </HoldButton>
                        )}
                      </>
                    )}
                    {image.original && review?.key !== image.key && (
                      <Button
                        size="xs"
                        variant="ghost-muted"
                        className="self-start"
                        disabled={busy}
                        onClick={() => restoreOriginal(image.key)}
                      >
                        Dùng ảnh gốc
                      </Button>
                    )}
                  </div>
                ))}
                {pendingAngles.map((angle) => (
                  <PendingAngleTile key={`pending-${angle}`} angle={angle} />
                ))}
                {freeSlots > 0 && (
                  <button
                    type="button"
                    disabled={!canAdd}
                    onClick={pickImages}
                    className="flex aspect-[3/4] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-muted-foreground hover:bg-background hover:text-foreground disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
                  >
                    {adding ? (
                      <LoaderCircle className="size-5 animate-spin" />
                    ) : (
                      <ImagePlus className="size-5" />
                    )}
                    <span className="text-xs">{adding ? "Đang thêm…" : "Thêm ảnh"}</span>
                    <span className="text-2xs">
                      {images.length + pendingAngles.length}/{MAX_CHARACTER_IMAGES}
                    </span>
                  </button>
                )}
              </div>

              {review && reviewed && (
                <div className="mx-3 mb-3 flex flex-col gap-2 rounded-lg border bg-background p-2">
                  <div className="grid grid-cols-2 gap-2">
                    <img
                      src={reviewed.url}
                      alt=""
                      className="aspect-[4/3] w-full rounded-md bg-muted object-contain"
                      draggable={false}
                    />
                    <figure className="relative">
                      <img
                        src={review.image.url}
                        alt=""
                        className="aspect-[4/3] w-full rounded-md bg-muted object-contain"
                        draggable={false}
                      />
                      <span className="absolute top-2 left-2 rounded-md bg-black/60 px-1.5 py-0.5 text-2xs font-medium text-white">
                        AI
                      </span>
                    </figure>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 text-xs text-warning-foreground">
                      {findingLabel(review.check)}
                    </span>
                    <Button variant="ghost-muted" size="sm" onClick={() => setReview(null)}>
                      Bỏ
                    </Button>
                    <Button size="sm" onClick={acceptCleaned}>
                      Dùng ảnh này
                    </Button>
                  </div>
                </div>
              )}

              <div className="mt-auto flex flex-col items-start gap-2 p-3 pt-0">
                {copy.generateViews && (
                  <AngleGenerator
                    references={images.filter((i) => i.origin === "upload").map(toRef)}
                    covered={new Set(images.flatMap((i) => (i.angle ? [i.angle] : [])))}
                    description={description}
                    disabled={generating || adding || saving}
                    maxNew={freeSlots}
                    onStart={(angles) => {
                      setAngleNote(null);
                      setError(null);
                      setPendingAngles(angles);
                    }}
                    onResult={onAnglesResult}
                  />
                )}
                {angleNote && <p className="text-xs text-muted-foreground">{angleNote}</p>}
              </div>
            </>
          )}
        </section>

        <div className="flex flex-col gap-5 p-5">
          <Field label="Tên" htmlFor="character-name">
            <Input
              id="character-name"
              value={name}
              onValueChange={setName}
              placeholder={copy.namePlaceholder}
              autoFocus
            />
          </Field>

          <Field
            label="Mã gắn thẻ"
            htmlFor="character-handle"
            hint={
              handleError ??
              (handle
                ? `Gõ @${handle} trong lời nhắc để gọi ${copy.noun} này.`
                : `Tự tạo từ tên. Dùng để gọi ${copy.noun} trong lời nhắc.`)
            }
            invalid={Boolean(handleError)}
          >
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3 z-10 -translate-y-1/2 text-muted-foreground">
                @
              </span>
              <Input
                id="character-handle"
                className="[&_input]:pl-7 [&_input]:font-mono"
                value={handle}
                aria-invalid={Boolean(handleError)}
                onValueChange={(value) => {
                  setHandleTouched(true);
                  setHandle(cleanHandleInput(value));
                }}
                onBlur={() => setHandle((h) => h.replace(/-+$/, ""))}
              />
            </div>
          </Field>

          <Field label="Mô tả" htmlFor="character-description" hint={copy.descriptionHint}>
            <Textarea
              id="character-description"
              rows={6}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={copy.descriptionPlaceholder}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={images.length === 0 || describing || adding || saving}
                title={
                  images.length === 0
                    ? "Thêm ảnh để tạo mô tả"
                    : adding
                      ? "Đợi thêm ảnh xong"
                      : undefined
                }
                onClick={describe}
              >
                {describing ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
                {describing ? "Đang mô tả…" : "Tạo mô tả từ ảnh"}
              </Button>
              {previousDescription !== null && !describing && (
                <Button
                  variant="ghost-muted"
                  size="sm"
                  onClick={() => {
                    setDescription(previousDescription);
                    setPreviousDescription(null);
                    setDescribeNote(null);
                  }}
                >
                  Hoàn tác
                </Button>
              )}
            </div>
            {describeNote && <p className="mt-2 text-xs text-muted-foreground">{describeNote}</p>}
          </Field>

          {kind === "character" && (
            <VoiceField value={voiceId} onChange={setPickedVoice} disabled={saving} />
          )}

          {kind === "product" && (members.length > 0 || memberOf) && (
            <div className="flex flex-col gap-1.5">
              <span className="font-medium">Bộ sản phẩm</span>
              {memberOf && (
                <p className="text-xs text-muted-foreground">Nằm trong bộ: {memberOf.name}</p>
              )}
              {members.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {members.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs"
                    >
                      <span className="min-w-0 flex-1 truncate">{m.name}</span>
                      <span className="font-mono text-muted-foreground">@{m.handle}</span>
                      <Button
                        variant="ghost-muted"
                        size="icon-xs"
                        aria-label={`Bỏ ${m.name} khỏi bộ`}
                        title="Bỏ khỏi bộ"
                        disabled={busy}
                        onClick={() => setContains((c) => c.filter((id) => id !== m.id))}
                      >
                        <X />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      {error && (
        <p className="border-t bg-destructive-surface px-5 py-2 text-xs text-destructive-foreground">
          {error}
        </p>
      )}

      {confirmDiscard && unsavedAi && !inFlight ? (
        <DialogFooter className="bg-warning-surface">
          <span className="flex-1 text-warning-foreground">
            Ảnh AI vừa tạo chưa được lưu. Đóng sẽ bỏ các ảnh này.
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
          {character && (
            <Button
              variant="ghost-muted"
              disabled={busy}
              className={cn(confirmDelete && "text-destructive-foreground")}
              onClick={remove}
              onBlur={() => setConfirmDelete(false)}
            >
              {confirmDelete ? "Bấm lần nữa để xóa" : copy.remove}
            </Button>
          )}
          <span className="flex-1" />
          {inFlight && !saving && (
            <span className="text-xs text-muted-foreground">
              {generating || cleaning !== null ? "Đang tạo ảnh…" : "Đang tạo mô tả…"}
            </span>
          )}
          <Button
            variant="outline"
            disabled={inFlight}
            title={inFlight ? "Đợi xong rồi đóng, để không mất kết quả" : undefined}
            onClick={cancel}
          >
            Hủy
          </Button>
          <Button disabled={!canSave} onClick={save}>
            {character ? "Lưu thay đổi" : copy.create}
          </Button>
        </DialogFooter>
      )}
    </>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  invalid,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  invalid?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="font-medium">
        {label}
      </label>
      {children}
      {hint && (
        <p
          className={cn(
            "text-xs",
            invalid ? "text-destructive-foreground" : "text-muted-foreground",
          )}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
