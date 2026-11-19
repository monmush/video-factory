import { coverageErrors, holdErrors, type PlannedShot, type ShotPlan } from "./shot-plan";
import {
  costToFinishUsd,
  cutCostUsd,
  frameFor,
  frameIdFor,
  hasInput,
  isGenerated,
  type JobCut,
  type JobFrame,
  type JobShot,
  madeByProvider,
  spentUsd,
  type VideoJob,
} from "./video-job";

export type FixChange =
  | { op: "redo_shot"; shot: number; visual?: string }
  | { op: "redo_still"; frame: string; note?: string }
  | { op: "replace_line"; line: number; shots: PlannedShot[] }
  | { op: "redo_voice" };

export const canFix = (job: VideoJob) =>
  (job.status === "done" && Boolean(job.final)) || job.status === "review";

export const cutOf = (job: VideoJob): JobCut => ({
  plan: job.plan,
  dialogue: job.dialogue,
  dialogueSec: job.dialogueSec,
  voiceCostUsd: job.voiceCostUsd,
  voiceChars: job.voiceChars,
  lineSpans: job.lineSpans,
  frames: job.frames,
  shots: job.shots,
  ...(job.live ? { routes: job.live.plan.routes } : {}),
  final: job.final,
  finalSec: job.finalSec,
  cutRev: job.cutRev,
});

const sameLayout = (a: JobShot[], b: JobShot[]) =>
  a.length === b.length &&
  a.every((s, i) => {
    const o = b[i] as JobShot;
    return (
      s.lineIndex === o.lineIndex &&
      s.kind === o.kind &&
      s.characterId === o.characterId &&
      s.route === o.route &&
      s.keyframe === o.keyframe
    );
  });

const OLD_CUT = "Bản này được lưu theo cách dựng cũ, không quay lại được";

export function canUseCut(job: VideoJob, cut: JobCut): boolean {
  return !job.live || Boolean(cut.routes) || sameLayout(job.shots, cut.shots);
}

export function withCut(job: VideoJob, cut: JobCut): VideoJob {
  const { routes, ...fields } = cut;
  const next: VideoJob = { ...job, ...fields };
  if (!job.live) return next;
  if (routes) return { ...next, live: { ...job.live, plan: { ...job.live.plan, routes } } };
  if (sameLayout(job.shots, cut.shots)) return next;
  throw new FixError(OLD_CUT);
}

export const clearShot = (s: JobShot): JobShot => ({
  ...s,
  state: hasInput(s) ? "queued" : "planned",
  clip: undefined,
  clipSec: undefined,
  requestId: undefined,
  submittedAt: undefined,
  sending: undefined,
  resultUrl: undefined,
  costUsd: undefined,
  model: undefined,
  retried: false,
  failures: 0,
  error: undefined,
});

const clearFrame = (f: JobFrame, note?: string): JobFrame => ({
  ...f,
  file: undefined,
  plate: undefined,
  source: undefined,
  requestId: undefined,
  submittedAt: undefined,
  sending: undefined,
  resultUrl: undefined,
  costUsd: undefined,
  retried: false,
  redone: false,
  check: undefined,
  error: undefined,
  ...(note?.trim() ? { note: note.trim() } : {}),
});

export class FixError extends Error {}

export function applyFix(job: VideoJob, changes: FixChange[], now: string): VideoJob {
  if (!canFix(job)) throw new FixError("Video này đang được tạo, chưa sửa được");
  if (!changes.length) throw new FixError("Không có gì để sửa");
  const total = spentUsd(job);
  let next: VideoJob = {
    ...job,
    rev: (job.rev ?? 0) + 1,
    ...(job.final
      ? { previous: cutOf(job), final: undefined, finalSec: undefined, cutRev: undefined }
      : {}),
  };
  for (const change of changes) next = applyChange(next, change);
  return {
    ...next,
    status: "waiting",
    queuedAt: now,
    updatedAt: now,
    error: undefined,
    phaseStartedAt: undefined,
    assembleProgress: undefined,
    pastCostUsd: total - cutCostUsd(next),
  };
}

function applyChange(job: VideoJob, change: FixChange): VideoJob {
  switch (change.op) {
    case "redo_shot":
      return redoShot(job, change.shot, change.visual);
    case "redo_still":
      return redoStill(job, change.frame, change.note);
    case "replace_line":
      return replaceLine(job, change.line, change.shots);
    case "redo_voice":
      return {
        ...job,
        dialogue: undefined,
        dialogueSec: undefined,
        voiceCostUsd: undefined,
        voiceChars: undefined,
        lineSpans: undefined,
        shots: job.shots.map((s) => ({
          ...clearShot(s),
          state: "planned",
          start: undefined,
          end: undefined,
          audio: undefined,
          audioSec: undefined,
        })),
      };
  }
}

function shotAt(job: VideoJob, index: number): JobShot {
  const shot = job.shots[index];
  if (!shot) throw new FixError(`Không có cảnh ${index + 1}. Video có ${job.shots.length} cảnh.`);
  return shot;
}

function redoShot(job: VideoJob, index: number, visual?: string): VideoJob {
  const shot = shotAt(job, index);
  const withVisual = (s: JobShot) =>
    s.index === index && visual?.trim() ? { ...s, visual: visual.trim() } : s;
  if (madeByProvider(shot)) {
    return {
      ...job,
      shots: job.shots.map((s) => (s.index === index ? clearShot(withVisual(s)) : s)),
    };
  }
  const frame = frameFor(job, shot);
  if (!frame || !isGenerated(job, frame)) {
    throw new FixError(`Cảnh ${index + 1} dùng ảnh gốc của sản phẩm nên không tạo lại được`);
  }
  return {
    ...job,
    frames: job.frames.map((f) => (f.id === frame.id ? clearFrame(f) : f)),
    shots: job.shots.map((s) =>
      frameIdFor(s) === frame.id ? clearShot(withVisual(s)) : withVisual(s),
    ),
  };
}

function redoStill(job: VideoJob, frameId: string, note?: string): VideoJob {
  const frame = job.frames.find((f) => f.id === frameId);
  if (!frame) throw new FixError("Không tìm thấy khung hình này");
  if (!isGenerated(job, frame)) {
    throw new FixError("Khung hình này là ảnh gốc nên không tạo lại được");
  }
  return {
    ...job,
    frames: job.frames.map((f) => (f.id === frameId ? clearFrame(f, note) : f)),
    shots: job.shots.map((s) => (frameIdFor(s) === frameId ? clearShot(s) : s)),
  };
}

const sameShot = (old: JobShot, p: PlannedShot) =>
  old.kind === p.kind &&
  old.characterId === p.characterId &&
  old.framing === p.framing &&
  old.text === p.text &&
  old.productId === p.productId &&
  (madeByProvider(old) || old.visual === p.visual);

function replaceLine(job: VideoJob, line: number, parts: PlannedShot[]): VideoJob {
  const plan = job.plan;
  if (!plan || !job.lines[line]) throw new FixError(`Không có câu thoại ${line + 1}`);
  const before = plan.shots.filter((s) => s.line < line);
  const after = plan.shots.filter((s) => s.line > line);
  const replaced = plan.shots.filter((s) => s.line === line);
  const planned = [...before, ...parts.map((p) => ({ ...p, line })), ...after];
  const errors = [...coverageErrors(planned, job.lines), ...holdErrors(planned)];
  if (errors.length) throw new FixError(errors.join(" "));
  for (const p of parts) {
    const speaker = job.lines[line]?.characterId;
    if (p.kind === "speaker" && p.characterId !== speaker) {
      throw new FixError("A speaker shot must show the person saying the line.");
    }
    if (p.kind === "listener" && (!p.characterId || p.characterId === speaker)) {
      throw new FixError("A listener shot must show someone other than the speaker.");
    }
    if (!job.useEnvironment && (p.kind === "wide" || (p.kind === "detail" && !p.productId))) {
      throw new FixError("Series chưa có bối cảnh nên chưa có cảnh rộng hay cảnh cận đồ vật");
    }
  }

  const delta = parts.length - replaced.length;
  const spare = job.shots.filter((s) => s.lineIndex === line);
  const origin = new Map<number, number>();
  const shots: JobShot[] = planned.map((p, index) => {
    let old: JobShot | undefined;
    if (p.line < line) old = job.shots[index];
    else if (p.line > line) old = job.shots[index - delta];
    else {
      const at = spare.findIndex((s) => sameShot(s, p));
      if (at >= 0) old = spare.splice(at, 1)[0];
    }
    if (old) {
      origin.set(index, old.index);
      const sameLengthSoReused = (old.hold ?? 0) === (p.hold ?? 0);
      return sameLengthSoReused
        ? { ...old, index }
        : { ...clearShot({ ...old, index }), hold: p.hold };
    }
    return {
      index,
      kind: p.kind,
      framing: p.framing,
      lineIndex: p.line,
      characterId: p.characterId,
      speaker: job.lines[p.line]?.speaker ?? "",
      text: p.text,
      visual: p.visual,
      productId: p.productId,
      ...(p.hold ? { hold: p.hold } : {}),
      ...plannedStart(job, p),
      state: "planned",
      retried: false,
      failures: 0,
    };
  });
  const holdsOf = (list: { hold?: number }[]) => list.map((s) => s.hold ?? 0).join();
  const placed =
    holdsOf(replaced) === holdsOf(parts)
      ? shots
      : shots.map((s) => ({
          ...s,
          start: undefined,
          end: undefined,
          state: s.state === "queued" ? ("planned" as const) : s.state,
        }));

  const pictured = new Set(placed.filter((s) => s.keyframe).map(frameIdFor));
  const frames: JobFrame[] = job.frames.filter(
    (f) => f.kind === "wide" || f.kind === "character" || pictured.has(f.id),
  );
  const add = (frame: JobFrame) => {
    if (!frames.some((f) => f.id === frame.id)) frames.push(frame);
  };
  for (const shot of placed) {
    const id = frameIdFor(shot);
    if (shot.kind === "wide") {
      add({ id, kind: "wide", retried: false });
      frames.sort((a, b) => Number(b.kind === "wide") - Number(a.kind === "wide"));
    } else if (madeByProvider(shot) && shot.characterId) {
      add({ id, kind: "character", characterId: shot.characterId, retried: false });
    } else if (shot.kind === "detail") {
      const from = origin.get(shot.index);
      const old =
        from === undefined
          ? undefined
          : job.frames.find((f) => f.id === frameIdFor(job.shots[from] as JobShot));
      add(
        old
          ? { ...old, id, shot: shot.index }
          : shot.productId
            ? { id, kind: "product", shot: shot.index, productId: shot.productId, retried: false }
            : { id, kind: "detail", shot: shot.index, retried: false },
      );
    }
  }

  const lastOld = before.length + replaced.length - 1;
  const nextPlan: ShotPlan = {
    ...plan,
    shots: planned,
    stateChanges: plan.stateChanges.map((c) =>
      c.fromShot > lastOld ? { ...c, fromShot: c.fromShot + delta } : c,
    ),
  };
  return { ...job, plan: nextPlan, shots: placed, frames, ...liveAfterFix(job, placed, origin) };
}

function plannedStart(job: VideoJob, p: PlannedShot): Pick<JobShot, "keyframe" | "route"> {
  const live = job.live;
  if (!live) return {};
  const pictures = live.plan.keyframes;
  if (p.kind === "wide") {
    const master = pictures.find((k) => k.kind === "master");
    return master ? { keyframe: master.id, route: "still-move" } : {};
  }
  if ((p.kind === "speaker" || p.kind === "listener") && p.characterId) {
    const own = pictures.filter((k) => k.kind === "character" && k.characterId === p.characterId);
    const medium = (framing: string) => /medium/i.test(framing);
    const pick = own.find((k) => medium(k.framing) === (p.framing === "medium_close")) ?? own[0];
    if (!pick) return {};
    return { keyframe: pick.id, route: p.kind === "speaker" ? "lip-sync" : "still-move" };
  }
  return {};
}

function liveAfterFix(
  job: VideoJob,
  shots: JobShot[],
  origin: Map<number, number>,
): Pick<VideoJob, "live"> {
  const live = job.live;
  if (!live) return {};
  const routes = shots.map((s) => {
    const from = origin.get(s.index);
    const kept = from === undefined ? undefined : live.plan.routes[from];
    if (kept) return kept;
    const keyframe = s.keyframe ?? null;
    if (s.route === "lip-sync") {
      const same = live.plan.routes.find(
        (r, i) => r.route === "lip-sync" && job.shots[i]?.characterId === s.characterId,
      );
      const any = same ?? live.plan.routes.find((r) => r.route === "lip-sync");
      if (any) return { ...any, keyframe };
    }
    return { route: s.route ?? ("still-move" as const), keyframe, endpoint: null, input: null };
  });
  return { live: { ...live, plan: { ...live.plan, routes } } };
}

export function fixPriceUsd(job: VideoJob, changes: FixChange[], now: string): number {
  return Math.max(0, costToFinishUsd(applyFix(job, changes, now)) - costToFinishUsd(job));
}

export function fixScope(job: VideoJob, changes: FixChange[], now: string) {
  const fixed = applyFix(job, changes, now);
  const before = new Set(job.shots.filter((s) => s.state === "done").map((s) => s.clip));
  return {
    shots: fixed.shots.filter((s) => s.state !== "done" || !before.has(s.clip)).length,
    stills: fixed.frames.filter((f) => !f.file && isGenerated(fixed, f)).length,
    voice: !fixed.dialogue,
  };
}

export const settled = (job: VideoJob) =>
  !job.shots.some((s) => s.state === "rendering") &&
  !job.frames.some((f) => !f.file && f.requestId);

export const previousIsNewer = (job: VideoJob) => (job.previous?.cutRev ?? 0) > (job.cutRev ?? 0);

export const canRestore = (job: VideoJob) =>
  Boolean(job.previous?.final && canUseCut(job, job.previous)) &&
  settled(job) &&
  job.status !== "running" &&
  job.status !== "waiting";

export function restorePrevious(job: VideoJob, now: string): VideoJob {
  if (!job.previous?.final) throw new FixError("Không có bản trước");
  if (!canUseCut(job, job.previous)) throw new FixError(OLD_CUT);
  if (!canRestore(job)) throw new FixError("Đợi các cảnh đang quay xong rồi thử lại");
  const total = spentUsd(job);
  const next: VideoJob = { ...withCut(job, job.previous), previous: cutOf(job) };
  return {
    ...next,
    status: "done",
    updatedAt: now,
    error: undefined,
    assembleProgress: undefined,
    pastCostUsd: total - cutCostUsd(next),
  };
}
