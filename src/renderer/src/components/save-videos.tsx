import {
  allPicks,
  defaultPicks,
  type ExportPick,
  type ExportVideo,
  exportableVideos,
  formatClock,
  offeredFiles,
  pickKey,
} from "@shared/video-export";
import { Check, Download } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { useBoard } from "@/lib/board";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { useVideoJobs } from "@/lib/video-jobs";
import { useSessionBookends } from "@/lib/workspace";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";

export function SaveVideosButton({ sessionId }: { sessionId: string }) {
  const board = useBoard(sessionId);
  const state = useVideoJobs(sessionId);
  const bookends = useSessionBookends(sessionId);
  const [open, setOpen] = useState(false);
  if (!board || !state) return null;
  const videos = exportableVideos(board.scripts, state.jobs, bookends);
  if (offeredFiles(videos) < 2) return null;
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Download />
        Tải xuống
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup className="max-w-md">
          {open && (
            <SaveVideosForm sessionId={sessionId} videos={videos} onSaved={() => setOpen(false)} />
          )}
        </DialogPopup>
      </Dialog>
    </>
  );
}

const keysOf = (video: ExportVideo) =>
  video.versions.map((v) => pickKey({ scriptId: video.scriptId, version: v.version }));

function SaveVideosForm({
  sessionId,
  videos,
  onSaved,
}: {
  sessionId: string;
  videos: ExportVideo[];
  onSaved: () => void;
}) {
  const [picked, setPicked] = useState(() => new Set(defaultPicks(videos).map(pickKey)));
  const [notSaved, setNotSaved] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const { error, run } = useAction();
  const offered = allPicks(videos);
  const chosen = offered.filter((p) => picked.has(pickKey(p)));
  const everything = offered.length > 0 && chosen.length === offered.length;

  const set = (keys: string[], on: boolean) =>
    setPicked((before) => {
      const next = new Set(before);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });

  const numbersOf = (picks: ExportPick[]) =>
    videos.filter((v) => picks.some((p) => p.scriptId === v.scriptId)).map((v) => v.number);

  const save = () =>
    run(async () => {
      setSaving(true);
      try {
        const result = await api.invoke("video:save-many", { sessionId, picks: chosen });
        if (!result) return;
        if (result.failed.length === 0) {
          onSaved();
          return;
        }
        setPicked(new Set(result.failed.map(pickKey)));
        setNotSaved(numbersOf(result.failed));
      } finally {
        setSaving(false);
      }
    });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Tải video xuống</DialogTitle>
      </DialogHeader>
      <Checkbox
        className="border-b px-5 py-2.5 text-sm"
        checked={everything}
        indeterminate={chosen.length > 0 && !everything}
        onChange={() => set(offered.map(pickKey), !everything)}
      >
        Chọn tất cả
      </Checkbox>
      <ul className="flex max-h-[60vh] flex-col overflow-y-auto px-5 py-2 text-sm">
        {videos.map((video) => (
          <VideoRow key={video.scriptId} video={video} picked={picked} onSet={set} />
        ))}
      </ul>
      {(notSaved.length > 0 || error) && (
        <p className="px-5 pb-3 text-xs text-destructive-foreground">
          {notSaved.length > 0
            ? `Chưa lưu được: ${notSaved.map((n) => `#${n}`).join(", ")}`
            : error}
        </p>
      )}
      <DialogFooter className="justify-end">
        <DialogClose render={<Button variant="ghost" />}>Hủy</DialogClose>
        <Button disabled={chosen.length === 0 || saving} onClick={save}>
          Tải {chosen.length} video
        </Button>
      </DialogFooter>
    </>
  );
}

function VideoRow({
  video,
  picked,
  onSet,
}: {
  video: ExportVideo;
  picked: ReadonlySet<string>;
  onSet: (keys: string[], on: boolean) => void;
}) {
  const keys = keysOf(video);
  const ticked = keys.filter((k) => picked.has(k)).length;
  const several = video.versions.length > 1;
  return (
    <li>
      <Checkbox
        className="min-h-9"
        checked={ticked === keys.length}
        indeterminate={ticked > 0 && ticked < keys.length}
        onChange={() => onSet(keys, ticked < keys.length)}
      >
        <span className="w-6 shrink-0 text-xs text-muted-foreground tabular-nums">
          #{video.number}
        </span>
        <span className="min-w-0 flex-1 truncate">{video.title}</span>
        {video.seconds !== null && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatClock(video.seconds)}
          </span>
        )}
      </Checkbox>
      {several && (
        <ul className="mb-1 flex flex-col pl-6.5">
          {video.versions.map((version, i) => {
            const key = keys[i] as string;
            return (
              <li key={version.version}>
                <Checkbox
                  className="min-h-8"
                  checked={picked.has(key)}
                  onChange={(e) => onSet([key], e.target.checked)}
                >
                  <span className={cn("flex items-center gap-1", !version.inUse && "pl-4.5")}>
                    {version.inUse && <Check className="size-3.5" aria-label="Đang dùng" />}
                    {version.label}
                  </span>
                </Checkbox>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
