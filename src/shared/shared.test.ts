import { describe, expect, it } from "vitest";
import { boardOrder, estimateSeconds, formatSeconds, syllables } from "./board";
import { cleanHandleInput, toHandle } from "./handle";
import type { Script } from "./ipc";

describe("boardOrder", () => {
  const s = (id: string, pinned = false, deleted = false) =>
    ({ id, pinned, deletedAt: deleted ? "x" : null }) as Script;

  it("puts pinned scripts first and leaves deleted ones out, keeping board order", () => {
    const order = boardOrder([s("a"), s("b", true), s("c", false, true), s("d", true), s("e")]);
    expect(order.map((x) => x.id)).toEqual(["b", "d", "a", "e"]);
  });
});

describe("length estimate", () => {
  it("counts Vietnamese syllables, ignoring punctuation-only tokens", () => {
    expect(syllables([{ text: "Trà ngon — uống chậm thôi." }])).toBe(5);
  });

  it("is zero for an empty script", () => {
    expect(estimateSeconds([])).toBe(0);
  });

  it("formats seconds and minutes", () => {
    expect(formatSeconds(42.4)).toBe("42 giây");
    expect(formatSeconds(65)).toBe("1 phút 5 giây");
    expect(formatSeconds(120)).toBe("2 phút");
  });
});

describe("handles", () => {
  it("strips Vietnamese diacritics and đ", () => {
    expect(toHandle("Bà Chủ Quán")).toBe("ba-chu-quan");
    expect(toHandle("Ông Đạo")).toBe("ong-dao");
  });

  it("keeps a trailing dash while typing", () => {
    expect(cleanHandleInput("@Trà ")).toBe("tra-");
  });
});
