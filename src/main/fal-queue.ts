const NAMESPACES = ["workflows", "comfy"];

export function queueApp(endpoint: string): string {
  const parts = endpoint.split("/");
  const namespaced = NAMESPACES.includes(parts[0] ?? "");
  const [owner, alias] = namespaced ? parts.slice(1, 3) : parts.slice(0, 2);
  return `${namespaced ? `${parts[0]}/` : ""}${owner}/${alias}`;
}

export const requestUrl = (endpoint: string, requestId: string) =>
  `https://queue.fal.run/${queueApp(endpoint)}/requests/${encodeURIComponent(requestId)}`;

export const BILLABLE_UNITS_HEADER = "x-fal-billable-units";

export function billableUnits(headers: Pick<Headers, "get">): number | null {
  const raw = headers.get(BILLABLE_UNITS_HEADER);
  if (raw === null || raw.trim() === "") return null;
  const units = Number(raw);
  return Number.isFinite(units) && units >= 0 ? units : null;
}

export const rejectsTheRequest = (status: number) =>
  status >= 400 && status < 500 && status !== 429;

export type CancelOutcome = "removed" | "may-complete" | "completed" | "unknown";

const CANCEL_OUTCOME: Record<number, CancelOutcome> = {
  200: "removed",
  202: "may-complete",
};

export function cancelOutcome(status: number, body: unknown): CancelOutcome {
  const known = CANCEL_OUTCOME[status];
  if (known) return known;
  const said = (body as { status?: unknown } | null)?.status;
  return status === 400 && said === "ALREADY_COMPLETED" ? "completed" : "unknown";
}

export const mayStillBeBilled = (outcome: CancelOutcome) => outcome !== "removed";

export function outcomeOnceStarted(queueStatus: unknown): CancelOutcome | null {
  if (queueStatus === "IN_QUEUE") return null;
  if (queueStatus === "IN_PROGRESS") return "may-complete";
  return queueStatus === "COMPLETED" ? "completed" : "unknown";
}

export function unitPriceFrom(answer: unknown): number | null {
  const total = (answer as { total_cost?: unknown } | null)?.total_cost;
  return typeof total === "number" && Number.isFinite(total) && total > 0 ? total : null;
}
