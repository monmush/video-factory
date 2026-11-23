import { recipeModels, routeAtLevel } from "./build-direction";
import { soundsCostUsd, spentUsd } from "./cost/charges";
import { costToFinishUsd, withFirstPass } from "./cost/estimate";
import type { LiveDirection, PlannedRoute } from "./live-plan";
import { type MediaLevel, mediaLevel, OFFERED_LEVELS } from "./media-level";
import { builtinRecipe, type RoleModel } from "./recipe";
import { routeAvoidingRejectedSpeakers, withSpeakers } from "./speaker-switch";
import { canUseCut, clearShot, cutOf, FixError, settled, withCut } from "./video-fix";
import {
  billedSeconds,
  isNative,
  type JobCut,
  type JobShot,
  type JobTake,
  liveSeconds,
  madeByProvider,
  shotModel,
  type TakeLedger,
  type VideoJob,
  withJobSounds,
} from "./video-job";
import { fitResolution, videoModel } from "./video-models";

export const versionsByLevel = (job: Pick<VideoJob, "level" | "takes">) =>
  Boolean(job.level) && !(job.takes ?? []).some((t) => !t.level);

export const workingVersion = (job: VideoJob) =>
  versionsByLevel(job) ? mediaLevel(job.level).id : videoModel(job.model).id;

const versionOfTake = (job: VideoJob, take: JobTake) =>
  versionsByLevel(job) ? mediaLevel(take.level).id : take.model;

const takeOf = (job: VideoJob, version: string) =>
  job.takes?.find((t) => versionOfTake(job, t) === version);

const DELETED = "deleted-versions";

export const chosenVersion = (job: VideoJob) => job.chosen ?? workingVersion(job);

export function versions(job: VideoJob): string[] {
  const all = [workingVersion(job), ...(job.takes ?? []).map((t) => versionOfTake(job, t))];
  const order = (job.takeOrder ?? []).filter((v) => all.includes(v));
  return [...order, ...all.filter((v) => !order.includes(v))];
}

export const versionLabel = (job: VideoJob, version: string) =>
  versionsByLevel(job) ? mediaLevel(version).label : `Bản ${versions(job).indexOf(version) + 1}`;

export const canSwitch = (job: VideoJob) =>
  settled(job) && job.status !== "running" && job.status !== "waiting";

const park = (job: VideoJob): JobTake => ({
  model: videoModel(job.model).id,
  ...(job.level ? { level: job.level } : {}),
  resolution: job.resolution,
  status: job.status,
  cut: cutOf(job),
  previous: job.previous,
});

export function viewVersion(job: VideoJob, version: string): VideoJob {
  if (version === workingVersion(job)) return job;
  const take = takeOf(job, version);
  if (!take || !canUseCut(job, take.cut)) return job;
  return {
    ...withCut(job, take.cut),
    model: take.model,
    ...(take.level ? { level: take.level } : {}),
    resolution: take.resolution,
    status: take.status,
    previous: take.previous,
  };
}

export const chosenView = (job: VideoJob) => viewVersion(job, chosenVersion(job));

const cutShared = (cut: Pick<JobCut, "voiceCostUsd" | "frames" | "sounds">) =>
  (cut.voiceCostUsd ?? 0) +
  cut.frames.reduce((n, f) => n + (f.costUsd ?? 0), 0) +
  soundsCostUsd(cut.sounds);

const cutShots = (cut: Pick<JobCut, "shots">) =>
  cut.shots.reduce((n, s) => n + (s.costUsd ?? 0), 0);

function ledgerOf(job: VideoJob): TakeLedger {
  if (job.takeLedger) return job.takeLedger;
  const total = spentUsd(job);
  if (!job.takes?.length)
    return { shared: 0, spent: { [workingVersion(job)]: total }, since: total };
  const cuts: [string, JobCut][] = [
    [workingVersion(job), cutOf(job)],
    ...job.takes.map((t): [string, JobCut] => [versionOfTake(job, t), t.cut]),
  ];
  const shared = cuts.reduce((n, [, c]) => n + cutShared(c), 0);
  const spent = Object.fromEntries(cuts.map(([v, c]) => [v, cutShots(c)]));
  const sum = shared + Object.values(spent).reduce((n, v) => n + v, 0);
  return Math.abs(sum - total) < 0.01
    ? { shared, spent, since: total }
    : { shared: 0, spent: {}, since: total, unknown: true };
}

function closedLedger(job: VideoJob): TakeLedger {
  const ledger = ledgerOf(job);
  const total = spentUsd(job);
  const working = workingVersion(job);
  return {
    ...ledger,
    spent: { ...ledger.spent, [working]: (ledger.spent[working] ?? 0) + total - ledger.since },
    since: total,
  };
}

export function versionCostUsd(job: VideoJob, version: string): number | null {
  const ledger = closedLedger(job);
  return ledger.unknown ? null : ledger.shared + (ledger.spent[version] ?? 0);
}

export function versionView(job: VideoJob, version: string): VideoJob {
  const view = viewVersion(job, version);
  if (versions(job).length < 2) return view;
  return { ...view, charges: (job.charges ?? []).filter((c) => c.version === version) };
}

function swapIn(
  job: VideoJob,
  version: string,
  next: JobTake,
  takes: JobTake[],
  now: string,
): VideoJob {
  const order = versions(job);
  return {
    ...withCut(job, next.cut),
    model: next.model,
    ...(next.level ? { level: next.level } : {}),
    resolution: next.resolution,
    status: next.status,
    previous: next.previous,
    takes,
    takeOrder: order.includes(version) ? order : [...order, version],
    chosen: chosenVersion(job),
    takeLedger: closedLedger(job),
    error: undefined,
    phaseStartedAt: undefined,
    assembleProgress: undefined,
    updatedAt: now,
  };
}

export function focusVersion(job: VideoJob, version: string, now: string): VideoJob {
  if (version === workingVersion(job)) return job;
  const take = takeOf(job, version);
  if (!take) throw new FixError("Không có bản này");
  if (!canSwitch(job)) throw new FixError("Đợi video đang tạo xong rồi thử lại");
  const others = (job.takes ?? []).filter((t) => t !== take);
  const proposalsForTheOtherVersionGoStale = { ...job, rev: (job.rev ?? 0) + 1 };
  return swapIn(proposalsForTheOtherVersionGoStale, version, take, [...others, park(job)], now);
}

export function planAtLevel(job: VideoJob, levelId: string): VideoJob | null {
  const level = mediaLevel(levelId);
  const was = mediaLevel(job.level);
  const live = job.live;
  if (!live || was.motion !== level.motion || was.sound !== level.sound) return null;
  const recipe = builtinRecipe(level);
  const ambient = (id: string | null) => job.plan?.seats.find((s) => s.characterId === id)?.ambient;
  const routes = job.shots.map((shot, i) => {
    const route = live.plan.routes[i];
    if (!route) return route;
    return routeAtLevel(recipe, {
      kind: shot.kind,
      seconds: liveSeconds(shot),
      ambient: ambient(shot.characterId),
      wasMoving: was.motion,
      routes: [route],
    });
  });
  if (routes.some((r) => !r)) return null;
  const models = recipeModels(recipe);
  return {
    ...job,
    level: level.id,
    model: videoModel(level.speaker).id,
    resolution: level.output,
    live: {
      ...live,
      rates: { ...models.rates, ...live.rates },
      schemas: { ...models.schemas, ...live.schemas },
      plan: { ...live.plan, routes: routes as PlannedRoute[], level: level.id },
    },
  };
}

export const levelsToTry = (job: VideoJob): MediaLevel[] =>
  versionsByLevel(job) && !isNative(job)
    ? OFFERED_LEVELS.filter((l) => !versions(job).includes(l.id))
    : [];

interface Source {
  cut: JobCut;
  resolution?: string;
}

const sameTimeline = (a: JobShot[], b: JobShot[]) =>
  a.length === b.length &&
  a.every((s, i) => {
    const o = b[i] as JobShot;
    return (
      s.lineIndex === o.lineIndex &&
      s.kind === o.kind &&
      s.characterId === o.characterId &&
      s.keyframe === o.keyframe &&
      s.start === o.start &&
      s.end === o.end
    );
  });

const sources = (job: VideoJob): Source[] =>
  [
    { cut: cutOf(job), resolution: job.resolution },
    ...(job.takes ?? []).map((t) => ({ cut: t.cut, resolution: t.resolution })),
  ].filter((s) => sameTimeline(job.shots, s.cut.shots));

const madeClip = (shot: JobShot | undefined): shot is JobShot =>
  Boolean(shot && shot.state === "done" && shot.clip);

const reused = (shot: JobShot): JobShot => ({ ...shot, costUsd: undefined, costBilled: undefined });

const remade = (shot: JobShot, route: PlannedRoute): JobShot =>
  clearShot({ ...shot, route: route.route, fallback: undefined, endpoint: undefined });

const paidRoute = (route: PlannedRoute) => route.route === "lip-sync" || route.route === "motion";

function sameClip(
  shot: JobShot,
  made: PlannedRoute,
  target: PlannedRoute,
  sizes: { made?: string; target: string },
): boolean {
  if (madeByProvider(shot) !== paidRoute(target) || made.keyframe !== target.keyframe) return false;
  if (paidRoute(target)) return made.route === target.route && made.endpoint === target.endpoint;
  return sizes.made === sizes.target && (made.route === target.route || Boolean(shot.fallback));
}

function plannedVersion(job: VideoJob, live: LiveDirection, level: MediaLevel) {
  const recipe = builtinRecipe(level);
  const from = sources(job);
  const resolution = level.output;
  const wasMoving = mediaLevel(job.level).motion;
  const ambient = (id: string | null) => job.plan?.seats.find((s) => s.characterId === id)?.ambient;
  const shots: JobShot[] = [];
  const routes: PlannedRoute[] = [];
  const speakers: RoleModel[] = [];
  job.shots.forEach((shot, i) => {
    const atLevel = routeAtLevel(recipe, {
      kind: shot.kind,
      seconds: liveSeconds(shot),
      ambient: ambient(shot.characterId),
      wasMoving,
      routes: from.flatMap((s) => s.cut.routes?.[i] ?? []),
    });
    const avoided = routeAvoidingRejectedSpeakers(atLevel, {
      kind: shot.kind,
      ambient: ambient(shot.characterId),
      rejectedSpeakers: shot.rejectedSpeakers,
      seconds: billedSeconds(shot),
    });
    if (avoided) speakers.push(avoided.speaker);
    const target = avoided?.route ?? atLevel;
    const made = from
      .map((s) => ({ shot: s.cut.shots[i], route: s.cut.routes?.[i], size: s.resolution }))
      .find(
        (c) =>
          madeClip(c.shot) &&
          c.route &&
          sameClip(c.shot, c.route, target, { made: c.size, target: resolution }),
      );
    shots.push(made?.shot ? reused(made.shot) : remade(shot, target));
    routes.push(made?.route ?? target);
  });
  const models = recipeModels(recipe);
  const kept = withSpeakers(live, speakers);
  const nextLive: LiveDirection = {
    ...kept,
    rates: { ...models.rates, ...kept.rates },
    schemas: { ...models.schemas, ...kept.schemas },
    plan: { ...live.plan, routes, level: level.id },
  };
  return { shots, routes, live: nextLive, model: videoModel(level.speaker).id, resolution };
}

function fixedVersion(job: VideoJob, level: MediaLevel) {
  const model = videoModel(level.speaker).id;
  const resolution = fitResolution(model, level.output);
  const from = sources(job);
  const shots = job.shots.map((shot, i) => {
    const made = from.find((s) => {
      const old = s.cut.shots[i];
      if (!madeClip(old) || s.resolution !== resolution) return false;
      return (
        !madeByProvider(old) || videoModel(old.model).id === shotModel({ model }, clearShot(old)).id
      );
    });
    const old = made?.cut.shots[i];
    return old ? reused(old) : clearShot(shot);
  });
  return { shots, routes: undefined, live: job.live, model, resolution };
}

function carriedSounds(job: VideoJob, level: MediaLevel): JobCut["sounds"] {
  if (!level.sound) return undefined;
  const made = job.sounds?.length
    ? job.sounds
    : sources(job).find((s) => s.cut.sounds?.length)?.cut.sounds;
  return made?.map((s) => ({ ...s, costUsd: undefined, costBilled: undefined }));
}

export function startVersion(job: VideoJob, levelId: string, now: string): VideoJob {
  const level = mediaLevel(levelId);
  if (!versionsByLevel(job)) throw new FixError("Video này làm theo cách cũ, chưa thử được");
  if (isNative(job)) throw new FixError("Video tự tạo giọng nói chưa thử được chất lượng khác");
  if (!level.offered) throw new FixError("Không có chất lượng này");
  if (versions(job).includes(level.id)) throw new FixError("Video đã có bản này");
  if (!job.final || job.status !== "done") throw new FixError("Video chưa xong");
  if (!canSwitch(job)) throw new FixError("Đợi video đang tạo xong rồi thử lại");
  const made = job.live ? plannedVersion(job, job.live, level) : fixedVersion(job, level);
  const sounds = carriedSounds(job, level);
  const cut: JobCut = {
    ...cutOf(job),
    voiceCostUsd: 0,
    frames: job.frames.map((f) => ({
      ...f,
      costUsd: undefined,
      costBilled: undefined,
      cutoutCostUsd: undefined,
      cutoutBilled: undefined,
    })),
    shots: made.shots,
    ...(made.routes ? { routes: made.routes } : {}),
    sounds,
    final: undefined,
    finalSec: undefined,
    cutRev: undefined,
    firstPass: undefined,
  };
  const started = swapIn(
    { ...job, rev: (job.rev ?? 0) + 1, ...(made.live ? { live: made.live } : {}) },
    level.id,
    {
      model: made.model,
      level: level.id,
      resolution: made.resolution,
      status: "waiting",
      cut,
      previous: undefined,
    },
    [...(job.takes ?? []), park(job)],
    now,
  );
  return withFirstPass(withJobSounds({ ...started, queuedAt: now }), now);
}

export const versionPriceUsd = (job: VideoJob, level: string, now: string) =>
  costToFinishUsd(startVersion(job, level, now));

export function chooseVersion(job: VideoJob, version: string, now: string): VideoJob {
  if (!versions(job).includes(version)) throw new FixError("Không có bản này");
  if (!viewVersion(job, version).final) throw new FixError("Bản này chưa xong");
  return { ...job, chosen: version, updatedAt: now };
}

const cutFiles = (cut: JobCut | undefined): string[] =>
  cut
    ? [
        cut.final,
        cut.dialogue,
        cut.dialogue && `${cut.dialogue}.timing.json`,
        ...cut.frames.flatMap((f) => [f.file, f.plate, f.cutout]),
        ...cut.shots.flatMap((s) => [s.clip, s.audio]),
        ...(cut.sounds ?? []).map((s) => s.file),
      ].filter((f): f is string => Boolean(f))
    : [];

export function deleteVersion(
  job: VideoJob,
  version: string,
  now: string,
): { job: VideoJob; files: string[] } {
  if (version === chosenVersion(job)) throw new FixError("Đây là bản đang dùng");
  if (!versions(job).includes(version)) throw new FixError("Không có bản này");
  const base = version === workingVersion(job) ? focusVersion(job, chosenVersion(job), now) : job;
  const gone = takeOf(base, version);
  const remaining = (base.takes ?? []).filter((t) => t !== gone);
  const ledger = closedLedger(base);
  const { [version]: spentOnIt = 0, ...stillShown } = ledger.spent;
  const next: VideoJob = {
    ...base,
    takes: remaining.length ? remaining : undefined,
    takeOrder: versions(base).filter((v) => v !== version),
    takeLedger: {
      ...ledger,
      spent: { ...stillShown, [DELETED]: (ledger.spent[DELETED] ?? 0) + spentOnIt },
    },
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
