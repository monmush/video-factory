import { isNetworkError } from "../shared/net-error";
import type { falClient } from "./providers";
import { logUsage, recordFailed, recordSubmitted } from "./usage";

export type Fal = Awaited<ReturnType<typeof falClient>>;

export async function falCall<T>(
  fal: Fal,
  endpoint: string,
  input: Record<string, unknown>,
  log: {
    purpose: string;
    cost: (data: T) => number | null;
    costIsEstimate?: boolean;
  } & Record<string, unknown>,
): Promise<{ data: T; requestId: string }> {
  const { cost, purpose, costIsEstimate, ...extra } = log;
  const result = await fal.subscribe(endpoint, {
    input,
    onEnqueue: (requestId) => {
      void recordSubmitted({ provider: "fal", endpoint, purpose, requestId, ...extra }).catch(
        (error) => console.error("[fal] could not record request", error),
      );
    },
  });
  const data = result.data as T;
  await logUsage({
    provider: "fal",
    endpoint,
    purpose,
    requestId: result.requestId,
    cost: cost(data),
    ...(costIsEstimate ? { costIsEstimate: true } : {}),
    ...extra,
  });
  return { data, requestId: result.requestId };
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
  | { state: "done"; data: T }
  | { state: "failed"; message: string };

function providerRejection(resultError: unknown): string | null {
  const status = (resultError as { status?: number }).status;
  const answeredWithError = typeof status === "number" && status >= 400 && status !== 429;
  if (!answeredWithError) return null;
  return (resultError as Error).message || `Lỗi ${status}`;
}

export async function falPoll<T>(
  fal: Fal,
  endpoint: string,
  requestId: string,
  log: {
    purpose: string;
    cost: (data: T) => number | null;
    costIsEstimate?: boolean;
    keep?: (data: T) => Promise<void>;
  } & Record<string, unknown>,
): Promise<FalPoll<T>> {
  const status = await fal.queue.status(endpoint, { requestId, logs: false });
  if (status.status !== "COMPLETED") {
    return { state: "pending", started: status.status === "IN_PROGRESS" };
  }
  let data: T;
  try {
    data = (await fal.queue.result(endpoint, { requestId })).data as T;
  } catch (error) {
    const rejection = providerRejection(error);
    if (rejection) {
      await recordFailed({ provider: "fal", requestId });
      return { state: "failed", message: rejection };
    }
    throw error;
  }
  const { cost, purpose, costIsEstimate, keep, ...extra } = log;
  const logCharge = () =>
    logUsage({
      provider: "fal",
      endpoint,
      purpose,
      requestId,
      cost: cost(data),
      ...(costIsEstimate ? { costIsEstimate: true } : {}),
      ...extra,
    });
  try {
    await keep?.(data);
  } catch (error) {
    if (!isNetworkError(error)) await logCharge();
    throw error;
  }
  await logCharge();
  return { state: "done", data };
}

export async function falCancel(fal: Fal, endpoint: string, requestId: string): Promise<void> {
  await fal.queue.cancel(endpoint, { requestId }).catch(() => undefined);
  await recordFailed({ provider: "fal", requestId });
}
