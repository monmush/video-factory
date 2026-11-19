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

const MAX_CAUSE_DEPTH = 6;

const BUSY_OR_BRIEFLY_DOWN_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const NETWORK_TROUBLE_IN_MESSAGE =
  /fetch failed|network|socket hang up|getaddrinfo|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|timed? ?out|timeout|Mất kết nối/i;

export const isNetworkMessage = (message: string | null | undefined) =>
  Boolean(message && NETWORK_TROUBLE_IN_MESSAGE.test(message));

interface ErrorLike {
  name?: unknown;
  code?: unknown;
  errno?: unknown;
  status?: unknown;
  message?: unknown;
  cause?: unknown;
}

export function isNetworkError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current; depth++) {
    if (typeof current !== "object") return isNetworkMessage(String(current));
    const e = current as ErrorLike;
    if (typeof e.code === "string" && NETWORK_CODES.has(e.code)) return true;
    if (typeof e.errno === "string" && NETWORK_CODES.has(e.errno)) return true;
    if (e.name === "TimeoutError") return true;
    const serverWasReached = typeof e.status === "number";
    if (serverWasReached) return BUSY_OR_BRIEFLY_DOWN_STATUS.has(e.status as number);
    const fetchWrapperAroundTheRealReason = e.name === "TypeError" && e.message === "fetch failed";
    if (fetchWrapperAroundTheRealReason) return true;
    if (e.name === "AbortError" && !e.cause) return true;
    if (typeof e.message === "string" && !e.cause && isNetworkMessage(e.message)) return true;
    current = e.cause;
  }
  return false;
}

export const MAX_BUSY_ANSWERS = 5;

export function providerBusy(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current && typeof current === "object"; depth++) {
    const e = current as ErrorLike;
    if (typeof e.status === "number") return BUSY_OR_BRIEFLY_DOWN_STATUS.has(e.status);
    current = e.cause;
  }
  return false;
}

export const OFFLINE_MESSAGE = "Mất kết nối, sẽ thử lại";

const FIRST_RETRY_MS = 5_000;
const MAX_RETRY_MS = 60_000;

export const retryDelayMs = (tries: number) =>
  Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** Math.max(0, tries - 1));
