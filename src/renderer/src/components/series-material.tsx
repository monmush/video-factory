import type { Asset, Series } from "@shared/ipc";
import { mediaUrl } from "@shared/ipc";
import { type MaterialItem, type MaterialState, materialState } from "@shared/material";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useDraft } from "@/lib/drafts";
import { errorMessage } from "@/lib/errors";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { refreshWorkspace, useWorkspace } from "@/lib/workspace";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Dialog, DialogPopup, DialogTitle } from "./ui/dialog";

type Moment = {
  key: string;
  main: MaterialItem;
  picture?: MaterialItem;
  clip?: MaterialItem;
};

type Filter = "all" | "scene" | "detail" | "moving" | `character:${string}`;

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function momentsOf(items: readonly MaterialItem[]): Moment[] {
  const pictures = items.filter((i) => i.kind === "picture");
  const clips = items
    .filter((i) => i.kind === "clip")
    .sort((a, b) => b.source.at.localeCompare(a.source.at));
  const withPicture: Moment[] = pictures.map((picture) => ({
    key: picture.id,
    main: picture,
    picture,
    clip: clips.find((c) => c.pictureId === picture.id),
  }));
  const pictureIds = new Set(pictures.map((p) => p.id));
  const alone: Moment[] = clips
    .filter((c) => !c.pictureId || !pictureIds.has(c.pictureId))
    .map((clip) => ({ key: clip.id, main: clip, clip }));
  return [...withPicture, ...alone].sort((a, b) =>
    b.main.source.at.localeCompare(a.main.source.at),
  );
}

const characterOf = (moment: Moment) =>
  moment.main.role === "character" ? moment.main.people[0] : undefined;

function matches(moment: Moment, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "scene" || filter === "detail") return moment.main.role === filter;
  if (filter === "moving") return Boolean(moment.clip);
  return characterOf(moment) === filter.slice("character:".length);
}

type FilterOption = { filter: Filter; label: string };

const BY_KIND_OF_SHOT: FilterOption[] = [
  { filter: "scene", label: "Toàn cảnh" },
  { filter: "detail", label: "Chi tiết" },
  { filter: "moving", label: "Cảnh động" },
];

function filtersFor(moments: readonly Moment[], assets: readonly Asset[]): FilterOption[] {
  const characters: FilterOption[] = [];
  for (const moment of moments) {
    const id = characterOf(moment);
    const asset = id ? assets.find((a) => a.id === id) : undefined;
    if (!asset || characters.some((c) => c.filter === `character:${asset.id}`)) continue;
    characters.push({ filter: `character:${asset.id}`, label: asset.name });
  }
  const offered = [...characters, ...BY_KIND_OF_SHOT].filter(({ filter }) =>
    moments.some((m) => matches(m, filter)),
  );
  return offered.length > 0 ? [{ filter: "all", label: "Tất cả" }, ...offered] : [];
}

export function SeriesMaterial({ series, items }: { series: Series; items: MaterialItem[] }) {
  const seriesId = series.id;
  const { assets } = useWorkspace();
  const moments = useMemo(() => momentsOf(items), [items]);
  const filters = filtersFor(moments, assets);
  const [chosen, setChosen] = useDraft<Filter>(`material-filter:${seriesId}`, "all");
  const filter = filters.some((f) => f.filter === chosen) ? chosen : "all";
  const visible = moments.filter((m) => matches(m, filter));
  const [openKey, setOpenKey] = useState<string | null>(null);

  const moveOnFrom = (key: string) => {
    const at = visible.findIndex((m) => m.key === key);
    setOpenKey((visible[at + 1] ?? visible[at - 1])?.key ?? null);
  };

  return (
    <div className="px-3 pt-1">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        {filters.length > 0 && (
          <fieldset className="flex w-fit flex-wrap rounded-[var(--control-radius)] border p-0.5">
            <legend className="sr-only">Lọc tư liệu</legend>
            {filters.map(({ filter: f, label }) => (
              <Button
                key={f}
                size="xs"
                variant="ghost-muted"
                className={cn(filter === f && "bg-accent text-foreground")}
                aria-pressed={filter === f}
                onClick={() => setChosen(f)}
              >
                {label}
              </Button>
            ))}
          </fieldset>
        )}
        <ReuseSwitch series={series} />
      </div>
      <div className="grid grid-cols-4 gap-2">
        {visible.map((moment, i) => (
          <Tile
            key={moment.key}
            moment={moment}
            seriesId={seriesId}
            state={materialState(moment.main, assets)}
            label={moment.main.caption || `Tư liệu ${i + 1}`}
            onOpen={() => setOpenKey(moment.key)}
          />
        ))}
      </div>
      <MaterialViewer
        seriesId={seriesId}
        moments={visible}
        openKey={openKey}
        onOpenKey={setOpenKey}
        onRemoved={moveOnFrom}
      />
    </div>
  );
}

function ReuseSwitch({ series }: { series: Series }) {
  const { error, run } = useAction();
  const [saving, setSaving] = useState<boolean | null>(null);
  const on = saving ?? series.reuseMaterial !== false;

  const save = async (reuseMaterial: boolean) => {
    setSaving(reuseMaterial);
    await run(async () => {
      await api.invoke("series:update", { id: series.id, reuseMaterial });
      await refreshWorkspace();
    });
    setSaving(null);
  };

  return (
    <div className="ml-auto flex items-center gap-2.5 text-xs">
      {error && <span className="text-destructive-foreground">{error}</span>}
      <Checkbox
        checked={on}
        disabled={saving !== null}
        className="gap-1.5 text-muted-foreground"
        onChange={(event) => void save(event.currentTarget.checked)}
      >
        Dùng lại tư liệu
      </Checkbox>
    </div>
  );
}

const pill =
  "inline-flex items-center gap-0.5 rounded-full bg-black/60 px-1.5 py-0.5 text-2xs leading-none text-white tabular-nums";

const OUT_OF_CIRCULATION: Record<Exclude<MaterialState, "current">, string> = {
  off: "Không dùng lại",
  outdated: "Ảnh gốc đã đổi",
};

function Tile({
  moment,
  seriesId,
  state,
  label,
  onOpen,
}: {
  moment: Moment;
  seriesId: string;
  state: MaterialState;
  label: string;
  onOpen: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const { picture, clip } = moment;
  const url = (item: MaterialItem) => mediaUrl.material(seriesId, item.file);
  const uses = moment.main.uses.length;

  const play = () => {
    if (!video.current || prefersReducedMotion()) return;
    void video.current.play().catch(() => undefined);
  };
  const stop = () => {
    if (!video.current) return;
    video.current.pause();
    video.current.currentTime = 0;
    setPlaying(false);
  };

  return (
    <button
      type="button"
      aria-label={label}
      className="relative block aspect-[9/16] w-full cursor-pointer overflow-hidden rounded-[10px] border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      onClick={onOpen}
      onPointerEnter={play}
      onPointerLeave={stop}
      onFocus={play}
      onBlur={stop}
    >
      <span className={cn("absolute inset-0", state !== "current" && "opacity-50")}>
        {picture && (
          <img
            src={url(picture)}
            alt=""
            loading="lazy"
            draggable={false}
            className="size-full object-cover"
          />
        )}
        {clip && (
          <video
            ref={video}
            src={url(clip)}
            muted
            loop
            playsInline
            preload={picture ? "none" : "metadata"}
            onPlaying={() => setPlaying(true)}
            className={cn(
              "absolute inset-0 size-full object-cover",
              picture && !playing && "opacity-0",
            )}
          />
        )}
      </span>
      {uses > 0 && (
        <span className={cn(pill, "absolute top-1.5 right-1.5")} title={usedAgain(uses)}>
          ×{uses}
        </span>
      )}
      <span className="absolute inset-x-1.5 bottom-1.5 flex flex-col items-start gap-1">
        {clip && (
          <span className={pill}>
            <Play className="size-2.5 fill-current" aria-hidden />
            {clip.seconds !== undefined && `${Math.round(clip.seconds)} giây`}
          </span>
        )}
        {state !== "current" && (
          <span className={cn(pill, "max-w-full truncate")}>{OUT_OF_CIRCULATION[state]}</span>
        )}
      </span>
    </button>
  );
}

const usedAgain = (count: number) => `Đã dùng lại trong ${count} video`;

function MaterialViewer({
  seriesId,
  moments,
  openKey,
  onOpenKey,
  onRemoved,
}: {
  seriesId: string;
  moments: Moment[];
  openKey: string | null;
  onOpenKey: (key: string | null) => void;
  onRemoved: (key: string) => void;
}) {
  const at = moments.findIndex((m) => m.key === openKey);
  const current = at >= 0 ? moments[at] : undefined;
  const [last, setLast] = useState(current);
  if (current && current !== last) setLast(current);
  const shown = current ?? last;
  const open = current !== undefined;

  const go = (to: number) => {
    const next = moments[to];
    if (next) onOpenKey(next.key);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.altKey || e.ctrlKey) return;
      if (e.key === "ArrowLeft") go(at - 1);
      else if (e.key === "ArrowRight") go(at + 1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    const beforeDialogStopsArrowKeys = true;
    window.addEventListener("keydown", onKey, beforeDialogStopsArrowKeys);
    return () => window.removeEventListener("keydown", onKey, beforeDialogStopsArrowKeys);
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onOpenKey(null)}>
      <DialogPopup className="h-[min(56rem,calc(100vh-3rem))] max-w-5xl flex-row overflow-hidden">
        {shown && (
          <>
            <div className="relative flex min-w-0 flex-1 items-center justify-center bg-muted p-6">
              <ViewerMedia seriesId={seriesId} moment={shown} />
              <ViewerStep side="left" hidden={at <= 0} onClick={() => go(at - 1)} />
              <ViewerStep
                side="right"
                hidden={at < 0 || at >= moments.length - 1}
                onClick={() => go(at + 1)}
              />
            </div>
            <MaterialPanel
              key={shown.key}
              seriesId={seriesId}
              moment={shown}
              onRemoved={() => onRemoved(shown.key)}
            />
          </>
        )}
      </DialogPopup>
    </Dialog>
  );
}

function ViewerMedia({ seriesId, moment }: { seriesId: string; moment: Moment }) {
  const { picture, clip } = moment;
  const url = (item: MaterialItem) => mediaUrl.material(seriesId, item.file);
  const media = "max-h-full max-w-full rounded-lg border bg-background object-contain";
  if (clip) {
    return (
      <video
        key={clip.id}
        src={url(clip)}
        poster={picture ? url(picture) : undefined}
        controls
        loop
        muted
        playsInline
        autoPlay={!prefersReducedMotion()}
        className={media}
      />
    );
  }
  return picture ? (
    <img src={url(picture)} alt={picture.caption} draggable={false} className={media} />
  ) : null;
}

function ViewerStep({
  side,
  hidden,
  onClick,
}: {
  side: "left" | "right";
  hidden: boolean;
  onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  const label = side === "left" ? "Trước (←)" : "Sau (→)";
  return (
    <Button
      size="icon"
      variant="outline"
      aria-label={label}
      title={label}
      disabled={hidden}
      onClick={onClick}
      className={cn(
        "absolute top-1/2 size-10 -translate-y-1/2 rounded-full bg-popover/90 backdrop-blur-md disabled:opacity-0",
        side === "left" ? "left-4" : "right-4",
      )}
    >
      <Icon className="size-5" />
    </Button>
  );
}

function MaterialPanel({
  seriesId,
  moment,
  onRemoved,
}: {
  seriesId: string;
  moment: Moment;
  onRemoved: () => void;
}) {
  const workspace = useWorkspace();
  const item = moment.main;
  const state = materialState(item, workspace.assets);
  const character =
    item.kind === "picture" && item.role === "character"
      ? workspace.assets.find((a) => a.id === item.people[0])
      : undefined;
  const original = character?.images[0];
  const sourceSession = workspace.sessions.find((s) => s.id === item.source.sessionId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const target = { seriesId, itemId: item.id };

  const run = async (work: () => Promise<unknown>, onError: (message: string) => void) => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleReuse = () => {
    setError(null);
    return run(
      () => api.invoke("material:set-reusable", { ...target, reusable: !item.reusable }),
      setError,
    );
  };

  const addToCharacter = () => {
    setAddError(null);
    return run(async () => {
      await api.invoke("material:add-to-character", target);
      await refreshWorkspace();
      setAdded(true);
    }, setAddError);
  };

  const remove = () => {
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    setError(null);
    return run(
      async () => {
        await api.invoke("material:remove", target);
        onRemoved();
      },
      (message) => {
        setError(message);
        setConfirmRemove(false);
      },
    );
  };

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-5 overflow-y-auto border-l px-4 pt-12 pb-4">
      <DialogTitle
        className={cn(
          "text-sm leading-relaxed font-normal text-pretty",
          !item.caption && "sr-only",
        )}
      >
        {item.caption || "Tư liệu"}
      </DialogTitle>

      {character && original && (
        <div className="flex items-center gap-3">
          <img
            src={mediaUrl.asset(character.id, original.file)}
            alt=""
            draggable={false}
            className="w-18 shrink-0 rounded-lg border bg-muted object-cover"
          />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Ảnh gốc</p>
            <p className="truncate text-sm font-medium">{character.name}</p>
          </div>
        </div>
      )}

      {sourceSession && (
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Từ video</p>
          <Link
            to="/sessions/$sessionId"
            params={{ sessionId: sourceSession.id }}
            className="block truncate text-sm font-medium underline-offset-4 hover:underline"
          >
            {item.source.title}
          </Link>
        </div>
      )}

      {item.uses.length > 0 && <p className="text-sm">{usedAgain(item.uses.length)}</p>}

      {state === "outdated" && (
        <p className="text-sm leading-relaxed text-muted-foreground">
          Ảnh gốc của nhân vật hoặc bối cảnh đã đổi nên không dùng lại nữa.
        </p>
      )}

      <div className="mt-auto flex flex-col gap-1.5">
        {state !== "outdated" && (
          <Button variant="outline" size="sm" disabled={busy} onClick={toggleReuse}>
            {item.reusable ? "Không dùng lại" : "Cho dùng lại"}
          </Button>
        )}
        {character && (
          <>
            <Button variant="outline" size="sm" disabled={busy || added} onClick={addToCharacter}>
              {added ? "Đã thêm" : "Thêm vào ảnh nhân vật"}
            </Button>
            {addError && <p className="text-xs text-destructive-foreground">{addError}</p>}
          </>
        )}
        <Button
          variant="ghost-muted"
          size="sm"
          disabled={busy}
          className={cn(confirmRemove && "text-destructive-foreground")}
          onClick={remove}
          onBlur={() => setConfirmRemove(false)}
        >
          {confirmRemove ? "Bấm lần nữa để xóa" : "Xóa"}
        </Button>
        {error && <p className="text-xs text-destructive-foreground">{error}</p>}
      </div>
    </aside>
  );
}
