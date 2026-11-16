import { describe, expect, it } from "vitest";
import { assignProducts, evenMix, mixProblem, productCounts, shortNames } from "./product-mix";

const known = (id: string) => ["bach", "hong", "luc", "co"].includes(id);

describe("a batch's product mix", () => {
  it("saves only whole shares of known products summing to 100", () => {
    expect(mixProblem(evenMix(["bach", "hong"]), known)).toBeNull();
    expect(mixProblem([], known)).toBeNull();
    expect(mixProblem([{ productId: "bach", share: 60 }], known)).toBe("Tổng là 60%, cần 100%");
    expect(mixProblem([{ productId: "x", share: 100 }], known)).toBe("Không tìm thấy sản phẩm");
    expect(
      mixProblem(
        [
          { productId: "bach", share: 50 },
          { productId: "bach", share: 50 },
        ],
        known,
      ),
    ).toBe("Sản phẩm bị lặp");
    expect(mixProblem([{ productId: "bach", share: 99.5 }], known)).toMatch(/số nguyên/);
  });

  it("splits evenly with the remainder on the first", () => {
    expect(evenMix(["bach", "hong", "luc"]).map((e) => e.share)).toEqual([34, 33, 33]);
    expect(evenMix(["bach"]).map((e) => e.share)).toEqual([100]);
  });

  it("gives new scripts the product the board is furthest behind on", () => {
    const half = evenMix(["bach", "hong"]);
    // The first live board: two scripts already on Bạch Trà.
    expect(assignProducts(half, ["bach", "bach"], 2)).toEqual(["hong", "hong"]);
    expect(assignProducts(half, [], 4)).toEqual(["bach", "hong", "bach", "hong"]);
    const mostly = [
      { productId: "bach", share: 75 },
      { productId: "hong", share: 25 },
    ];
    expect(assignProducts(mostly, [], 4)).toEqual(["bach", "bach", "hong", "bach"]);
    // Scripts with no product, or one outside the mix, still count toward the total.
    expect(assignProducts(half, [null, "luc"], 2)).toEqual(["bach", "hong"]);
  });

  it("assigns nothing without a mix, so the writer chooses", () => {
    expect(assignProducts(undefined, ["bach"], 2)).toEqual([undefined, undefined]);
    expect(assignProducts([], [], 1)).toEqual([undefined]);
  });

  it("counts the board per product", () => {
    const { counts, none } = productCounts([
      { productIds: ["bach"] },
      { productIds: ["hong"] },
      { productIds: ["bach"] },
      { productIds: [] },
    ]);
    expect([...counts]).toEqual([
      ["bach", 2],
      ["hong", 1],
    ]);
    expect(none).toBe(1);
  });

  it("shortens names by the words they all share", () => {
    expect(
      shortNames([
        "Shan Tuyết Cổ Thụ",
        "Bạch Trà Shan Tuyết",
        "Lục Trà Shan Tuyết",
        "Hồng Trà Shan Tuyết",
      ]),
    ).toEqual(["Cổ Thụ", "Bạch Trà", "Lục Trà", "Hồng Trà"]);
    expect(shortNames(["Trà xanh", "Cà phê"])).toEqual(["Trà xanh", "Cà phê"]);
    // Never empties a name.
    expect(shortNames(["Trà", "Trà sen"])).toEqual(["Trà", "Trà sen"]);
    expect(shortNames(["Bạch Trà"])).toEqual(["Bạch Trà"]);
  });
});
