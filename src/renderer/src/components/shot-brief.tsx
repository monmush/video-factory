import { directionAt } from "@shared/direction";
import { unstarted } from "@shared/edit-in-place";
import type { Script } from "@shared/ipc";
import type { Reworded } from "@shared/reworded";
import { sceneBrief, sceneFraming, sceneMoves, sceneSeconds, spokenParts } from "@shared/scene";
import {
  MERGE_WISH,
  type MergeSide,
  mergeAt,
  mergeSideOf,
  type SceneAction,
  sceneAction,
} from "@shared/scene-actions";
import type { JobShot, VideoJob } from "@shared/video-job";
import { Pencil, PenLine, Trash2, X } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";
import { api } from "@/lib/api";
import { removeScriptLine } from "@/lib/board-notice";
import { withOccurrenceKeys } from "@/lib/occurrence-keys";
import { stagingOf, useVideoLevel } from "@/lib/staging";
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

  if (script.status !== "ready") return null;
  const staging = script.staging?.trim();
  const errorLine = error && <p className="text-xs text-destructive-foreground">{error}</p>;
  const { status, reasons } = stagingOf(job, script, level);

  if (job?.planning) {
    return (
      <div data-shot-brief className={cn("flex flex-col items-start gap-2", className)}>
        <PlanningSteps steps={job.planningSteps?.length ? job.planningSteps : ["Đọc kịch bản"]} />
        {errorLine}
      </div>
    );
  }

  if (!job?.plan) {
    if (!staging && !error) return null;
    return (
      <div data-shot-brief className={cn("flex flex-col items-start gap-2", className)}>
        {staging && <StagingNote text={staging} />}
        {errorLine}
      </div>
    );
  }

  const open = unstarted(job);
  const outdated = status === "outdated";
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
  const pendingWish = (shot: JobShot) => {
    const wanted = directionAt(job.direction, shot.text)?.want;
    if (!wanted || !job.stagedDirection) return undefined;
    return directionAt(job.stagedDirection, shot.text)?.want === wanted ? undefined : wanted;
  };
  const scenesEditable =
    open &&
    !script.changing &&
    (status === "ready" || (status === "outdated" && reasons.every((r) => r === "wishes")));
  const toMerge = (shot: JobShot) => mergeSideOf(pendingWish(shot));
  const actionOf = (shot: JobShot) =>
    scenesEditable && !toMerge(shot) ? sceneAction(job, script.lines, shot) : null;
  const act = (shot: JobShot, action: SceneAction) =>
    run(() =>
      action.kind === "merge"
        ? api.invoke("video:direct", { ...ids, words: shot.text, want: MERGE_WISH[action.into] })
        : removeScriptLine(sessionId, script.id, { index: action.index, was: action.was }),
    );
  const unmerge = (shot: JobShot) =>
    run(() => api.invoke("video:direct", { ...ids, words: shot.text, want: "" }));
  const save = (shot: JobShot, value: string) => {
    setEditing(null);
    const want = value.replace(/\s+/g, " ").trim();
    const had = directionAt(job.direction, shot.text);
    if (want === (pendingWish(shot) ?? sceneBrief(shot) ?? "") || (!want && !had)) return;
    void run(() => api.invoke("video:direct", { ...ids, words: shot.text, want }));
  };

  return (
    <div data-shot-brief className={cn("flex flex-col gap-3", className)}>
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
      <ol className={cn("flex flex-col divide-y divide-border", outdated && "opacity-60")}>
        {job.shots.map((shot, i) => (
          <Scene
            key={shot.index}
            shot={shot}
            reworded={changedScene(i)}
            name={nameOf(shot)}
            framing={sceneFraming(shot, keyframes)}
            directed={
              Boolean(directionAt(job.direction, shot.text)) && !mergeAt(job.direction, shot)
            }
            wish={toMerge(shot) ? undefined : pendingWish(shot)}
            merging={toMerge(shot)}
            action={actionOf(shot)}
            onAction={(action) => act(shot, action)}
            onUnmerge={open ? () => unmerge(shot) : undefined}
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
  merging,
  action,
  onAction,
  onUnmerge,
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
  merging: MergeSide | null;
  action: SceneAction | null;
  onAction: (action: SceneAction) => void;
  onUnmerge: (() => void) | undefined;
  editing: boolean;
  editable: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (value: string) => void;
}) {
  const brief = wish ?? sceneBrief(shot);
  const seen = brief ?? <span className="text-muted-foreground/60">Chưa có mô tả</span>;
  return (
    <li className="group/scene flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
      <div className={cn("flex items-center gap-1.5", merging && "opacity-60")}>
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
        {action && <SceneActionButton action={action} onClick={() => onAction(action)} />}
      </div>
      <p
        className={cn("text-sm leading-relaxed text-foreground", merging && "opacity-60")}
        data-selectable
      >
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
      {merging ? (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {MERGING_TEXT[merging]}
          {onUnmerge && (
            <Button variant="ghost-muted" size="xs" onClick={onUnmerge}>
              Hoàn tác
            </Button>
          )}
        </p>
      ) : editing ? (
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

const MERGING_TEXT: Record<MergeSide, string> = {
  previous: "Sẽ gộp vào cảnh trước",
  next: "Sẽ gộp vào cảnh sau",
};

const ACTION_LABEL = {
  previous: "Gộp vào cảnh trước",
  next: "Gộp vào cảnh sau",
  remove: "Xóa cảnh và lời thoại",
} as const;

function SceneActionButton({ action, onClick }: { action: SceneAction; onClick: () => void }) {
  const label = ACTION_LABEL[action.kind === "merge" ? action.into : "remove"];
  return (
    <Button
      variant="ghost-muted"
      size="icon-xs"
      className="-my-0.5 opacity-0 transition-opacity group-hover/scene:opacity-100 focus-visible:opacity-100"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Trash2 />
    </Button>
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
