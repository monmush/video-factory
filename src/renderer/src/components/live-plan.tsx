import { formatCost } from "@shared/credits";
import type { CostRow } from "@shared/live-plan";
import { costToPreviewUsd, liveCostTable, stopsForPreview, type VideoJob } from "@shared/video-job";
import { Check } from "lucide-react";

function kindOf(row: CostRow): string {
  if (row.step.includes(" · ")) return row.step.split(" · ")[1] as string;
  return row.step.startsWith("Khung hình") ? "Khung hình" : row.step;
}

interface Group {
  kind: string;
  count: number;
  usd: number | null;
  paid: boolean;
}

function groupsByKind(rows: CostRow[]): Group[] {
  const out: Group[] = [];
  for (const row of rows) {
    const kind = kindOf(row);
    const found = out.find((g) => g.kind === kind);
    if (found) {
      found.count++;
      found.usd = found.usd === null || row.usd === null ? null : found.usd + row.usd;
      found.paid &&= Boolean(row.paid);
    } else {
      out.push({ kind, count: 1, usd: row.usd, paid: Boolean(row.paid) });
    }
  }
  return out;
}

const charged = (usd: number) => formatCost(usd);
const estimated = (usd: number) => `~${formatCost(usd)}`;

function ChargedOrEstimatedPrice({ usd, paid }: { usd: number | null; paid?: boolean }) {
  if (usd === null) return <>?</>;
  if (usd === 0) return <>—</>;
  if (!paid) return <span className="text-muted-foreground">{estimated(usd)}</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <Check className="size-3 text-muted-foreground" aria-label="Đã chi" />
      {charged(usd)}
    </span>
  );
}

function chargedSoFar(rows: CostRow[]) {
  const paidUsd = rows.reduce((n, r) => n + (r.paid ? (r.usd ?? 0) : 0), 0);
  const allPaid = paidUsd > 0 && rows.every((r) => r.paid || r.usd === 0);
  return { paidUsd, allPaid };
}

export function LivePlanFold({ job }: { job: VideoJob }) {
  const costs = liveCostTable(job);
  if (!costs) return null;
  const { paidUsd, allPaid } = chargedSoFar(costs.rows);
  return (
    <details className="mt-3 ml-7.5 max-w-xl text-xs">
      <summary className="w-fit cursor-pointer text-muted-foreground tabular-nums hover:text-foreground">
        Chi phí {allPaid ? charged(paidUsd) : estimated(costs.knownUsd)}
        {costs.unknownSteps > 0 ? " +?" : ""}
      </summary>
      <LivePlanTable job={job} className="mt-1.5" />
    </details>
  );
}

export function LivePlanTable({ job, className }: { job: VideoJob; className?: string }) {
  const costs = liveCostTable(job);
  if (!costs) return null;
  const { paidUsd, allPaid } = chargedSoFar(costs.rows);
  const showsPreviewPriceAsOnHold = paidUsd === 0 && stopsForPreview(job);
  return (
    <div className={className ?? "mt-3 ml-7.5 max-w-xl text-xs"}>
      <table className="w-full tabular-nums">
        <tbody>
          {groupsByKind(costs.rows).map((g) => (
            <tr key={g.kind} className="border-b last:border-b-0">
              <td className="py-1 pr-3">{g.kind}</td>
              <td className="py-1 pr-3 text-right text-muted-foreground">
                {g.count > 1 ? `×${g.count}` : ""}
              </td>
              <td className="py-1 text-right">
                <ChargedOrEstimatedPrice usd={g.usd} paid={g.paid} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 tabular-nums">
        {showsPreviewPriceAsOnHold && (
          <>
            <span className="font-medium">Các cảnh chính {estimated(costToPreviewUsd(job))}</span>
            <span className="text-muted-foreground">·</span>
          </>
        )}
        {allPaid ? (
          <span className="font-medium">Đã chi {charged(paidUsd)}</span>
        ) : (
          paidUsd > 0 && (
            <>
              <span className="font-medium">Đã chi {charged(paidUsd)}</span>
              <span className="text-muted-foreground">·</span>
              <span>Còn {estimated(costs.knownUsd - paidUsd)}</span>
              <span className="text-muted-foreground">·</span>
            </>
          )
        )}
        {!allPaid && (
          <span
            className={
              paidUsd > 0 || stopsForPreview(job) ? "text-muted-foreground" : "font-medium"
            }
          >
            Tổng {estimated(costs.knownUsd)}
          </span>
        )}
        {costs.unknownSteps > 0 && (
          <span className="text-muted-foreground">{costs.unknownSteps} bước chưa rõ giá</span>
        )}
      </div>
      <details className="mt-1.5">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Từng bước
        </summary>
        <table className="mt-1 w-full tabular-nums">
          <tbody>
            {costs.rows.map((row) => (
              <tr key={row.step} className="border-b last:border-b-0">
                <td className="py-0.5 pr-3">{row.step}</td>
                <td className="py-0.5 pr-3 text-right text-muted-foreground">{row.quantity}</td>
                <td className="py-0.5 text-right">
                  <ChargedOrEstimatedPrice usd={row.usd} paid={row.paid} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
