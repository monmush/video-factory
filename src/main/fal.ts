import { listUnitPriceUsd, type ResultCost, resultCost } from "../shared/cost/rates";
import { isNetworkError } from "../shared/net-error";
import { refreshMediaBalanceSoon } from "./balances";
import {
  billableUnits,
  type CancelOutcome,
  cancelOutcome,
  outcomeOnceStarted,
  rejectsTheRequest,
  requestUrl,
  unitPriceFrom,
} from "./fal-queue";
import { duringBlockingPaidCall } from "./paid-calls";
import { type falClient, getKey } from "./providers";
import { logUsage, recordFailed, recordSubmitted } from "./usage";

export type Fal = Awaited<ReturnType<typeof falClient>>;

export type { CancelOutcome } from "./fal-queue";

const RESULT_TIMEOUT_MS = 60_000;
const PRICE_TIMEOUT_MS = 10_000;
const CANCEL_TIMEOUT_MS = 15_000;

async function falKey(): Promise<string> {
  const key = await getKey();
  if (!key) throw new Error("Chưa có mã sản phẩm. Nhập mã trong Cài đặt.");
  return key;
}

const unitPrices = new Map<string, number>();

async function unitPriceUsd(endpoint: string): Promise<number | null> {
  const known = unitPrices.get(endpoint);
  if (known !== undefined) return known;
  try {
    const res = await fetch("https://api.fal.ai/v1/models/pricing/estimate", {
      method: "POST",
      headers: { Authorization: `Key ${await falKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        estimate_type: "unit_price",
        endpoints: { [endpoint]: { unit_quantity: 1 } },
      }),
      signal: AbortSignal.timeout(PRICE_TIMEOUT_MS),
    });
    const price = res.ok ? unitPriceFrom(await res.json()) : null;
    if (price !== null) {
      unitPrices.set(endpoint, price);
      return price;
    }
  } catch (error) {
    console.warn("[fal] unit price lookup:", (error as Error).message);
  }
  return listUnitPriceUsd(endpoint);
}

function errorMessage(body: unknown, status: number): string {
  const b = (body ?? {}) as { detail?: unknown; message?: unknown };
  if (typeof b.detail === "string") return b.detail;
  if (typeof b.message === "string") return b.message;
  if (b.detail !== undefined) return JSON.stringify(b.detail);
  return `Lỗi ${status}`;
}

class ResultRejected extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function fetchResult(
  endpoint: string,
  requestId: string,
): Promise<{ data: unknown; billedUnits: number | null }> {
  const res = await fetch(requestUrl(endpoint, requestId), {
    headers: { Authorization: `Key ${await falKey()}`, Accept: "application/json" },
    signal: AbortSignal.timeout(RESULT_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = errorMessage(body, res.status);
    if (rejectsTheRequest(res.status)) throw new ResultRejected(message, res.status);
    throw Object.assign(new Error(message), { status: res.status });
  }
  return { data: await res.json(), billedUnits: billableUnits(res.headers) };
}

async function costOf(
  endpoint: string,
  calculatedUsd: number | null,
  billedUnits: number | null,
): Promise<ResultCost> {
  if (billedUnits === null) return resultCost(calculatedUsd, null, null);
  return resultCost(calculatedUsd, billedUnits, await unitPriceUsd(endpoint));
}

const usageCost = (cost: ResultCost, calculatedIsEstimate: boolean) => ({
  cost: cost.usd,
  ...(cost.billed ? { billedUnits: cost.billedUnits } : {}),
  ...(!cost.billed && calculatedIsEstimate ? { costIsEstimate: true } : {}),
});

type FalCallLog<T> = {
  purpose: string;
  cost: (data: T) => number | null;
  costIsEstimate?: boolean;
} & Record<string, unknown>;

type FalCallResult<T> = { data: T; requestId: string; cost: ResultCost };

export function falCall<T>(
  fal: Fal,
  endpoint: string,
  input: Record<string, unknown>,
  log: FalCallLog<T>,
): Promise<FalCallResult<T>> {
  return duringBlockingPaidCall(() => callAndWait(fal, endpoint, input, log));
}

async function callAndWait<T>(
  fal: Fal,
  endpoint: string,
  input: Record<string, unknown>,
  log: FalCallLog<T>,
): Promise<FalCallResult<T>> {
  const { cost, purpose, costIsEstimate, ...extra } = log;
  const { request_id: requestId } = await fal.queue.submit(endpoint, { input });
  void recordSubmitted({ provider: "fal", endpoint, purpose, requestId, ...extra }).catch((error) =>
    console.error("[fal] could not record request", error),
  );
  await fal.queue.subscribeToStatus(endpoint, { requestId });
  const result = await fetchResult(endpoint, requestId);
  const data = result.data as T;
  const charged = await costOf(endpoint, cost(data), result.billedUnits);
  await logUsage({
    provider: "fal",
    endpoint,
    purpose,
    requestId,
    ...usageCost(charged, Boolean(costIsEstimate)),
    ...extra,
  });
  refreshMediaBalanceSoon();
  return { data, requestId, cost: charged };
}

const RESUBMITTING_IS_OUR_DECISION_NOT_FALS = { "X-Fal-No-Retry": "1" };

export async function falSubmit(
  fal: Fal,
  endpoint: string,
  input: Record<string, unknown>,
  log: { purpose: string } & Record<string, unknown>,
): Promise<string> {
  const { request_id: requestId } = await fal.queue.submit(endpoint, {
    input,
    headers: RESUBMITTING_IS_OUR_DECISION_NOT_FALS,
  });
  await recordSubmitted({ provider: "fal", endpoint, requestId, ...log });
  return requestId;
}

export type FalPoll<T> =
  | { state: "pending"; started: boolean }
  | { state: "done"; data: T; cost: ResultCost }
  | { state: "failed"; message: string };

export async function falPoll<T>(
  fal: Fal,
  endpoint: string,
  requestId: string,
  log: {
    purpose: string;
    cost: (data: T) => number | null;
    keep?: (data: T) => Promise<void>;
  } & Record<string, unknown>,
): Promise<FalPoll<T>> {
  const status = await fal.queue.status(endpoint, { requestId, logs: false });
  if (status.status !== "COMPLETED") {
    return { state: "pending", started: status.status === "IN_PROGRESS" };
  }
  let result: Awaited<ReturnType<typeof fetchResult>>;
  try {
    result = await fetchResult(endpoint, requestId);
  } catch (error) {
    if (error instanceof ResultRejected) {
      await recordFailed({ provider: "fal", requestId });
      return { state: "failed", message: error.message };
    }
    throw error;
  }
  const data = result.data as T;
  const { cost, purpose, keep, ...extra } = log;
  const charged = await costOf(endpoint, cost(data), result.billedUnits);
  const logCharge = async () => {
    await logUsage({
      provider: "fal",
      endpoint,
      purpose,
      requestId,
      ...usageCost(charged, true),
      ...extra,
    });
    refreshMediaBalanceSoon();
  };
  try {
    await keep?.(data);
  } catch (error) {
    if (!isNetworkError(error)) await logCharge();
    throw error;
  }
  await logCharge();
  return { state: "done", data, cost: charged };
}

export type Canceller = (endpoint: string, requestId: string) => Promise<CancelOutcome>;

async function queueStatus(endpoint: string, requestId: string): Promise<unknown> {
  const res = await fetch(`${requestUrl(endpoint, requestId)}/status`, {
    headers: { Authorization: `Key ${await falKey()}`, Accept: "application/json" },
    signal: AbortSignal.timeout(CANCEL_TIMEOUT_MS),
  });
  return ((await res.json().catch(() => null)) as { status?: unknown } | null)?.status;
}

export async function falCancelUnlessStarted(
  endpoint: string,
  requestId: string,
): Promise<CancelOutcome> {
  let started: CancelOutcome | null;
  try {
    started = outcomeOnceStarted(await queueStatus(endpoint, requestId));
  } catch (error) {
    console.warn("[fal] status before cancel:", (error as Error).message);
    return "unknown";
  }
  return started ?? falCancel(endpoint, requestId);
}

export async function falCancel(endpoint: string, requestId: string): Promise<CancelOutcome> {
  let outcome: CancelOutcome = "unknown";
  try {
    const res = await fetch(`${requestUrl(endpoint, requestId)}/cancel`, {
      method: "PUT",
      headers: { Authorization: `Key ${await falKey()}`, Accept: "application/json" },
      signal: AbortSignal.timeout(CANCEL_TIMEOUT_MS),
    });
    outcome = cancelOutcome(res.status, await res.json().catch(() => null));
  } catch (error) {
    console.warn("[fal] cancel:", (error as Error).message);
  }
  await recordFailed({ provider: "fal", requestId });
  return outcome;
}
