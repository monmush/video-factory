import { describe, expect, it } from "vitest";
import { cleanPastedKey, maskedTail, verdictOfBalanceStatus } from "./product-key-rules";

describe("verdictOfBalanceStatus", () => {
  it("rejects only a key the service refuses, accepts a real key without balance access", () => {
    expect(verdictOfBalanceStatus(200)).toBe("ok");
    expect(verdictOfBalanceStatus(403)).toBe("ok");
    expect(verdictOfBalanceStatus(401)).toBe("rejected");
  });

  it("never stores a key it could not check", () => {
    expect(verdictOfBalanceStatus(500)).toBe("unreachable");
    expect(verdictOfBalanceStatus(503)).toBe("unreachable");
    expect(verdictOfBalanceStatus(429)).toBe("unreachable");
  });
});

describe("cleanPastedKey", () => {
  it("drops whitespace and quotes copied around the key", () => {
    expect(cleanPastedKey('  "abc:123"\n')).toBe("abc:123");
    expect(cleanPastedKey("'abc:123'")).toBe("abc:123");
    expect(cleanPastedKey("“abc:123”")).toBe("abc:123");
    expect(cleanPastedKey('" "')).toBe("");
  });
});

describe("maskedTail", () => {
  it("shows only the last four characters", () => {
    expect(maskedTail("1234-secret-3f9a")).toBe("••••3f9a");
  });
});
