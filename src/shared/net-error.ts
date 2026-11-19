// Network trouble versus a real failure (docs/LIVE_DIRECTOR_EXPERIMENT.md,
// "Network failures"). A lost connection, a DNS failure or a timeout says
// nothing about the model or the request: the step waits and tries again,
// never counting toward the "two failures, then fall back" rule. A model that
// reports a failure, or a request refused as invalid (4xx), does count.
// Pure, so the runner and tests share it.

/** Node and undici codes for a connection that failed or was cut. */
const NETWORK_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "EAI_FAIL",
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "EPIPE",
  "ENETUNREACH",
  "ENETDOWN",
  "EHOSTUNREACH",
  "EHOSTDOWN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
  "UND_ERR_ABORTED",
]);

/** Provider answers that mean "busy or briefly down", not "this request is wrong". */
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Messages saved by jobs before this check existed, and messages with no code. */
const NETWORK_TEXT =
  /fetch failed|network|socket hang up|getaddrinfo|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|timed? ?out|timeout|Mất kết nối/i;

/** A saved error message that reads as network trouble (jobs saved before this check). */
export const isNetworkMessage = (message: string | null | undefined) =>
  Boolean(message && NETWORK_TEXT.test(message));

interface ErrorLike {
  name?: unknown;
  code?: unknown;
  errno?: unknown;
  status?: unknown;
  message?: unknown;
  cause?: unknown;
}

/**
 * True for a connection, DNS or timeout failure anywhere in the error's
 * cause chain, and for a provider status that means "try again later".
 * False for everything else, including a provider's 4xx about the request.
 */
export function isNetworkError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth++) {
    if (typeof current !== "object") return isNetworkMessage(String(current));
    const e = current as ErrorLike;
    if (typeof e.code === "string" && NETWORK_CODES.has(e.code)) return true;
    if (typeof e.errno === "string" && NETWORK_CODES.has(e.errno)) return true;
    if (e.name === "TimeoutError") return true;
    if (typeof e.status === "number") {
      // An HTTP answer: the server was reached. Only "busy" statuses are network trouble.
      return TRANSIENT_STATUS.has(e.status);
    }
    // fetch's own wrapper: "TypeError: fetch failed" with the real reason as its cause.
    if (e.name === "TypeError" && e.message === "fetch failed") return true;
    if (e.name === "AbortError" && !e.cause) return true;
    if (typeof e.message === "string" && !e.cause && isNetworkMessage(e.message)) return true;
    current = e.cause;
  }
  return false;
}

export const MAX_BUSY_ANSWERS = 5;

export function providerBusy(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth++) {
    const e = current as ErrorLike;
    if (typeof e.status === "number") return TRANSIENT_STATUS.has(e.status);
    current = e.cause;
  }
  return false;
}

/** Shown on the card while a job waits for the connection. */
export const OFFLINE_MESSAGE = "Mất kết nối, sẽ thử lại";

const FIRST_RETRY_MS = 5_000;
const MAX_RETRY_MS = 60_000;

/** Wait before the next try after `tries` network failures in a row: 5 s, 10 s, 20 s, 40 s, then every minute. */
export const retryDelayMs = (tries: number) =>
  Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** Math.max(0, tries - 1));
