import { describe, expect, it } from "vitest";
import { isStale, shownBalance } from "./media-balance";

const shown = { usd: 42 };

describe("shownBalance", () => {
  it("keeps the last balance through a failed read", () => {
    expect(shownBalance(shown, { status: "error", message: "offline" })).toEqual(shown);
  });

  it("forgets the old account's balance when the key is gone or refused", () => {
    expect(shownBalance(shown, { status: "no-key" })).toBeNull();
    expect(shownBalance(shown, { status: "no-permission" })).toBeNull();
  });

  it("replaces the shown balance with a fresh read", () => {
    expect(shownBalance(shown, { status: "ok", balance: 3, currency: "USD" })).toEqual({ usd: 3 });
  });

  it("does not show a balance in another currency as dollars", () => {
    expect(shownBalance(shown, { status: "ok", balance: 42, currency: "EUR" })).toBeNull();
  });
});

describe("isStale", () => {
  it("reads again on focus only when the last read is old or missing", () => {
    expect(isStale(null, 0)).toBe(true);
    expect(isStale(1_000, 2_000)).toBe(false);
    expect(isStale(1_000, 1_000 + 5 * 60_000)).toBe(true);
  });
});
