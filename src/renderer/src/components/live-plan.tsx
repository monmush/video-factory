import { formatCost } from "@shared/credits";
import type { CostRow } from "@shared/live-plan";
import { liveCostTable, type VideoJob } from "@shared/video-job";

// Experiment branch (docs/LIVE_DIRECTOR_EXPERIMENT.md): the live director's
// plan on the video card before its hold and at "Nghe và xem thử". One row
// per kind of step and model, every step on request, and the total from
// recorded prices only: the same total the hold shows.

/** "Khung hình master" → "Khung hình"; "Cảnh 3 · Khẩu hình" → "Khẩu hình". */
function kindOf(row: CostRow): string {
  if (row.step.includes(" · ")) return row.step.split(" · ")[1] as string;
  return row.step.startsWith("Khung hình") ? "Khung hình" : row.step;
}

interface Group {
  kind: string;
  model: string | null;
  count: number;
  usd: number | null;
}

function groups(rows: CostRow[]): Group[] {
  const out: Group[] = [];
  for (const row of rows) {
    const kind = kindOf(row);
    const found = out.find((g) => g.kind === kind && g.model === row.model);
    if (found) {
      found.count++;
      found.usd = found.usd === null || row.usd === null ? null : found.usd + row.usd;
    } else {
      out.push({ kind, model: row.model, count: 1, usd: row.usd });
    }
  }
  return out;
}

const price = (usd: number | null) =>
  usd === null ? "?" : usd === 0 ? "—" : `~${formatCost(usd)}`;

/** The plan's table as the video stands: made steps at their cost, the rest as planned. */
export function LivePlanTable({ job }: { job: VideoJob }) {
  const costs = liveCostTable(job);
  if (!costs) return null;
  const over = costs.knownUsd > costs.budgetUsd + 1e-9;
  return (
    <div className="mt-3 ml-7.5 max-w-xl text-xs">
      <table className="w-full tabular-nums">
        <tbody>
          {groups(costs.rows).map((g) => (
            <tr key={`${g.kind}|${g.model}`} className="border-b last:border-b-0">
              <td className="py-1 pr-3">{g.kind}</td>
              <td className="py-1 pr-3 text-muted-foreground">{g.model ?? ""}</td>
              <td className="py-1 pr-3 text-right text-muted-foreground">
                {g.count > 1 ? `×${g.count}` : ""}
              </td>
              <td className="py-1 text-right">{price(g.usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 tabular-nums">
        <span className="font-medium">Tổng ~{formatCost(costs.knownUsd)}</span>
        {costs.unknownSteps > 0 && (
          <span className="text-muted-foreground">{costs.unknownSteps} bước chưa rõ giá</span>
        )}
        {over && (
          <span className="text-destructive-foreground">
            vượt mức gợi ý {formatCost(costs.budgetUsd)}
          </span>
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
                <td className="py-0.5 pr-3 text-muted-foreground">{row.model ?? ""}</td>
                <td className="py-0.5 pr-3 text-right text-muted-foreground">{row.quantity}</td>
                <td className="py-0.5 text-right">{price(row.usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
