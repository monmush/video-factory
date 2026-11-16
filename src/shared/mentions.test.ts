import { describe, expect, it } from "vitest";
import { findAt, findHash, insertMention, matchProducts, matchScripts } from "./mentions";

describe("tokens before the caret", () => {
  it("finds a # or @ that starts a word", () => {
    expect(findHash("xem #2", 6)).toEqual({ start: 4, query: "2" });
    expect(findAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(findAt("video @hồng-trà", 15)).toEqual({ start: 6, query: "hồng-trà" });
    expect(findAt("mail@hong", 9)).toBeNull();
    expect(findAt("@hong tra", 9)).toBeNull();
    expect(findAt("@hong tra", 5)).toEqual({ start: 0, query: "hong" });
  });

  it("never finds both at once", () => {
    expect(findHash("#a @b", 5)).toBeNull();
    expect(findAt("#a @b", 5)).toEqual({ start: 3, query: "b" });
    expect(findAt("@a #b", 5)).toBeNull();
  });
});

describe("matching", () => {
  it("matches scripts by number or title", () => {
    const scripts = [{ title: "Kiên nhẫn" }, { title: "Trà sớm" }];
    expect(matchScripts(scripts, "2")).toEqual([scripts[1]]);
    expect(matchScripts(scripts, "kien")).toEqual([scripts[0]]);
  });

  it("lists the series' products first, then the library, ignoring diacritics", () => {
    const assets = [
      { id: "a", kind: "product", name: "Bạch Trà", handle: "bach-tra" },
      { id: "b", kind: "product", name: "Hồng Trà", handle: "hong" },
      { id: "c", kind: "character", name: "Bà Hồng", handle: "ba-hong" },
      { id: "d", kind: "product", name: "Cổ Thụ", handle: "co-thu" },
    ];
    expect(matchProducts(assets, ["d", "b"], "").map((p) => p.id)).toEqual(["d", "b", "a"]);
    expect(matchProducts(assets, [], "hồng trà").map((p) => p.id)).toEqual(["b"]);
    expect(matchProducts(assets, [], "tra").map((p) => p.id)).toEqual(["a", "b"]);
    expect(matchProducts(assets, [], "zzz")).toEqual([]);
  });
});

describe("inserting a mention", () => {
  it("replaces the token and puts the caret after the trailing space", () => {
    const text = "làm 2 video @ho rồi";
    const token = findAt(text, 15);
    expect(token).not.toBeNull();
    if (!token) return;
    expect(insertMention(text, 15, token, "hong-tra")).toEqual({
      text: "làm 2 video @hong-tra  rồi",
      caret: 22,
    });
  });
});
