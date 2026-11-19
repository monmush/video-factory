import type { DirectionEntry } from "./direction";
import type { ScriptLine } from "./ipc";
import { costTable, fitDuration, type LiveDirection, plannedShotSec, planSteps } from "./live-plan";
import { coverageErrors, type ShotPlan } from "./shot-plan";
import { applyLivePlan, applyPlan, spokenLines, type VideoJob } from "./video-job";

export interface NamedProduct {
  id: string;
  name: string;
}

export type ProductFollow =
  | { kind: "patched"; job: VideoJob }
  | {
      kind: "replan";
      why: "no-plan" | "several" | "no-product" | "no-product-shot" | "unknown-product" | "lines";
    };

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function swapName(text: string, from: string, to: string): string {
  const name = norm(from);
  if (!name) return text;
  return text.replace(new RegExp(escapeRegExp(name).replace(/ /g, "\\s+"), "giu"), to);
}

function plannedProducts(job: VideoJob): string[] {
  if (job.productIds) return job.productIds;
  const ids = (job.plan?.shots ?? []).flatMap((s) => (s.productId ? [s.productId] : []));
  return [...new Set(ids)];
}

export function followProduct(
  job: VideoJob,
  script: { lines: ScriptLine[]; productIds: string[] },
  product: (id: string) => NamedProduct | null,
  cutoutsFor: (productId: string) => number,
): ProductFollow {
  const plan = job.plan;
  if (!plan) return { kind: "replan", why: "no-plan" };
  const before = plannedProducts(job);
  const after = script.productIds;
  if (before.length > 1 || after.length > 1) return { kind: "replan", why: "several" };
  const toId = after[0];
  if (!toId) return { kind: "replan", why: "no-product" };
  if (!plan.shots.some((s) => s.productId)) return { kind: "replan", why: "no-product-shot" };
  const to = product(toId);
  const from = before[0] ? product(before[0]) : null;
  if (!to) return { kind: "replan", why: "unknown-product" };
  const swap = (text: string) => (from ? swapName(text, from.name, to.name) : text);

  const lines = spokenLines(script.lines).map((l) => ({ ...l, text: l.text.trim() }));
  if (lines.length !== job.lines.length) return { kind: "replan", why: "lines" };
  const renamed = new Set<number>();
  for (const [i, line] of lines.entries()) {
    const old = job.lines[i] as ScriptLine;
    if (old.characterId !== line.characterId) return { kind: "replan", why: "lines" };
    if (norm(old.text) === norm(line.text)) continue;
    if (norm(swap(old.text)) !== norm(line.text)) return { kind: "replan", why: "lines" };
    renamed.add(i);
  }

  const shots = plan.shots.map((s) => ({
    ...s,
    productId: s.productId ? to.id : null,
    text: renamed.has(s.line) ? swap(s.text) : s.text,
    visual: swap(s.visual),
    why: swap(s.why),
    ...(s.brief ? { brief: swap(s.brief) } : {}),
  }));
  if (coverageErrors(shots, lines).length) return { kind: "replan", why: "lines" };
  const nextPlan: ShotPlan = { ...plan, shots };

  const direction: DirectionEntry[] | undefined = job.direction?.map((d) =>
    d.words ? { ...d, words: swap(d.words) } : d,
  );
  const base: VideoJob = {
    ...job,
    lines,
    productIds: [to.id],
    ...(direction ? { direction } : {}),
  };
  const followed = job.live
    ? applyLivePlan(base, followLive(job.live, nextPlan, lines, renamed))
    : applyPlan(base, nextPlan);
  return {
    kind: "patched",
    job: {
      ...followed,
      frames: followed.frames.map((f) =>
        f.kind === "product" && f.productId ? { ...f, cutouts: cutoutsFor(f.productId) } : f,
      ),
    },
  };
}

function followLive(
  live: LiveDirection,
  shots: ShotPlan,
  lines: ScriptLine[],
  renamed: ReadonlySet<number>,
): LiveDirection {
  const routes = live.plan.routes.map((r, i) => {
    const shot = shots.shots[i];
    if (r.route !== "motion" || !r.endpoint || !r.input || !shot || !renamed.has(shot.line)) {
      return r;
    }
    return {
      ...r,
      input: fitDuration(live.schemas[r.endpoint], r.input, plannedShotSec(shot)).input,
    };
  });
  const plan = { ...live.plan, shots, routes };
  const steps = planSteps(plan, lines);
  return {
    ...live,
    plan,
    costs: costTable(
      steps,
      live.rates,
      live.schemas,
      live.costs.budgetUsd,
      steps.reduce((n, s) => n + s.seconds, 0),
    ),
  };
}
