import { canUseCut, clearShot, cutOf, FixError, settled, withCut } from "./video-fix";
import {
  costToFinishUsd,
  cutCostUsd,
  type JobCut,
  type JobTake,
  madeByProvider,
  spentUsd,
  type TakeLedger,
  type VideoJob,
} from "./video-job";
import { fitResolution, videoModel } from "./video-models";

export const workingModel = (job: Pick<VideoJob, "model">) => videoModel(job.model).id;

export const chosenModel = (job: VideoJob) => job.chosen ?? workingModel(job);

export function takeModels(job: VideoJob): string[] {
  const all = [workingModel(job), ...(job.takes ?? []).map((t) => t.model)];
  const order = (job.takeOrder ?? []).filter((m) => all.includes(m));
  return [...order, ...all.filter((m) => !order.includes(m))];
}

export const canSwitch = (job: VideoJob) =>
  settled(job) && job.status !== "running" && job.status !== "waiting";

const park = (job: VideoJob): JobTake => ({
  model: workingModel(job),
  resolution: job.resolution,
  status: job.status,
  cut: cutOf(job),
  previous: job.previous,
});

export function viewTake(job: VideoJob, model: string): VideoJob {
  if (model === workingModel(job)) return job;
  const take = job.takes?.find((t) => t.model === model);
  if (!take || !canUseCut(job, take.cut)) return job;
  return {
    ...withCut(job, take.cut),
    model: take.model,
    resolution: take.resolution,
    status: take.status,
    previous: take.previous,
  };
}

export const chosenView = (job: VideoJob) => viewTake(job, chosenModel(job));

const cutShared = (cut: Pick<JobCut, "voiceCostUsd" | "frames">) =>
  (cut.voiceCostUsd ?? 0) + cut.frames.reduce((n, f) => n + (f.costUsd ?? 0), 0);

const cutShots = (cut: Pick<JobCut, "shots">) =>
  cut.shots.reduce((n, s) => n + (s.costUsd ?? 0), 0);

function ledgerOf(job: VideoJob): TakeLedger {
  if (job.takeLedger) return job.takeLedger;
  const total = spentUsd(job);
  const working = workingModel(job);
  if (!job.takes?.length) {
    const shared = cutShared(job);
    return { shared, spent: { [working]: total - shared }, since: total };
  }
  const cuts: [string, JobCut][] = [
    [working, cutOf(job)],
    ...job.takes.map((t): [string, JobCut] => [t.model, t.cut]),
  ];
  const shared = cuts.reduce((n, [, c]) => n + cutShared(c), 0);
  const spent = Object.fromEntries(cuts.map(([m, c]) => [m, cutShots(c)]));
  const sum = shared + Object.values(spent).reduce((n, v) => n + v, 0);
  return Math.abs(sum - total) < 0.01
    ? { shared, spent, since: total }
    : { shared: 0, spent: {}, since: total, unknown: true };
}

function closedLedger(job: VideoJob): TakeLedger {
  const ledger = ledgerOf(job);
  const total = spentUsd(job);
  const working = workingModel(job);
  return {
    ...ledger,
    spent: { ...ledger.spent, [working]: (ledger.spent[working] ?? 0) + total - ledger.since },
    since: total,
  };
}

export function takeCostUsd(job: VideoJob, model: string): number | null {
  const ledger = closedLedger(job);
  return ledger.unknown ? null : ledger.shared + (ledger.spent[model] ?? 0);
}

function swapIn(
  job: VideoJob,
  next: Pick<JobTake, "model" | "resolution" | "status" | "previous"> & { cut: JobCut },
  takes: JobTake[],
  now: string,
): VideoJob {
  const total = spentUsd(job);
  const swapped: VideoJob = {
    ...withCut(job, next.cut),
    model: next.model,
    resolution: next.resolution,
    status: next.status,
    previous: next.previous,
    takes,
    takeOrder: takeModels(job).includes(next.model)
      ? takeModels(job)
      : [...takeModels(job), next.model],
    chosen: chosenModel(job),
    takeLedger: closedLedger(job),
    error: undefined,
    phaseStartedAt: undefined,
    assembleProgress: undefined,
    updatedAt: now,
  };
  return { ...swapped, pastCostUsd: total - cutCostUsd(swapped) };
}

export function focusTake(job: VideoJob, model: string, now: string): VideoJob {
  if (model === workingModel(job)) return job;
  const take = job.takes?.find((t) => t.model === model);
  if (!take) throw new FixError("Không có bản này");
  if (!canSwitch(job)) throw new FixError("Đợi video đang tạo xong rồi thử lại");
  const others = (job.takes ?? []).filter((t) => t.model !== model);
  return swapIn(job, take, [...others, park(job)], now);
}

export function startTake(job: VideoJob, model: string, now: string): VideoJob {
  const id = videoModel(model).id;
  if (takeModels(job).includes(id)) throw new FixError("Video đã có bản này");
  if (!job.final || job.status !== "done") throw new FixError("Video chưa xong");
  if (job.live) throw new FixError("Video dựng theo kế hoạch cảnh không làm bản với mẫu khác");
  if (!canSwitch(job)) throw new FixError("Đợi video đang tạo xong rồi thử lại");
  const resolution = fitResolution(id, job.resolution ?? "720p");
  const sameSize = resolution === (job.resolution ?? "720p");
  const cut: JobCut = {
    ...cutOf(job),
    voiceCostUsd: 0,
    frames: job.frames.map((f) => ({ ...f, costUsd: undefined })),
    shots: job.shots.map((s) =>
      madeByProvider(s) || !sameSize ? clearShot(s) : { ...s, costUsd: undefined },
    ),
    final: undefined,
    finalSec: undefined,
    cutRev: undefined,
  };
  const started = swapIn(
    { ...job, rev: (job.rev ?? 0) + 1 },
    { model: id, resolution, status: "waiting", cut, previous: undefined },
    [...(job.takes ?? []), park(job)],
    now,
  );
  return { ...started, queuedAt: now };
}

export const takePriceUsd = (job: VideoJob, model: string, now: string) =>
  costToFinishUsd(startTake(job, model, now));

export function chooseTake(job: VideoJob, model: string, now: string): VideoJob {
  if (!takeModels(job).includes(model)) throw new FixError("Không có bản này");
  if (!viewTake(job, model).final) throw new FixError("Bản này chưa xong");
  return { ...job, chosen: model, updatedAt: now };
}

const cutFiles = (cut: JobCut | undefined): string[] =>
  cut
    ? [
        cut.final,
        cut.dialogue,
        cut.dialogue && `${cut.dialogue}.timing.json`,
        ...cut.frames.map((f) => f.file),
        ...cut.shots.flatMap((s) => [s.clip, s.audio]),
      ].filter((f): f is string => Boolean(f))
    : [];

export function deleteTake(
  job: VideoJob,
  model: string,
  now: string,
): { job: VideoJob; files: string[] } {
  if (model === chosenModel(job)) throw new FixError("Đây là bản đang dùng");
  if (!takeModels(job).includes(model)) throw new FixError("Không có bản này");
  const base = model === workingModel(job) ? focusTake(job, chosenModel(job), now) : job;
  const gone = base.takes?.find((t) => t.model === model);
  const remaining = (base.takes ?? []).filter((t) => t.model !== model);
  const next: VideoJob = {
    ...base,
    takes: remaining.length ? remaining : undefined,
    takeOrder: takeModels(base).filter((m) => m !== model),
    updatedAt: now,
  };
  const kept = new Set([
    ...cutFiles(cutOf(next)),
    ...cutFiles(next.previous),
    ...remaining.flatMap((t) => [...cutFiles(t.cut), ...cutFiles(t.previous)]),
  ]);
  const files = [...cutFiles(gone?.cut), ...cutFiles(gone?.previous)].filter((f) => !kept.has(f));
  return { job: next, files: [...new Set(files)] };
}
