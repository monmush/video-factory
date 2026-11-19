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
import { CUTOUT_USD } from "@shared/product-shot";
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
import { usePaidTextAi } from "@/lib/text-ai";
import { cn } from "@/lib/utils";
import { refreshWorkspace, useWorkspace } from "@/lib/workspace";
import { ANGLE_LABELS, AngleGenerator, PendingAngleTile } from "./angle-generator";
import { ImageViewer, type ViewerImage } from "./image-viewer";
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
  check?: PlaceFinding | null;
  original?: DraftImage;
  isCutout?: boolean;
  cutoutKept?: boolean;
  cutoutUsable?: boolean;
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
  asset.images.map((img) => {
    const isCutout = Boolean(img.cutout) && img.cutout?.file === img.file;
    return {
      key: img.id,
      ref: { source: "asset", assetId: asset.id, id: img.id },
      url: mediaUrl.asset(asset.id, img.file),
      origin: img.origin ?? "upload",
      angle: img.angle,
      check: img.placeCheck,
      isCutout,
      cutoutKept: Boolean(img.cutout) && !isCutout,
      cutoutUsable: img.cutout?.usable,
      original: img.original && {
        key: img.id,
        ref: { source: "asset", assetId: asset.id, id: img.id, restore: true },
        url: mediaUrl.asset(asset.id, img.original.file),
        origin: img.original.origin ?? "upload",
        angle: img.angle,
        check: img.original.placeCheck ?? null,
        cutoutKept: isCutout,
        cutoutUsable: isCutout ? img.cutout?.usable : undefined,
      },
    };
  });

const toRef = (image: DraftImage): ImageRef =>
  image.ref.source === "staged"
    ? { ...image.ref, origin: image.origin, angle: image.angle }
    : { ...image.ref, angle: image.angle };

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
  asset?: Asset;
  onCreated?: (asset: Asset) => void;
  initialImages?: StagedImage[];
}) {
  const [guard, setGuard] = useState<CloseGuard>(null);
  const [closeRequests, setCloseRequests] = useState(0);

  const requestClose = (next: boolean) => {
    if (next) return onOpenChange(true);
    if (guard === "work-in-flight") return;
    if (guard === "unsaved-ai") return setCloseRequests((n) => n + 1);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={requestClose} disablePointerDismissal>
      <DialogPopup className="max-w-4xl" showCloseButton={guard !== "work-in-flight"}>
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

type CloseGuard = "work-in-flight" | "unsaved-ai" | null;

type CleanReview = {
  key: string;
  image: StagedImage;
  check: PlaceFinding | null;
  note: string | null;
  cutout?: { usable: boolean };
};

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
  const latestDescription = useRef(description);
  latestDescription.current = description;
  const [describing, setDescribing] = useState(false);
  const [describeNote, setDescribeNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const createdId = useRef<string | null>(null);
  const paidText = usePaidTextAi();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAngles, setPendingAngles] = useState<CoreAngle[]>([]);
  const [angleNote, setAngleNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const isPlace = kind === "environment";
  const isProduct = kind === "product";
  const placeChecksRequested = useRef(new Set<string>());
  const [checking, setChecking] = useState<Set<string>>(new Set());
  const [cleaning, setCleaning] = useState<Set<string>>(new Set());
  const [reviews, setReviews] = useState<CleanReview[]>([]);
  const [viewer, setViewer] = useState<{ images: ViewerImage[]; index: number } | null>(null);
  const thumbs = useRef(new Map<string, HTMLImageElement>());
  const thumbRef = (id: string) => (el: HTMLImageElement | null) => {
    if (el) thumbs.current.set(id, el);
    else thumbs.current.delete(id);
  };
  const fromThumb = (id: string) => () => thumbs.current.get(id) ?? null;
  const [cleanPrice, setCleanPrice] = useState<number | null>(null);
  const [contains, setContains] = useState<string[]>(character?.contains ?? []);
  const members = contains
    .map((id) => workspace.assets.find((a) => a.id === id))
    .filter((a): a is Asset => Boolean(a));
  const memberOf = character
    ? workspace.assets.find((a) => a.contains?.includes(character.id))
    : undefined;
  const [pickedVoice, setPickedVoice] = useState<VoiceId | null>(
    voiceById(character?.voiceId)?.id ?? null,
  );
  const voiceId =
    pickedVoice ??
    suggestVoice(
      guessVoiceTraits(name, description),
      takenVoiceIds(workspace.assets, character?.id),
    );

  const generating = pendingAngles.length > 0;
  const inFlight = describing || generating || saving || cleaning.size > 0;
  const busy = inFlight || adding || reviews.length > 0;
  const cleanBlocked = describing || generating || saving || adding;
  const reviewFor = (key: string) => reviews.find((r) => r.key === key);
  const unsavedAi =
    reviews.length > 0 ||
    images.some((i) => (i.origin === "ai" || i.isCutout) && i.ref.source === "staged");
  const anyFlagged = isPlace && images.some((i) => isFlagged(i.check));

  useEffect(() => {
    if (!isPlace) return;
    const todo = images.filter(
      (i) => i.check === undefined && !placeChecksRequested.current.has(i.key),
    );
    if (!todo.length) return;
    for (const image of todo) placeChecksRequested.current.add(image.key);
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

  const replaceWith = async (
    key: string,
    make: (target: DraftImage) => Promise<Omit<CleanReview, "key">> | null,
    failure: string,
  ) => {
    const target = images.find((i) => i.key === key);
    const task = target && !cleaning.has(key) ? make(target) : null;
    if (!task) return;
    setCleaning((current) => new Set(current).add(key));
    setError(null);
    try {
      const review = await task;
      setReviews((current) => [...current.filter((r) => r.key !== key), { key, ...review }]);
    } catch (e) {
      setError(`${failure}: ${errorMessage(e)}`);
    } finally {
      setCleaning((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const spentNote = (source: string, cost: number | null) =>
    source === "fixture"
      ? "Chế độ thử: ảnh mẫu, chưa gọi API."
      : source === "kept"
        ? "Đã có từ trước, không tốn thêm."
        : cost !== null
          ? `Đã dùng khoảng ${formatCost(cost)}.`
          : null;

  const clean = (key: string) =>
    replaceWith(
      key,
      (target) =>
        isFlagged(target.check)
          ? api
              .invoke("assets:clean-place-photo", { image: target.ref, finding: target.check })
              .then((r) => ({
                image: r.image,
                check: r.finding,
                note: spentNote(r.source, r.cost),
              }))
          : null,
      "Không làm sạch được ảnh",
    );

  const cutOut = (key: string) =>
    replaceWith(
      key,
      (target) =>
        target.isCutout
          ? null
          : api.invoke("assets:cut-out-product-photo", { image: target.ref }).then((r) => ({
              image: r.image,
              check: null,
              note: spentNote(r.source, r.cost),
              cutout: { usable: r.usable },
            })),
      "Không tách được nền",
    );

  const acceptCleaned = (review: CleanReview) => {
    setImages((current) =>
      current.map((image): DraftImage => {
        if (image.key !== review.key) return image;
        const base = { key: review.image.id, url: review.image.url, angle: image.angle };
        return review.cutout
          ? {
              ...base,
              ref: {
                source: "staged",
                id: review.image.id,
                cleanOf: toRef(image),
                cutout: true,
              },
              origin: image.origin,
              isCutout: true,
              cutoutUsable: review.cutout.usable,
              original: { ...image, cutoutKept: false },
            }
          : {
              ...base,
              ref: { source: "staged", id: review.image.id, cleanOf: toRef(image) },
              origin: "ai",
              check: review.check ?? null,
              original: image,
            };
      }),
    );
    setReviews((current) => current.filter((r) => r.key !== review.key));
  };

  const discardCleaned = (key: string) =>
    setReviews((current) => current.filter((r) => r.key !== key));

  const restoreOriginal = (key: string) =>
    setImages((current) =>
      current.map((image) => (image.key === key && image.original ? image.original : image)),
    );

  const reviewed = reviews.flatMap((review) => {
    const original = images.find((i) => i.key === review.key);
    return original ? [{ review, original }] : [];
  });

  useEffect(() => {
    onGuardChange(inFlight ? "work-in-flight" : unsavedAi ? "unsaved-ai" : null);
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
            ? `Đã dùng khoảng ${formatCost(result.cost)}.`
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

  const freeSlots = Math.max(0, MAX_CHARACTER_IMAGES - images.length - pendingAngles.length);

  const canAdd = !adding && !saving && freeSlots > 0;

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
      const typedWhileDescribing = latestDescription.current !== before;
      if (!typedWhileDescribing) {
        setPreviousDescription(before);
        setDescription(result.description);
      }
      setDescribeNote(
        result.source === "fixture"
          ? "Chế độ thử: đây là mô tả mẫu, chưa gọi API."
          : result.source === "claude-code"
            ? "Viết bằng Claude trên máy này, tính vào gói Claude của bạn."
            : result.cost !== null
              ? `Đã dùng ${formatCost(result.cost)}.`
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
      const id = character?.id ?? createdId.current;
      if (id) await api.invoke("assets:update", id, input);
      else {
        const created = await api.invoke("assets:create", input);
        createdId.current = created.id;
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
                    <figure
                      className={cn(
                        "group relative aspect-[3/4] overflow-hidden rounded-lg",
                        image.isCutout ? "bg-checker" : "bg-background",
                      )}
                    >
                      <button
                        type="button"
                        aria-label="Xem ảnh lớn"
                        className="size-full cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                        onClick={() =>
                          setViewer({
                            images: images.map((i, n) => ({
                              url: i.url,
                              label: n === 0 ? "Ảnh chính" : undefined,
                              origin: fromThumb(`grid:${i.url}`),
                              transparent: i.isCutout,
                            })),
                            index,
                          })
                        }
                      >
                        <img
                          ref={thumbRef(`grid:${image.url}`)}
                          src={image.url}
                          alt=""
                          className="size-full object-contain"
                          draggable={false}
                        />
                      </button>
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
                      {cleaning.has(image.key) && (
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
                        disabled={cleaning.has(image.key)}
                        onClick={() => {
                          discardCleaned(image.key);
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
                        {!reviewFor(image.key) && (
                          <HoldButton
                            size="xs"
                            tone="outline"
                            className="self-start"
                            disabled={cleanBlocked || cleaning.has(image.key)}
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
                    {isProduct && image.cutoutUsable === false && (
                      <p className="text-xs text-warning-foreground">
                        Chạm mép ảnh, video không dùng được
                      </p>
                    )}
                    {isProduct &&
                      !image.isCutout &&
                      !reviewFor(image.key) &&
                      (image.cutoutKept ? (
                        <Button
                          size="xs"
                          variant="outline"
                          className="self-start"
                          disabled={cleanBlocked || cleaning.has(image.key)}
                          onClick={() => cutOut(image.key)}
                        >
                          Tách nền
                        </Button>
                      ) : (
                        <HoldButton
                          size="xs"
                          tone="outline"
                          className="self-start"
                          disabled={cleanBlocked || cleaning.has(image.key)}
                          onHold={() => cutOut(image.key)}
                        >
                          Giữ để tách nền
                          <ButtonPrice>~{formatCost(CUTOUT_USD)}</ButtonPrice>
                        </HoldButton>
                      ))}
                    {image.original && !reviewFor(image.key) && (
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

              {reviewed.map(({ review, original }) => (
                <div
                  key={review.key}
                  className="mx-3 mb-3 flex flex-col gap-2 rounded-lg border bg-background p-2"
                >
                  <div className="grid grid-cols-2 gap-2">
                    {[original.url, review.image.url].map((url, n) => (
                      <button
                        key={url}
                        type="button"
                        aria-label="Xem ảnh lớn"
                        className="relative cursor-zoom-in rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() =>
                          setViewer({
                            images: [
                              {
                                url: original.url,
                                label: "Ảnh gốc",
                                origin: fromThumb(`review:${original.url}`),
                              },
                              {
                                url: review.image.url,
                                label: review.cutout ? "Ảnh đã tách nền" : "Ảnh đã làm sạch",
                                origin: fromThumb(`review:${review.image.url}`),
                                transparent: Boolean(review.cutout),
                              },
                            ],
                            index: n,
                          })
                        }
                      >
                        <img
                          ref={thumbRef(`review:${url}`)}
                          src={url}
                          alt=""
                          className={cn(
                            "aspect-[4/3] w-full rounded-md object-contain",
                            n === 1 && review.cutout ? "bg-checker" : "bg-muted",
                          )}
                          draggable={false}
                        />
                        {n === 1 && !review.cutout && (
                          <span className="absolute top-2 left-2 rounded-md bg-black/60 px-1.5 py-0.5 text-2xs font-medium text-white">
                            AI
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="flex min-w-0 flex-1 flex-col text-xs">
                      {review.cutout && !review.cutout.usable && (
                        <span className="text-warning-foreground">
                          Chạm mép ảnh, video không dùng được
                        </span>
                      )}
                      {findingLabel(review.check) && (
                        <span className="text-warning-foreground">
                          {findingLabel(review.check)}
                        </span>
                      )}
                      {review.note && <span className="text-muted-foreground">{review.note}</span>}
                    </span>
                    <Button
                      variant="ghost-muted"
                      size="sm"
                      onClick={() => discardCleaned(review.key)}
                    >
                      Bỏ
                    </Button>
                    <Button size="sm" onClick={() => acceptCleaned(review)}>
                      Dùng ảnh này
                    </Button>
                  </div>
                </div>
              ))}

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
              {paidText ? (
                <HoldButton
                  tone="outline"
                  size="sm"
                  disabled={images.length === 0 || describing || adding || saving}
                  onHold={describe}
                >
                  {describing ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
                  {describing ? "Đang mô tả…" : "Giữ để tạo mô tả từ ảnh"}
                </HoldButton>
              ) : (
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
              )}
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
              {generating || cleaning.size > 0 ? "Đang tạo ảnh…" : "Đang tạo mô tả…"}
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
      <ImageViewer
        images={viewer?.images ?? []}
        index={viewer?.index ?? null}
        onIndexChange={(index) => setViewer((v) => v && { ...v, index })}
        onClose={() => setViewer(null)}
      />
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
