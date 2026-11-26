import { describe, expect, it } from "vitest";
import { productRuleFor, type WritingRuleInput, writingRules } from "./writing-rules";

const base: WritingRuleInput = {
  targetSec: 45,
  product: "natural",
  storyOrToneStated: false,
  closingStated: false,
  accents: [],
};

describe("the writer's rules", () => {
  it("never asks to name a product in a script that has none", () => {
    const rules = writingRules({ ...base, product: productRuleFor("natural", false) });
    expect(rules).not.toMatch(/tên sản phẩm/);
    expect(rules).not.toMatch(/Nhắc sản phẩm/);
  });

  it("introduces the product at the end only when the series asks for it", () => {
    const closing = writingRules({ ...base, product: productRuleFor("closing", true) });
    expect(closing).toMatch(/Giới thiệu sản phẩm ở phần cuối video/);
    expect(closing).not.toMatch(/Nhắc sản phẩm tự nhiên/);
    const handPicked = writingRules({ ...base, product: productRuleFor("none", true) });
    expect(handPicked).toMatch(/Nhắc sản phẩm tự nhiên/);
    expect(handPicked).not.toMatch(/phần cuối video/);
  });

  it("drops the default highlight once the direction states a story or a tone", () => {
    const highlight = /một ý đáng nhớ và một điểm nhấn/;
    expect(writingRules(base)).toMatch(highlight);
    expect(writingRules({ ...base, storyOrToneStated: true })).not.toMatch(highlight);
  });

  it("asks for the series' closing line only when there is one", () => {
    const closingLine = /"Câu kết" của định hướng/;
    expect(writingRules(base)).not.toMatch(closingLine);
    expect(writingRules({ ...base, closingStated: true })).toMatch(closingLine);
  });

  it("gives an edit that names no length no syllable budget to shorten or pad to", () => {
    expect(writingRules(base)).toMatch(/Tổng lời thoại khoảng \d+ âm tiết/);
    const edit = writingRules({ ...base, targetSec: null });
    expect(edit).not.toMatch(/âm tiết, lệch/);
    expect(edit).not.toMatch(/Video dọc dài khoảng/);
  });

  it("adds each accent's wording rule once", () => {
    const rules = writingRules({ ...base, accents: ["north", "north"] });
    expect(rules.match(/Giọng miền Bắc:/g)).toHaveLength(1);
    expect(writingRules(base)).not.toMatch(/giọng ghi cạnh tên/);
  });
});
