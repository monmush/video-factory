import type { falClient } from "./providers";
import { logUsage, recordSubmitted } from "./usage";

// Every paid fal request goes through `falCall`, so the bookkeeping is the
// same everywhere: the request id is written to requests.jsonl the moment fal
// accepts it (before any charge can complete), and usage.jsonl gets the cost
// as soon as the result arrives, before the caller does anything else with it
// (a failed download afterwards still leaves the charge on record).
// Long-running jobs will reconcile requests.jsonl on restart so a closed app
// never pays twice.

export type Fal = Awaited<ReturnType<typeof falClient>>;

export async function falCall<T>(
  fal: Fal,
  endpoint: string,
  input: Record<string, unknown>,
  log: {
    purpose: string;
    /** USD for this result; null when unknown. */
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

// Long jobs use fal's queue directly instead of a blocking subscribe: the
// request id is saved by the caller (job.json) and recorded in requests.jsonl
// the moment fal accepts it, so a restart polls the same request instead of
// paying again. The cost is logged when the result is read, before download.

/** Submits a paid request; returns its id once fal has accepted it. */
export async function falSubmit(
  fal: Fal,
  endpoint: string,
  input: Record<string, unknown>,
  log: { purpose: string } & Record<string, unknown>,
): Promise<string> {
  const { request_id: requestId } = await fal.queue.submit(endpoint, {
    input,
    // Never let the client resubmit on its own: a retry is our decision.
    headers: { "X-Fal-No-Retry": "1" },
  });
  await recordSubmitted({ provider: "fal", endpoint, requestId, ...log });
  return requestId;
}

export type FalPoll<T> =
  | { state: "pending"; started: boolean }
  | { state: "done"; data: T }
  /** The provider finished with an error: nothing is charged, not logged as a cost. */
  | { state: "failed"; message: string };

/**
 * One status check. A finished request's result is read and its cost logged
 * before returning. Network trouble throws (try again later); a provider-side
 * failure returns "failed".
 */
export async function falPoll<T>(
  fal: Fal,
  endpoint: string,
  requestId: string,
  log: {
    purpose: string;
    cost: (data: T) => number | null;
    costIsEstimate?: boolean;
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
    // A completed request whose result is an error (4xx/5xx with a body) failed
    // on the provider's side. Anything else (no status: network) is retried.
    const status = (error as { status?: number }).status;
    if (typeof status === "number" && status >= 400 && status !== 429) {
      return { state: "failed", message: (error as Error).message || `Lỗi ${status}` };
    }
    throw error;
  }
  const { cost, purpose, costIsEstimate, ...extra } = log;
  await logUsage({
    provider: "fal",
    endpoint,
    purpose,
    requestId,
    cost: cost(data),
    ...(costIsEstimate ? { costIsEstimate: true } : {}),
    ...extra,
  });
  return { state: "done", data };
}
