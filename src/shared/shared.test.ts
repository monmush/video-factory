import { describe, expect, it } from "vitest";
import { boardOrder, formatSeconds, MAX_HOLDS_SEC, syllables } from "./board";
import { cleanHandleInput, toHandle } from "./handle";
import { HIDDEN_CHAT_MODELS, resolveChoice, type Script } from "./ipc";
import { estimateSeconds, paceFor } from "./pace";

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

  it("counts every hold at its cap before a plan exists, so the plan never adds length or price", () => {
    const lines = [{ text: "Trà ngon uống chậm thôi." }, { text: "Dạ, con mời bà." }];
    const speaking = syllables(lines) / paceFor(lines, 30);
    expect(estimateSeconds(lines, 30) - speaking).toBeGreaterThanOrEqual(MAX_HOLDS_SEC);
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

describe("chat model choice", () => {
  it("always names a model and effort: saves from when Claude Code chose map to the default", () => {
    expect(resolveChoice({ model: "default", effort: null })).toEqual({
      model: "opus",
      effort: "medium",
    });
    expect(resolveChoice(null)).toEqual({ model: "opus", effort: "medium" });
  });

  it("never offers Fable, which uses up a plan's limits far too fast for batch writing", () => {
    expect(HIDDEN_CHAT_MODELS).toContain("fable");
    expect(resolveChoice({ model: "fable", effort: "high" }).model).toBe("opus");
  });
});
