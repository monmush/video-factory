import { directionAt } from "@shared/direction";
import type { Script } from "@shared/ipc";
import { sceneBrief, sceneFraming, sceneMoves, sceneSeconds, spokenParts } from "@shared/scene";
import { type JobShot, spentUsd, type VideoJob } from "@shared/video-job";
import { Pencil, PenLine, X } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useVideoJobs } from "@/lib/video-jobs";
import { useWorkspace } from "@/lib/workspace";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

// "Dàn dựng": the video scene by scene before anything is paid
// (docs/PLAN_PHASE_PROPOSAL.md). Each scene shows its framing and length, the
// words heard, then what the viewer sees. While nothing is spent, what is seen
// can be rewritten in the operator's own words; the video is then planned
// again (free), keeping what they wrote.

/** Lines of the director's work kept in view; older ones scroll out. */
const STEPS_SHOWN = 4;

/**
 * While a video is planned: what the director has done so far, read from its
 * answer as it is written (src/shared/plan-progress.ts). Each new line slides
 * in; the newest shimmers while the director keeps working.
 */
export function PlanningSteps({ steps, className }: { steps: string[]; className?: string }) {
  const first = Math.max(0, steps.length - STEPS_SHOWN);
  return (
    <ol className={cn("flex flex-col gap-1 border-l border-border pl-3 text-xs", className)}>
      {steps.slice(first).map((step, i) => {
        const latest = first + i === steps.length - 1;
        return (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: the list only grows, and lines repeat ("Khung hình: Cô gái" twice), so the position in the whole list is the stable key; only new lines mount and slide in.
            key={first + i}
            className={cn("line-in truncate", !latest && "text-muted-foreground/70")}
          >
            {/* Its own element, sized to the words: the slide-in and the shine are two animations,
                and the band sweeps across the text, not the card's whole width. */}
            {latest ? <span className="shimmer-text">{step}</span> : step}
          </li>
        );
      })}
    </ol>
  );
}

/** Nothing made or spent: the plan can still change for free (runner.ts, `unstarted`). */
const editable = (job: VideoJob) =>
  job.status === "idle" && !job.planning && !job.dialogue && spentUsd(job) === 0;

export function ShotBrief({
  sessionId,
  script,
  job: given,
  className,
}: {
  sessionId: string;
  script: Script;
  /** The job to show; looked up when absent. */
  job?: VideoJob | null;
  className?: string;
}) {
  const jobs = useVideoJobs(sessionId);
  const { assets } = useWorkspace();
  const job = given !== undefined ? given : (jobs?.jobs.get(script.id) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const ids = { sessionId, scriptId: script.id };
  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (script.status !== "ready") return null;
  const staging = script.staging?.trim();
  const errorLine = error && <p className="text-xs text-destructive-foreground">{error}</p>;

  if (job?.planning) {
    return (
      <div data-shot-brief className={className}>
        <PlanningSteps steps={job.planningSteps?.length ? job.planningSteps : ["Đọc kịch bản"]} />
      </div>
    );
  }

  if (!job?.plan) {
    // Staging starts by itself a moment after the script is written; the
    // button is the way to try again when that failed.
    return (
      <div data-shot-brief className={cn("flex flex-col items-start gap-2", className)}>
        {staging && <StagingNote text={staging} />}
        <Button
          variant="outline"
          size="xs"
          onClick={() => run(() => api.invoke("video:plan", ids))}
        >
          Lên dàn dựng
        </Button>
        {errorLine}
      </div>
    );
  }

  const open = editable(job);
  const keyframes = job.live?.plan.keyframes ?? [];
  const nameOf = (shot: JobShot) => {
    const line = job.lines[shot.lineIndex];
    return (
      assets.find((a) => a.id === line?.characterId)?.name ?? line?.speaker ?? shot.speaker ?? ""
    );
  };
  const whole = (job.direction ?? []).filter((d) => !d.words);
  // Plans made before briefs were sentences: planned again for free, wishes kept.
  const undescribed = job.shots.some((shot) => !sceneBrief(shot));
  const save = (shot: JobShot, value: string) => {
    setEditing(null);
    const want = value.replace(/\s+/g, " ").trim();
    const had = directionAt(job.direction, shot.text);
    if (want === (sceneBrief(shot) ?? "") || (!want && !had)) return;
    void run(() => api.invoke("video:direct", { ...ids, words: shot.text, want }));
  };

  return (
    <div data-shot-brief className={cn("flex flex-col gap-3", className)}>
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
      {open && undescribed && (
        <Button
          variant="outline"
          size="xs"
          className="self-start"
          onClick={() => run(() => api.invoke("video:replan", ids))}
        >
          Lên lại dàn dựng
        </Button>
      )}
      <ol className="flex flex-col divide-y divide-border">
        {job.shots.map((shot) => (
          <Scene
            key={shot.index}
            shot={shot}
            name={nameOf(shot)}
            framing={sceneFraming(shot, keyframes)}
            directed={Boolean(directionAt(job.direction, shot.text))}
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

/**
 * One scene: its number, framing and length; the words heard, then who says
 * them; what the viewer sees, which the operator can rewrite while nothing is
 * spent (the video is then planned again with it).
 */
function Scene({
  shot,
  name,
  framing,
  directed,
  editing,
  editable,
  onEdit,
  onCancel,
  onSave,
}: {
  shot: JobShot;
  name: string;
  framing: string;
  directed: boolean;
  editing: boolean;
  editable: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (value: string) => void;
}) {
  const brief = sceneBrief(shot);
  const seen = brief ?? <span className="text-muted-foreground/60">Chưa có mô tả</span>;
  return (
    <li className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground tabular-nums">
          Cảnh {shot.index + 1}
        </span>
        <Badge>{framing}</Badge>
        {sceneMoves(shot) && <Badge>Chuyển động</Badge>}
        {directed && <Badge variant="secondary">Theo ý bạn</Badge>}
        <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
          {sceneSeconds(shot)} giây
        </span>
      </div>
      <p className="text-sm leading-relaxed text-foreground" data-selectable>
        “
        {spokenParts(shot.text).map((part, i, all) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed line, never reordered.
          <span key={i} className={cn(part.sound && "text-muted-foreground")}>
            {part.text}
            {i < all.length - 1 ? " " : ""}
          </span>
        ))}
        ”
        {name && (
          <span className="ml-1.5 text-xs whitespace-nowrap text-muted-foreground">{name}</span>
        )}
      </p>
      {editing ? (
        <Textarea
          autoFocus
          rows={1}
          defaultValue={brief ?? ""}
          aria-label={`Cảnh ${shot.index + 1}`}
          className="field-sizing-content -mx-1.5 w-[calc(100%+--spacing(3))] px-1.5 py-1 text-sm"
          onFocus={(e) => {
            const end = e.currentTarget.value.length;
            e.currentTarget.setSelectionRange(end, end);
          }}
          onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSave(e.currentTarget.value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onCancel();
            }
          }}
          onBlur={onCancel}
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

/** The writer's staging note, once, above the list, with library tags shown as names. */
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
