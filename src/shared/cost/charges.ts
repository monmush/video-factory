import type { JobSound } from "../sound";
import type { JobCut, JobShot, VideoJob } from "../video-job";
import { COST_PARTS } from "./parts";

export type ChargeKind = "voice" | "still" | "cutout" | "speech" | "clip" | "motion" | "sound";

export interface Charge {
  at: string;
  kind: ChargeKind;
  step: string;
  usd: number;
  billed: boolean;
  requestId?: string;
  version?: string;
}

export const STEP = {
  voice: "voice",
  frame: (id: string) => `frame:${id}`,
  cutout: (frameId: string) => `cutout:${frameId}`,
  shot: (index: number) => `shot:${index}`,
  sound: (id: string) => `sound:${id}`,
  earlier: "earlier",
} as const;

export interface PaidItem {
  step: string;
  kind: ChargeKind;
  usd: number | null;
  billed: boolean;
  requestId?: string;
}

export const shotChargeKind = (shot: Pick<JobShot, "route" | "fallback">): ChargeKind =>
  shot.route === "motion" && !shot.fallback ? "motion" : "clip";

export function withCharge<J extends Pick<VideoJob, "charges">>(job: J, charge: Charge): J {
  const already = charge.requestId
    ? job.charges?.some((c) => c.requestId === charge.requestId)
    : false;
  if (already) return job;
  return { ...job, charges: [...(job.charges ?? []), charge] };
}

export const spentUsd = (job: Pick<VideoJob, "charges">) =>
  (job.charges ?? []).reduce((n, c) => n + c.usd, 0);

export const hasCalculatedCharge = (job: Pick<VideoJob, "charges">) =>
  (job.charges ?? []).some((c) => !c.billed);

export const soundsCostUsd = (sounds: readonly JobSound[] | undefined) =>
  (sounds ?? []).reduce((n, s) => n + (s.costUsd ?? 0), 0);

function coreInUse(cut: JobCut): PaidItem[] {
  const items: PaidItem[] = [];
  if (cut.voiceCostUsd !== undefined) {
    items.push({ step: STEP.voice, kind: "voice", usd: cut.voiceCostUsd, billed: false });
  }
  for (const f of cut.frames) {
    if (f.cutoutCostUsd !== undefined) {
      items.push({
        step: STEP.cutout(f.id),
        kind: "cutout",
        usd: f.cutoutCostUsd,
        billed: Boolean(f.cutoutBilled),
      });
    }
    if (f.costUsd !== undefined) {
      items.push({
        step: STEP.frame(f.id),
        kind: "still",
        usd: f.costUsd,
        billed: Boolean(f.costBilled),
        ...(f.requestId ? { requestId: f.requestId } : {}),
      });
    }
  }
  for (const s of cut.shots) {
    if (s.costUsd === undefined) continue;
    items.push({
      step: STEP.shot(s.index),
      kind: shotChargeKind(s),
      usd: s.costUsd,
      billed: Boolean(s.costBilled),
      ...(s.requestId ? { requestId: s.requestId } : {}),
    });
  }
  for (const s of cut.sounds ?? []) {
    if (s.costUsd === undefined) continue;
    items.push({
      step: STEP.sound(s.id),
      kind: "sound",
      usd: s.costUsd,
      billed: Boolean(s.costBilled),
      ...(s.requestId ? { requestId: s.requestId } : {}),
    });
  }
  return items;
}

export const inUseItems = (cut: JobCut): PaidItem[] => [
  ...coreInUse(cut),
  ...COST_PARTS.flatMap((p) => p.inUse(cut)),
];

const paidFor = (item: PaidItem) => item.usd !== 0 && item.usd !== null;

export const cutCostUsd = (cut: JobCut) => inUseItems(cut).reduce((n, i) => n + (i.usd ?? 0), 0);

function chargeOf(item: PaidItem, left: readonly Charge[]): number {
  if (!item.requestId) return left.findLastIndex((c) => c.step === item.step);
  const byRequest = left.findIndex((c) => c.requestId === item.requestId);
  if (byRequest >= 0) return byRequest;
  return left.findLastIndex((c) => c.step === item.step && !c.requestId);
}

export function matchCharges(job: Pick<VideoJob, "charges"> & JobCut): {
  unpaid: PaidItem[];
  redone: Charge[];
} {
  const redone = [...(job.charges ?? [])];
  const unpaid: PaidItem[] = [];
  for (const item of inUseItems(job).filter(paidFor)) {
    const at = chargeOf(item, redone);
    if (at >= 0) redone.splice(at, 1);
    else unpaid.push(item);
  }
  return { unpaid, redone };
}

export const redoneCharges = (job: Pick<VideoJob, "charges"> & JobCut) => matchCharges(job).redone;

export function withRecordedCharges<J extends VideoJob>(job: J, version: string): J {
  const { pastCostUsd, ...rest } = job;
  if (job.charges) return pastCostUsd === undefined ? job : (rest as J);
  const at = job.updatedAt;
  const charges: Charge[] = inUseItems(job)
    .filter((i): i is PaidItem & { usd: number } => typeof i.usd === "number" && i.usd !== 0)
    .map((i) => ({
      at,
      kind: i.kind,
      step: i.step,
      usd: i.usd,
      billed: false,
      ...(i.requestId ? { requestId: i.requestId } : {}),
      version,
    }));
  if (pastCostUsd) {
    charges.push({
      at,
      kind: "clip",
      step: STEP.earlier,
      usd: pastCostUsd,
      billed: false,
      version,
    });
  }
  return { ...rest, charges } as J;
}
