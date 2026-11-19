import { describe, expect, it } from "vitest";
import {
  assignProducts,
  defaultMix,
  evenMix,
  mentionedProducts,
  mixProblem,
  newTopicProducts,
} from "./product-mix";

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
});

describe("the default mix", () => {
  it("splits evenly over the series' products, rotated by the batch", () => {
    expect(defaultMix(["a", "b", "c"], 0).map((e) => e.productId)).toEqual(["a", "b", "c"]);
    expect(defaultMix(["a", "b", "c"], 1).map((e) => e.productId)).toEqual(["b", "c", "a"]);
    expect(defaultMix(["a", "b", "c"], 4).map((e) => e.productId)).toEqual(["b", "c", "a"]);
    expect(defaultMix(["a", "b"], 1).map((e) => e.share)).toEqual([50, 50]);
  });

  it("is empty for fewer than two products", () => {
    expect(defaultMix(["a"], 0)).toEqual([]);
    expect(defaultMix([], 3)).toEqual([]);
  });
});

describe("products mentioned in a request", () => {
  const products = [
    { id: "hong", handle: "hong-tra" },
    { id: "shan", handle: "hong-tra-shan" },
    { id: "bach", handle: "bach-tra" },
  ];

  it("finds whole tags in order of first appearance, once each", () => {
    expect(mentionedProducts("3 video @bach-tra và @hong-tra, thêm @bach-tra", products)).toEqual([
      "bach",
      "hong",
    ]);
  });

  it("does not match a handle inside a longer one or a word", () => {
    expect(mentionedProducts("về @hong-tra-shan", products)).toEqual(["shan"]);
    expect(mentionedProducts("mail@hong-tra", products)).toEqual([]);
    expect(mentionedProducts("(@hong-tra)", products)).toEqual(["hong"]);
  });

  it("ignores case", () => {
    expect(mentionedProducts("@Hong-Tra", products)).toEqual(["hong"]);
  });
});

describe("products for new topics", () => {
  const base = { onBoard: [], seriesProductIds: ["a", "b", "c"], offset: 0 };

  it("keeps a product named for a topic", () => {
    expect(newTopicProducts({ ...base, named: ["c", null, undefined] })).toEqual(["c", null, "a"]);
  });

  it("shares a request's mentioned products evenly, counting only the request", () => {
    expect(
      newTopicProducts({
        ...base,
        onBoard: ["b", "b"],
        named: [undefined, undefined, undefined, undefined],
        mentioned: ["b", "c"],
        savedMix: [{ productId: "a", share: 100 }],
      }),
    ).toEqual(["b", "c", "b", "c"]);
  });

  it("follows a saved mix before the default rotation", () => {
    expect(
      newTopicProducts({
        ...base,
        named: [undefined, undefined],
        savedMix: [{ productId: "c", share: 100 }],
      }),
    ).toEqual(["c", "c"]);
  });

  it("rotates over the series' products, balanced against the board", () => {
    expect(
      newTopicProducts({ ...base, offset: 1, named: [undefined, undefined, undefined] }),
    ).toEqual(["b", "c", "a"]);
    expect(newTopicProducts({ ...base, onBoard: ["a", "b"], named: [undefined] })).toEqual(["c"]);
  });

  it("leaves the choice to the writer with fewer than two products", () => {
    expect(newTopicProducts({ ...base, seriesProductIds: ["a"], named: [undefined] })).toEqual([
      undefined,
    ]);
  });
});
