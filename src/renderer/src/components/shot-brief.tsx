import { directionAt } from "@shared/direction";
import { unstarted } from "@shared/edit-in-place";
import type { Script } from "@shared/ipc";
import type { Reworded } from "@shared/reworded";
import { sceneBrief, sceneFraming, sceneMoves, sceneSeconds, spokenParts } from "@shared/scene";
import { OUTDATED_TEXT } from "@shared/staging-status";
import type { JobShot, VideoJob } from "@shared/video-job";
import { Pencil, PenLine, X } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";
import { api } from "@/lib/api";
import { withOccurrenceKeys } from "@/lib/occurrence-keys";
import { STAGE_LABEL, stagingOf, useVideoLevel } from "@/lib/staging";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { useVideoJobs } from "@/lib/video-jobs";
import { useWorkspace } from "@/lib/workspace";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

const STEPS_IN_VIEW = 4;

export function PlanningSteps({ steps, className }: { steps: string[]; className?: string }) {
  const shown = withOccurrenceKeys(steps, (step) => step).slice(-STEPS_IN_VIEW);
  return (
    <ol className={cn("flex flex-col gap-1 border-l border-border pl-3 text-xs", className)}>
      {shown.map(({ item: step, key }, i) => {
        const latest = i === shown.length - 1;
        return (
          <li key={key} className={cn("line-in truncate", !latest && "text-muted-foreground/70")}>
            {latest ? <span className="shimmer-text">{step}</span> : step}
          </li>
        );
      })}
    </ol>
  );
}

export function ShotBrief({
  sessionId,
  script,
  job: given,
  className,
}: {
  sessionId: string;
  script: Script;
  job?: VideoJob | null;
  className?: string;
}) {
  const jobs = useVideoJobs(sessionId);
  const { assets } = useWorkspace();
  const job = given !== undefined ? given : (jobs?.jobs.get(script.id) ?? null);
  const level = useVideoLevel(sessionId)(script.id);
  const { error, run } = useAction();
  const [editing, setEditing] = useState<number | null>(null);
  const ids = { sessionId, scriptId: script.id };
  const stage = (again = false) =>
    run(() =>
      api.invoke("video:stage", { sessionId, scriptIds: [script.id], ...(again ? { again } : {}) }),
    );

  if (script.status !== "ready") return null;
  const staging = script.staging?.trim();
  const errorLine = error && <p className="text-xs text-destructive-foreground">{error}</p>;
  const { status, reasons, canStage } = stagingOf(job, script, level);

  if (job?.planning) {
    return (
      <div data-shot-brief className={cn("flex flex-col items-start gap-2", className)}>
        <PlanningSteps steps={job.planningSteps?.length ? job.planningSteps : ["Đọc kịch bản"]} />
        <Button
          variant="ghost-muted"
          size="xs"
          onClick={() => run(() => api.invoke("video:stage-stop", ids))}
        >
          Dừng
        </Button>
        {errorLine}
      </div>
    );
  }

  if (!job?.plan) {
    return (
      <div data-shot-brief className={cn("flex flex-col items-start gap-2", className)}>
        {staging && <StagingNote text={staging} />}
        {canStage && (
          <Button variant="outline" size="xs" onClick={() => stage()}>
            {STAGE_LABEL[status]}
          </Button>
        )}
        {errorLine}
      </div>
    );
  }

  const open = unstarted(job);
  const outdated = status === "outdated";
  const reason = reasons[0];
  const changed = open ? job.reworded : undefined;
  const changedScene = (i: number) => Array.isArray(changed?.scenes) && changed.scenes.includes(i);
  const keyframes = job.live?.plan.keyframes ?? [];
  const nameOf = (shot: JobShot) => {
    const line = job.lines[shot.lineIndex];
    return (
      assets.find((a) => a.id === line?.characterId)?.name ?? line?.speaker ?? shot.speaker ?? ""
    );
  };
  const whole = (job.direction ?? []).filter((d) => !d.words);
  const plannedBeforeBriefsWereSentences = job.shots.some((shot) => !sceneBrief(shot));
  const pendingWish = (shot: JobShot) => {
    const wanted = directionAt(job.direction, shot.text)?.want;
    if (!wanted || !job.stagedDirection) return undefined;
    return directionAt(job.stagedDirection, shot.text)?.want === wanted ? undefined : wanted;
  };
  const save = (shot: JobShot, value: string) => {
    setEditing(null);
    const want = value.replace(/\s+/g, " ").trim();
    const had = directionAt(job.direction, shot.text);
    if (want === (pendingWish(shot) ?? sceneBrief(shot) ?? "") || (!want && !had)) return;
    void run(() => api.invoke("video:direct", { ...ids, words: shot.text, want }));
  };

  return (
    <div data-shot-brief className={cn("flex flex-col gap-3", className)}>
      {outdated && reason && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {OUTDATED_TEXT[reason]}
          <Button variant="outline" size="xs" onClick={() => stage()}>
            Cập nhật
          </Button>
        </div>
      )}
      {changed && !outdated && <RewordedNote changed={changed} />}
      {staging && <StagingNote text={staging} />}
      {whole.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {whole.map((d) => (
            <li key={d.at} className="flex items-center gap-1.5">
              <PenLine className="size-3 shrink-0" aria-hidden />
              <span className="min-w-0 truncate" title={d.want}>
                {d.want}
              </span>
              {open && (
                <Button
                  variant="ghost-muted"
                  size="icon-xs"
                  aria-label="Bỏ"
                  onClick={() =>
                    run(() => api.invoke("video:direct", { ...ids, want: "", at: d.at }))
                  }
                >
                  <X />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {open && !outdated && plannedBeforeBriefsWereSentences && (
        <Button variant="outline" size="xs" className="self-start" onClick={() => stage(true)}>
          Dàn dựng lại
        </Button>
      )}
      <ol className={cn("flex flex-col divide-y divide-border", outdated && "opacity-60")}>
        {job.shots.map((shot, i) => (
          <Scene
            key={shot.index}
            shot={shot}
            reworded={changedScene(i)}
            name={nameOf(shot)}
            framing={sceneFraming(shot, keyframes)}
            directed={Boolean(directionAt(job.direction, shot.text))}
            wish={pendingWish(shot)}
            editing={editing === shot.index}
            editable={open}
            onEdit={() => setEditing(shot.index)}
            onCancel={() => setEditing(null)}
            onSave={(value) => save(shot, value)}
          />
        ))}
      </ol>
      {errorLine}
    </div>
  );
}

function RewordedNote({ changed }: { changed: Reworded }) {
  const scenes =
    changed.scenes === "all"
      ? "Đã lên lại toàn bộ theo lời thoại mới"
      : changed.scenes.length
        ? `Đã cập nhật ${changed.scenes.length} cảnh theo lời thoại mới`
        : "";
  const dropped = changed.droppedWishes ? `Đã bỏ ${changed.droppedWishes} ý của bạn` : "";
  const text = [scenes, dropped].filter(Boolean).join(" · ");
  if (!text) return null;
  return <p className="text-xs text-muted-foreground">{text}</p>;
}

function Scene({
  shot,
  reworded,
  name,
  framing,
  directed,
  wish,
  editing,
  editable,
  onEdit,
  onCancel,
  onSave,
}: {
  shot: JobShot;
  reworded: boolean;
  name: string;
  framing: string;
  directed: boolean;
  wish: string | undefined;
  editing: boolean;
  editable: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (value: string) => void;
}) {
  const brief = wish ?? sceneBrief(shot);
  const seen = brief ?? <span className="text-muted-foreground/60">Chưa có mô tả</span>;
  return (
    <li className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground tabular-nums">
          Cảnh {shot.index + 1}
        </span>
        <Badge>{framing}</Badge>
        {sceneMoves(shot) && <Badge>Chuyển động</Badge>}
        {shot.sound && <Badge>Tiếng động</Badge>}
        {directed && <Badge variant="secondary">Theo ý bạn</Badge>}
        {reworded && <Badge variant="secondary">Vừa sửa</Badge>}
        <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
          {sceneSeconds(shot)} giây
        </span>
      </div>
      <p className="text-sm leading-relaxed text-foreground" data-selectable>
        “
        {withOccurrenceKeys(spokenParts(shot.text), (part) => part.text).map(
          ({ item: part, key }, i, all) => (
            <span key={key} className={cn(part.sound && "text-muted-foreground")}>
              {part.text}
              {i < all.length - 1 ? " " : ""}
            </span>
          ),
        )}
        ”
        {name && (
          <span className="ml-1.5 text-xs whitespace-nowrap text-muted-foreground">{name}</span>
        )}
      </p>
      {editing ? (
        <SceneEditor
          label={`Cảnh ${shot.index + 1}`}
          initial={brief ?? ""}
          onSave={onSave}
          onCancel={onCancel}
        />
      ) : editable ? (
        <button
          type="button"
          className="group/seen -mx-1.5 cursor-text rounded-md px-1.5 py-1 text-left text-sm leading-relaxed text-muted-foreground outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onEdit}
        >
          {seen}
          <Pencil
            className="ml-1.5 inline size-3 align-baseline text-muted-foreground/70 opacity-0 transition-opacity group-hover/seen:opacity-100 group-focus-visible/seen:opacity-100"
            aria-hidden
          />
        </button>
      ) : (
        <p className="text-sm leading-relaxed text-muted-foreground" data-selectable>
          {seen}
        </p>
      )}
    </li>
  );
}

function SceneEditor({
  label,
  initial,
  onSave,
  onCancel,
}: {
  label: string;
  initial: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    if (value === null) onCancel();
    else onSave(value);
  };
  return (
    <Textarea
      autoFocus
      rows={1}
      defaultValue={initial}
      aria-label={label}
      className="field-sizing-content -mx-1.5 w-[calc(100%+--spacing(3))] px-1.5 py-1 text-sm"
      onFocus={(e) => {
        const end = e.currentTarget.value.length;
        e.currentTarget.setSelectionRange(end, end);
      }}
      onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          finish(e.currentTarget.value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finish(null);
        }
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}

function StagingNote({ text }: { text: string }) {
  const { assets } = useWorkspace();
  const named = text.replace(
    /@([a-z0-9]+(?:-[a-z0-9]+)*)/g,
    (tag, handle: string) => assets.find((a) => a.handle === handle)?.name ?? tag,
  );
  return (
    <p className="text-xs leading-relaxed text-muted-foreground" data-selectable>
      {named}
    </p>
  );
}
