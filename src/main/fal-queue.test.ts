import { describe, expect, it } from "vitest";
import {
  billableUnits,
  cancelOutcome,
  mayStillBeBilled,
  outcomeOnceStarted,
  rejectsTheRequest,
  requestUrl,
  unitPriceFrom,
} from "./fal-queue";

const headers = (units?: string) =>
  new Headers(units === undefined ? {} : { "X-Fal-Billable-Units": units });

describe("a queued request's result", () => {
  it("is read from the app's owner and alias, whatever path the endpoint adds", () => {
    expect(requestUrl("openai/gpt-image-2.6/sunburst/edit", "abc")).toBe(
      "https://queue.fal.run/openai/gpt-image-2.6/requests/abc",
    );
    expect(requestUrl("alibaba/wan-3.0-prime/image-to-video", "r1")).toBe(
      "https://queue.fal.run/alibaba/wan-3.0-prime/requests/r1",
    );
    expect(requestUrl("workflows/me/flow/run", "r2")).toBe(
      "https://queue.fal.run/workflows/me/flow/requests/r2",
    );
  });

  it("reports billed units only when the header holds a number", () => {
    expect(billableUnits(headers("16.8"))).toBe(16.8);
    expect(billableUnits(headers("0.0647"))).toBe(0.0647);
    expect(billableUnits(headers())).toBeNull();
    expect(billableUnits(headers("n/a"))).toBeNull();
  });

  it("is a rejection on a 4xx other than 429; a busy or failing server is tried again", () => {
    expect(rejectsTheRequest(422)).toBe(true);
    expect(rejectsTheRequest(404)).toBe(true);
    expect(rejectsTheRequest(429)).toBe(false);
    expect(rejectsTheRequest(503)).toBe(false);
  });

  it("is priced from the unit price lookup only when it answers a positive number", () => {
    expect(unitPriceFrom({ total_cost: 0.045 })).toBe(0.045);
    expect(unitPriceFrom({ total_cost: 0 })).toBeNull();
    expect(unitPriceFrom({ error: "x" })).toBeNull();
  });
});

describe("cancelling an overdue request", () => {
  it("is free only when fal confirms the request was still queued", () => {
    expect(cancelOutcome(200, { status: "OK" })).toBe("removed");
    expect(cancelOutcome(202, { status: "CANCELLATION_REQUESTED" })).toBe("may-complete");
    expect(cancelOutcome(400, { status: "ALREADY_COMPLETED" })).toBe("completed");
    expect(cancelOutcome(500, null)).toBe("unknown");
    expect(mayStillBeBilled("removed")).toBe(false);
    for (const outcome of ["may-complete", "completed", "unknown"] as const) {
      expect(mayStillBeBilled(outcome)).toBe(true);
    }
  });
});

describe("stopping a video", () => {
  it("withdraws only a request fal has not started, so work being paid for is never aborted", () => {
    expect(outcomeOnceStarted("IN_QUEUE")).toBeNull();
    expect(outcomeOnceStarted("IN_PROGRESS")).toBe("may-complete");
    expect(outcomeOnceStarted("COMPLETED")).toBe("completed");
    expect(outcomeOnceStarted(undefined)).toBe("unknown");
  });
});
