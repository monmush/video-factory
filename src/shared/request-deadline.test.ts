import { describe, expect, it } from "vitest";
import {
  CLIP_DEADLINE_MS,
  downloadFailedMessage,
  requestOverdue,
  STILL_DEADLINE_MS,
} from "./request-deadline";

describe("requestOverdue", () => {
  const sent = "2026-11-19T10:00:00.000Z";
  const at = (ms: number) => Date.parse(sent) + ms;

  it("waits until the step's own deadline", () => {
    expect(requestOverdue("still", sent, at(STILL_DEADLINE_MS))).toBe(false);
    expect(requestOverdue("still", sent, at(STILL_DEADLINE_MS + 1))).toBe(true);
    expect(requestOverdue("clip", sent, at(STILL_DEADLINE_MS + 1))).toBe(false);
    expect(requestOverdue("clip", sent, at(CLIP_DEADLINE_MS + 1))).toBe(true);
  });

  it("never times out a request with no known send time", () => {
    expect(requestOverdue("clip", undefined, at(10 * CLIP_DEADLINE_MS))).toBe(false);
    expect(requestOverdue("clip", "not a date", at(10 * CLIP_DEADLINE_MS))).toBe(false);
  });
});

describe("downloadFailedMessage", () => {
  it("says a paid result's link has expired when the host no longer serves it", () => {
    for (const status of [403, 404, 410]) {
      expect(downloadFailedMessage(status)).toMatch(/hết hạn/);
    }
    expect(downloadFailedMessage(400)).not.toMatch(/hết hạn/);
    expect(downloadFailedMessage(undefined)).not.toMatch(/hết hạn/);
  });
});
