import { formatCost } from "@shared/credits";
import type { CostRow } from "@shared/live-plan";
import { costToPreviewUsd, liveCostTable, stopsForPreview, type VideoJob } from "@shared/video-job";
import { Check } from "lucide-react";

/** "Khung hình master" → "Khung hình"; "Cảnh 3 · Khẩu hình" → "Khẩu hình". */
function kindOf(row: CostRow): string {
  if (row.step.includes(" · ")) return row.step.split(" · ")[1] as string;
  return row.step.startsWith("Khung hình") ? "Khung hình" : row.step;
}

interface Group {
  kind: string;
  count: number;
  usd: number | null;
  /** Every step of the group is made and charged. */
  paid: boolean;
}

function groups(rows: CostRow[]): Group[] {
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

/**
 * One rule for every price on the card: an amount already charged has no "~";
 * an estimate always has one.
 */
function Price({ usd, paid }: { usd: number | null; paid?: boolean }) {
  if (usd === null) return <>?</>;
  if (usd === 0) return <>—</>;
  if (!paid) return <span className="text-muted-foreground">~{formatCost(usd)}</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <Check className="size-3 text-muted-foreground" aria-label="Đã chi" />
      {formatCost(usd)}
    </span>
  );
}

/** Charged so far, and whether nothing priced is left to make. */
function paidOf(rows: CostRow[]) {
  const paidUsd = rows.reduce((n, r) => n + (r.paid ? (r.usd ?? 0) : 0), 0);
  const allPaid = paidUsd > 0 && rows.every((r) => r.paid || r.usd === 0);
  return { paidUsd, allPaid };
}

/**
 * The table folded under its total, closed until asked for: the hold button
 * and the status line already carry the price staff need.
 */
export function LivePlanFold({ job }: { job: VideoJob }) {
  const costs = liveCostTable(job);
  if (!costs) return null;
  const { paidUsd, allPaid } = paidOf(costs.rows);
  return (
    <details className="mt-3 ml-7.5 max-w-xl text-xs">
      <summary className="w-fit cursor-pointer text-muted-foreground tabular-nums hover:text-foreground">
        {allPaid ? `Chi phí ${formatCost(paidUsd)}` : `Chi phí ~${formatCost(costs.knownUsd)}`}
        {costs.unknownSteps > 0 ? " +?" : ""}
      </summary>
      <LivePlanTable job={job} className="mt-1.5" />
    </details>
  );
}

/** The plan's table as the video stands: made steps at their cost, the rest as planned. */
export function LivePlanTable({ job, className }: { job: VideoJob; className?: string }) {
  const costs = liveCostTable(job);
  if (!costs) return null;
  const { paidUsd, allPaid } = paidOf(costs.rows);
  return (
    <div className={className ?? "mt-3 ml-7.5 max-w-xl text-xs"}>
      <table className="w-full tabular-nums">
        <tbody>
          {groups(costs.rows).map((g) => (
            <tr key={g.kind} className="border-b last:border-b-0">
              <td className="py-1 pr-3">{g.kind}</td>
              <td className="py-1 pr-3 text-right text-muted-foreground">
                {g.count > 1 ? `×${g.count}` : ""}
              </td>
              <td className="py-1 text-right">
                <Price usd={g.usd} paid={g.paid} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 tabular-nums">
        {/* Nothing paid yet and the hold stops at the preview: its price, as on the button. */}
        {paidUsd === 0 && stopsForPreview(job) && (
          <>
            <span className="font-medium">Các cảnh chính ~{formatCost(costToPreviewUsd(job))}</span>
            <span className="text-muted-foreground">·</span>
          </>
        )}
        {allPaid ? (
          <span className="font-medium">Đã chi {formatCost(paidUsd)}</span>
        ) : (
          paidUsd > 0 && (
            <>
              <span className="font-medium">Đã chi {formatCost(paidUsd)}</span>
              <span className="text-muted-foreground">·</span>
              <span>Còn ~{formatCost(costs.knownUsd - paidUsd)}</span>
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
            Tổng ~{formatCost(costs.knownUsd)}
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
                  <Price usd={row.usd} paid={row.paid} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
