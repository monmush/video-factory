import { describe, expect, it } from "vitest";
import { HANDLE_PATTERN, toHandle } from "./handle";

describe("toHandle", () => {
  it("gives a valid handle when the 40-character cut lands on a separator", () => {
    const handle = toHandle("ASPIRA H2-4313A-KVB-1700 SHOE SET,BRAKE+ for HND");
    expect(handle).toBe("aspira-h2-4313a-kvb-1700-shoe-set-brake");
    expect(HANDLE_PATTERN.test(handle)).toBe(true);
  });
});
