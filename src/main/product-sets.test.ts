import { describe, expect, it } from "vitest";
import { checkSets } from "./product-sets";

const product = (id: string, contains?: string[]) => ({ id, kind: "product" as const, contains });

describe("checkSets", () => {
  it("accepts a set of plain products", () => {
    expect(() => checkSets([product("box", ["a", "b"]), product("a"), product("b")])).not.toThrow();
  });

  it("rejects a product containing itself", () => {
    expect(() => checkSets([product("a", ["a"])])).toThrow();
  });

  it("rejects a set inside a set", () => {
    expect(() =>
      checkSets([product("outer", ["inner"]), product("inner", ["a"]), product("a")]),
    ).toThrow();
  });

  it("rejects non-products in a set", () => {
    expect(() =>
      checkSets([product("box", ["c"]), { id: "c", kind: "character" as const }]),
    ).toThrow();
  });
});
