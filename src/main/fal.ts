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
