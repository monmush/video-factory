import { describe, expect, it } from "vitest";
import { isNetworkError, isNetworkMessage, providerBusy, retryDelayMs } from "./net-error";

// Network trouble versus a real failure: only the second counts toward a
// fallback (docs/LIVE_DIRECTOR_EXPERIMENT.md, "Network failures").

const cause = (code: string) =>
  Object.assign(new Error(`getaddrinfo ${code} v3b.fal.media`), { code });

describe("telling network trouble from a failed request", () => {
  it("reads fetch's own wrapper and its cause", () => {
    // As logged in the first live run.
    expect(isNetworkError(new TypeError("fetch failed", { cause: cause("ENOTFOUND") }))).toBe(true);
    expect(isNetworkError(new TypeError("fetch failed"))).toBe(true);
    for (const code of ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_SOCKET"]) {
      expect(isNetworkError(Object.assign(new Error("x"), { code }))).toBe(true);
    }
  });

  it("counts timeouts and aborted downloads", () => {
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    expect(isNetworkError(timeout)).toBe(true);
    expect(isNetworkError(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(
      isNetworkError(new Error("Timeout exceeded when calling POST /v1/text-to-dialogue")),
    ).toBe(true);
  });

  it("treats a busy provider as trouble to retry, a refused request as a failure", () => {
    const api = (status: number) => Object.assign(new Error(`Lỗi ${status}`), { status });
    expect(isNetworkError(api(429))).toBe(true);
    expect(isNetworkError(api(503))).toBe(true);
    expect(isNetworkError(api(422))).toBe(false);
    expect(isNetworkError(api(400))).toBe(false);
    expect(isNetworkError(api(401))).toBe(false);
    expect(providerBusy(api(503))).toBe(true);
    expect(providerBusy(new Error("wrapped", { cause: api(429) }))).toBe(true);
    expect(providerBusy(api(422))).toBe(false);
    expect(providerBusy(new TypeError("fetch failed", { cause: cause("ENOTFOUND") }))).toBe(false);
  });

  it("never mistakes a model or local error for the network", () => {
    expect(isNetworkError(new Error("Không nhận được ảnh"))).toBe(false);
    expect(isNetworkError(new Error("Thiếu khung hình"))).toBe(false);
    expect(isNetworkError(new Error("input.image_urls: field required"))).toBe(false);
    expect(isNetworkError(null)).toBe(false);
  });

  it("reads messages saved before the check existed", () => {
    expect(isNetworkMessage("fetch failed")).toBe(true);
    expect(isNetworkMessage("The operation was aborted due to timeout")).toBe(true);
    expect(isNetworkMessage("Lỗi giả lập")).toBe(false);
    expect(isNetworkMessage(undefined)).toBe(false);
  });

  it("waits longer after each failure in a row, up to a minute", () => {
    expect([1, 2, 3, 4, 5, 9].map(retryDelayMs)).toEqual([5000, 10000, 20000, 40000, 60000, 60000]);
  });
});
