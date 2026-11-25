import { formatCost } from "../credits";
import type { VideoJob } from "../video-job";
import {
  type Charge,
  hasCalculatedCharge,
  inUseItems,
  redoneCharges,
  STEP,
  spentUsd,
} from "./charges";
import { stepEstimates, stillToPayUsd } from "./estimate";
import { withCurrentNames } from "./group-names";
import { COST_PARTS } from "./parts";

export interface Money {
  usd: number | null;
  billed: boolean;
}

export interface PanelLine {
  key: string;
  label: string;
  count: number;
  quantity: string;
  estimateUsd?: number | null;
  paid: Money | null;
}

export interface CostPanel {
  groups: PanelLine[];
  steps: PanelLine[];
  redone: PanelLine | null;
  redoneSteps: PanelLine[];
  estimateUsd: number;
  unknownSteps: number;
  paid: Money | null;
  leftUsd: number | null;
}

export const REDONE = "Làm lại";

export const moneyText = (money: Money) =>
  money.usd === null ? "?" : `${money.billed ? "" : "~"}${formatCost(money.usd)}`;

export const estimateText = (usd: number) => `~${formatCost(usd)}`;

export const paidSoFar = (job: Pick<VideoJob, "charges">): Money => ({
  usd: spentUsd(job),
  billed: !hasCalculatedCharge(job),
});

function addMoney(a: Money | null, b: Money | null): Money | null {
  if (!a) return b;
  if (!b) return a;
  return {
    usd: a.usd === null || b.usd === null ? null : a.usd + b.usd,
    billed: a.billed && b.billed,
  };
}

function addEstimate(
  a: number | null | undefined,
  b: number | null | undefined,
): number | null | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return a === null || b === null ? null : a + b;
}

const costsNothing = (line: Pick<PanelLine, "estimateUsd" | "paid">) =>
  (line.estimateUsd === undefined || line.estimateUsd === 0) && (!line.paid || line.paid.usd === 0);

const FIXED_STEP_LABELS: Record<string, string> = {
  [STEP.voice]: "Giọng đọc",
  [STEP.earlier]: "Trước đây",
};

export function chargeLabel(step: string): string {
  const fixed = FIXED_STEP_LABELS[step];
  if (fixed) return fixed;
  for (const part of COST_PARTS) {
    const label = part.stepLabel(step);
    if (label) return label;
  }
  const [kind, ...rest] = step.split(":");
  const id = rest.join(":");
  if (kind === "frame") return `Khung hình ${id.replace(/^kf:/, "")}`;
  if (kind === "cutout") return "Tách nền sản phẩm";
  if (kind === "shot") return `Cảnh ${Number(id) + 1}`;
  if (kind === "sound") {
    const spot = /^spot:(\d+)$/.exec(id)?.[1];
    return spot ? `Cảnh ${Number(spot) + 1} · Tiếng động` : "Âm thanh nền";
  }
  return step;
}

const chargeMoney = (charges: readonly Charge[]): Money => ({
  usd: charges.reduce((n, c) => n + c.usd, 0),
  billed: charges.every((c) => c.billed),
});

export function costPanel(job: VideoJob): CostPanel | null {
  if (!job.live) return null;
  const frozen = job.firstPass && {
    ...job.firstPass,
    groups: withCurrentNames(job.firstPass.groups),
  };
  const paidByStep = new Map(inUseItems(job).map((i) => [i.step, i]));
  const steps: (PanelLine & { group: string })[] = stepEstimates(job)
    .map((s) => {
      const item = paidByStep.get(s.key);
      return {
        key: s.key,
        group: s.group,
        label: s.label,
        count: 1,
        quantity: s.quantity,
        estimateUsd: frozen ? frozen.steps[s.key] : s.usd,
        paid: item ? { usd: item.usd, billed: item.billed } : null,
      };
    })
    .filter((line) => !costsNothing(line));

  const groups: PanelLine[] = [];
  for (const step of steps) {
    const group = groups.find((g) => g.label === step.group);
    if (group) {
      group.count++;
      group.paid = addMoney(group.paid, step.paid);
      if (!frozen) group.estimateUsd = addEstimate(group.estimateUsd, step.estimateUsd);
    } else {
      groups.push({
        key: step.group,
        label: step.group,
        count: 1,
        quantity: "",
        estimateUsd: frozen ? frozen.groups[step.group] : step.estimateUsd,
        paid: step.paid,
      });
    }
  }
  if (frozen) {
    for (const [label, usd] of Object.entries(frozen.groups)) {
      if (usd !== 0 && !groups.some((g) => g.label === label)) {
        groups.push({ key: label, label, count: 0, quantity: "", estimateUsd: usd, paid: null });
      }
    }
  }

  const redoneList = redoneCharges(job);
  const redoneSteps = redoneList.map((c, i) => ({
    key: c.requestId ?? `${c.step}@${c.at}#${i}`,
    label: chargeLabel(c.step),
    count: 1,
    quantity: "",
    paid: chargeMoney([c]),
  }));
  const redone = redoneList.length
    ? {
        key: REDONE,
        label: REDONE,
        count: redoneList.length,
        quantity: "",
        paid: chargeMoney(redoneList),
      }
    : null;

  const anyPaid = Boolean(job.charges?.length);
  return {
    groups,
    steps,
    redone,
    redoneSteps,
    estimateUsd: frozen ? frozen.usd : steps.reduce((n, s) => n + (s.estimateUsd ?? 0), 0),
    unknownSteps: frozen ? frozen.unknownSteps : steps.filter((s) => s.estimateUsd === null).length,
    paid: anyPaid
      ? addMoney(
          groups.reduce<Money | null>((n, g) => addMoney(n, g.paid), null),
          redone?.paid ?? null,
        )
      : null,
    leftUsd: stillToPayUsd(job),
  };
}
