import {
  type CostPanel,
  costPanel,
  estimateText,
  type Money,
  moneyText,
  type PanelLine,
} from "@shared/cost/table";
import type { VideoJob } from "@shared/video-job";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const unknownMark = (costs: CostPanel) => (costs.unknownSteps > 0 ? " +?" : "");

function headline(job: VideoJob, costs: CostPanel): string {
  if (job.status === "idle")
    return `Chi phí ${estimateText(costs.estimateUsd)}${unknownMark(costs)}`;
  const paid = moneyText(costs.paid ?? { usd: 0, billed: true });
  if (job.status === "done") return `Chi phí ${paid}`;
  return `Chi phí ${paid} · còn ${estimateText(costs.leftUsd ?? 0)}`;
}

function EstimateCell({ usd }: { usd?: number | null }) {
  if (usd === undefined) return <>—</>;
  if (usd === null) return <>?</>;
  return <span className="text-muted-foreground">{estimateText(usd)}</span>;
}

const PaidCell = ({ paid }: { paid: Money | null }) => <>{paid ? moneyText(paid) : "—"}</>;

function PaidHeader() {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="cursor-default" />}>Đã chi</TooltipTrigger>
      <TooltipPopup side="top" align="center" className="text-xs">
        Số có dấu ~ là ứng dụng tự tính
      </TooltipPopup>
    </Tooltip>
  );
}

function Line({
  line,
  detail,
  paidColumn,
  className,
}: {
  line: PanelLine;
  detail: string;
  paidColumn: boolean;
  className: string;
}) {
  return (
    <tr className="border-b last:border-b-0">
      <td className={`${className} pr-3`}>{line.label}</td>
      <td className={`${className} pr-3 text-right text-muted-foreground`}>{detail}</td>
      <td className={`${className} text-right`}>
        <EstimateCell usd={line.estimateUsd} />
      </td>
      {paidColumn && (
        <td className={`${className} pl-3 text-right`}>
          <PaidCell paid={line.paid} />
        </td>
      )}
    </tr>
  );
}

const countText = (count: number) => (count > 1 ? `×${count}` : "");

export function LivePlanFold({ job }: { job: VideoJob }) {
  const costs = costPanel(job);
  if (!costs) return null;
  return (
    <details className="mt-3 ml-7.5 max-w-xl text-xs">
      <summary className="w-fit cursor-pointer text-muted-foreground tabular-nums hover:text-foreground">
        {headline(job, costs)}
      </summary>
      <LivePlanTable job={job} costs={costs} />
    </details>
  );
}

function LivePlanTable({ job, costs }: { job: VideoJob; costs: CostPanel }) {
  const paidColumn = costs.paid !== null;
  const notStarted = job.status === "idle";
  const note = [
    notStarted ? "Chưa gồm cảnh phải làm lại" : "",
    costs.unknownSteps > 0 ? `${costs.unknownSteps} bước chưa rõ giá` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const heads = (
    <thead>
      <tr className="text-muted-foreground">
        <th />
        <th />
        <th className="py-1 text-right font-normal">Dự tính</th>
        {paidColumn && (
          <th className="py-1 pl-3 text-right font-normal">
            <PaidHeader />
          </th>
        )}
      </tr>
    </thead>
  );
  return (
    <div className="mt-1.5">
      <table className="w-full tabular-nums">
        {heads}
        <tbody>
          {costs.groups.map((g) => (
            <Line
              key={g.key}
              line={g}
              detail={countText(g.count)}
              paidColumn={paidColumn}
              className="py-1"
            />
          ))}
          {costs.redone && (
            <Line
              line={costs.redone}
              detail={countText(costs.redone.count)}
              paidColumn={paidColumn}
              className="py-1"
            />
          )}
          <tr className="font-medium">
            <td className="py-1 pr-3">Tổng</td>
            <td />
            <td className="py-1 text-right">
              {estimateText(costs.estimateUsd)}
              {unknownMark(costs)}
            </td>
            {paidColumn && (
              <td className="py-1 pl-3 text-right">
                <PaidCell paid={costs.paid} />
              </td>
            )}
          </tr>
        </tbody>
      </table>
      {note && <p className="mt-1.5 text-muted-foreground">{note}</p>}
      <details className="mt-1.5">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Từng bước
        </summary>
        <table className="mt-1 w-full tabular-nums">
          {heads}
          <tbody>
            {costs.steps.map((step) => (
              <Line
                key={step.key}
                line={step}
                detail={step.quantity}
                paidColumn={paidColumn}
                className="py-0.5"
              />
            ))}
            {costs.redoneSteps.map((step) => (
              <Line
                key={step.key}
                line={{ ...step, label: `${step.label} · Làm lại` }}
                detail=""
                paidColumn={paidColumn}
                className="py-0.5"
              />
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
