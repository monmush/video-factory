import { describe, expect, it } from "vitest";
import type { Asset } from "./ipc";
import {
  ageBand,
  guessVoiceTraits,
  resolveVoice,
  suggestVoice,
  takenVoiceIds,
  VOICES,
} from "./voices";

describe("voice catalogue", () => {
  it("has voices with unique ids, all Northern", () => {
    expect(new Set(VOICES.map((v) => v.id)).size).toBe(VOICES.length);
    expect(VOICES.every((v) => v.accent === "north")).toBe(true);
  });
});

describe("guessVoiceTraits", () => {
  it("reads forms of address in the name", () => {
    expect(guessVoiceTraits("Ông lão", "")).toEqual({ gender: "male", age: "old" });
    expect(guessVoiceTraits("Bà Tư", "")).toEqual({ gender: "female", age: "old" });
    expect(guessVoiceTraits("Chị Hoa", "")).toEqual({ gender: "female", age: "young" });
    expect(guessVoiceTraits("Chú Ba", "")).toEqual({ gender: "male", age: "middle" });
    expect(guessVoiceTraits("Cụ Đồ", "")).toEqual({ age: "old" });
  });

  it("prefers an age in years over other clues", () => {
    expect(guessVoiceTraits("Cô Lan", "Người phụ nữ khoảng 45 tuổi, tóc búi.")).toEqual({
      gender: "female",
      age: "middle",
    });
    expect(guessVoiceTraits("", "Người đàn ông khoảng 60–70 tuổi")).toEqual({
      gender: "male",
      age: "old",
    });
    expect(guessVoiceTraits("", "Cô gái ngoài 20 tuổi")).toEqual({
      gender: "female",
      age: "young",
    });
  });

  it("reads plain words for gender and age", () => {
    expect(guessVoiceTraits("Khách", "Nhân vật nam, trung niên")).toEqual({
      gender: "male",
      age: "middle",
    });
    expect(guessVoiceTraits("", "Một nữ nhân viên trẻ")).toEqual({
      gender: "female",
      age: "young",
    });
    expect(guessVoiceTraits("", "Người lớn tuổi, dáng gầy")).toEqual({ age: "old" });
    expect(guessVoiceTraits("", "Bác gái tóc bạc")).toEqual({ gender: "female", age: "old" });
  });

  it("does not match keywords inside other words or other meanings", () => {
    expect(guessVoiceTraits("", "Áo xanh, ngồi bên bàn gỗ, công phu, năm ấy")).toEqual({});
    expect(guessVoiceTraits("", "Phong cách Việt Nam, vẻ cô đơn, chú ý chi tiết")).toEqual({});
    expect(guessVoiceTraits("", "Mặc áo bác sĩ, cầm dụng cụ pha trà")).toEqual({});
  });

  it("does not read a given name as a form of address", () => {
    expect(guessVoiceTraits("Mai Anh", "Cô gái trẻ")).toEqual({ gender: "female", age: "young" });
  });

  it("handles decomposed diacritics (macOS input)", () => {
    expect(guessVoiceTraits("Bà ngoại".normalize("NFD"), "")).toEqual({
      gender: "female",
      age: "old",
    });
  });

  it("returns nothing when the text says nothing", () => {
    expect(guessVoiceTraits("Tèo", "Áo nâu, khăn rằn")).toEqual({});
  });

  it("bands ages at 35 and 60", () => {
    expect([34, 35, 59, 60].map(ageBand)).toEqual(["young", "middle", "middle", "old"]);
  });
});

describe("suggestVoice", () => {
  it("gives the approved pair to an elderly man and a young woman", () => {
    expect(suggestVoice({ gender: "male", age: "old" })).toBe("tuan-anh");
    expect(suggestVoice({ gender: "female", age: "young" })).toBe("mai");
  });

  it("matches age within the gender", () => {
    expect(suggestVoice({ gender: "male", age: "young" })).toBe("ninh");
    expect(suggestVoice({ gender: "male", age: "middle" })).toBe("lam");
    expect(suggestVoice({ gender: "female", age: "middle" })).toBe("hien");
  });

  it("gives an old woman a middle-aged female voice", () => {
    expect(suggestVoice({ gender: "female", age: "old" })).toBe("hien");
  });

  it("falls back to the gender default, then the overall default", () => {
    expect(suggestVoice({ gender: "male" })).toBe("tuan-anh");
    expect(suggestVoice({ gender: "female" })).toBe("mai");
    expect(suggestVoice({})).toBe("mai");
  });

  it("skips voices other characters use while the gender has a free one", () => {
    expect(suggestVoice({ gender: "male", age: "old" }, ["tuan-anh"])).toBe("lam");
    expect(suggestVoice({ gender: "female" }, ["mai"])).toBe("nhu");
  });

  it("reuses the best match when every voice of the gender is taken", () => {
    const females = VOICES.filter((v) => v.gender === "female").map((v) => v.id);
    expect(suggestVoice({ gender: "female", age: "young" }, females)).toBe("mai");
  });
});

describe("resolveVoice", () => {
  const character = (voiceId?: string, id = "c1") =>
    ({ id, kind: "character", name: "Ông lão", description: "", voiceId }) as Asset;

  it("keeps a saved voice", () => {
    expect(resolveVoice(character("lam"))).toBe("lam");
  });

  it("suggests when the saved voice is missing or unknown", () => {
    expect(resolveVoice(character())).toBe("tuan-anh");
    expect(resolveVoice(character("gone"), ["tuan-anh"])).toBe("lam");
  });

  it("lists voices saved on other characters", () => {
    const assets = [
      character("mai", "a"),
      character("gone", "b"),
      character("lam", "c"),
      { ...character("son", "d"), kind: "product" } as Asset,
    ];
    expect(takenVoiceIds(assets, "c")).toEqual(["mai"]);
  });
});
