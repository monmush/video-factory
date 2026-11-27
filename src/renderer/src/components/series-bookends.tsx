import {
  BOOKEND_LABEL,
  BOOKEND_SLOTS,
  type BookendChanges,
  type BookendSlot,
  type SeriesBookends,
  type StagedBookend,
} from "@shared/bookends";
import { mediaUrl } from "@shared/ipc";
import { formatClock } from "@shared/video-export";
import { LoaderCircle, Plus, X } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { Button } from "./ui/button";

type SlotState =
  | { kind: "saved" }
  | { kind: "staged"; staged: StagedBookend }
  | { kind: "removed" };

export type BookendSlots = Record<BookendSlot, SlotState>;

export const unchangedBookends = (): BookendSlots => ({
  intro: { kind: "saved" },
  outro: { kind: "saved" },
});

export function bookendChanges(slots: BookendSlots): BookendChanges | undefined {
  const changes: BookendChanges = {};
  for (const slot of BOOKEND_SLOTS) {
    const state = slots[slot];
    if (state.kind === "staged") changes[slot] = { staged: state.staged.id };
    if (state.kind === "removed") changes[slot] = null;
  }
  return Object.keys(changes).length ? changes : undefined;
}

function shown(
  seriesId: string,
  saved: SeriesBookends | undefined,
  state: SlotState,
  slot: BookendSlot,
): { url: string; seconds: number } | null {
  if (state.kind === "staged") return state.staged;
  const bookend = state.kind === "saved" ? saved?.[slot] : undefined;
  return bookend
    ? { url: mediaUrl.bookend(seriesId, bookend.file), seconds: bookend.seconds }
    : null;
}

export function SeriesBookendFields({
  seriesId,
  saved,
  value,
  onChange,
  onError,
}: {
  seriesId: string;
  saved: SeriesBookends | undefined;
  value: BookendSlots;
  onChange: (value: BookendSlots) => void;
  onError: (message: string | null) => void;
}) {
  const [picking, setPicking] = useState<BookendSlot | null>(null);

  const pick = async (slot: BookendSlot) => {
    setPicking(slot);
    onError(null);
    try {
      const staged = await api.invoke("series:pick-bookend");
      if (staged) onChange({ ...value, [slot]: { kind: "staged", staged } });
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setPicking(null);
    }
  };

  const remove = (slot: BookendSlot) =>
    onChange({ ...value, [slot]: saved?.[slot] ? { kind: "removed" } : { kind: "saved" } });

  return (
    <div className="grid w-full grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
      {BOOKEND_SLOTS.map((slot) => {
        const clip = shown(seriesId, saved, value[slot], slot);
        return (
          <div key={slot} className="contents">
            <span className="text-xs leading-tight text-muted-foreground">
              {BOOKEND_LABEL[slot]}
            </span>
            <div className="flex min-w-0 items-center gap-2">
              {clip ? (
                <BookendClip
                  url={clip.url}
                  seconds={clip.seconds}
                  removeLabel={`Xóa ${BOOKEND_LABEL[slot].toLowerCase()}`}
                  onRemove={() => remove(slot)}
                />
              ) : (
                <Button
                  variant="outline"
                  size="xs"
                  disabled={picking !== null}
                  onClick={() => void pick(slot)}
                >
                  {picking === slot ? <LoaderCircle className="animate-spin" /> : <Plus />}
                  Thêm video
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BookendClip({
  url,
  seconds,
  removeLabel,
  onRemove,
}: {
  url: string;
  seconds: number;
  removeLabel: string;
  onRemove: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const play = () => void video.current?.play().catch(() => undefined);
  const pause = () => video.current?.pause();
  return (
    <div className="flex items-center gap-2" onPointerEnter={play} onPointerLeave={pause}>
      <video
        ref={video}
        key={url}
        src={url}
        muted
        loop
        playsInline
        preload="metadata"
        className="aspect-[9/16] w-10 rounded-md border bg-black object-cover"
      />
      <span className="text-xs text-muted-foreground tabular-nums">{formatClock(seconds)}</span>
      <Button
        variant="ghost-muted"
        size="icon-xs"
        aria-label={removeLabel}
        onFocus={play}
        onBlur={pause}
        onClick={onRemove}
      >
        <X />
      </Button>
    </div>
  );
}
