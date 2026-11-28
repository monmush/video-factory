import { describe, expect, it } from "vitest";
import {
  accentOfVoice,
  ageBand,
  characterVoiceTraits,
  defaultVoiceText,
  guessVoiceTraits,
  isUploadedSample,
  type SavedAsset,
  voiceRegion,
  withVoiceTexts,
} from "./voices";

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

describe("a character's default voice", () => {
  const oldMan = characterVoiceTraits("Ông Ba", "Ông cụ khoảng 70 tuổi");

  it("says gender, age band and region, and is the same every time", () => {
    expect(defaultVoiceText(oldMan)).toBe("Giọng nam lớn tuổi, miền Bắc, trầm ấm, chậm rãi");
    expect(defaultVoiceText(oldMan)).toBe(defaultVoiceText(oldMan));
  });

  it("never gives a second character a voice another one already has", () => {
    const first = defaultVoiceText(oldMan);
    const second = defaultVoiceText(oldMan, [` ${first.toUpperCase()} `]);
    expect(second).not.toBe(first);
    expect(defaultVoiceText(oldMan, [first, second])).not.toBe(second);
  });

  it("reuses the first variant once all three are taken", () => {
    const taken: string[] = [];
    for (let i = 0; i < 3; i++) taken.push(defaultVoiceText(oldMan, taken));
    expect(new Set(taken).size).toBe(3);
    expect(defaultVoiceText(oldMan, taken)).toBe(taken[0]);
  });
});

describe("the region of a voice", () => {
  it("is Northern unless the description names another region or a country", () => {
    expect(voiceRegion("Cô gái bán trà")).toBe("miền Bắc");
    expect(voiceRegion("Bà cụ sống ở Huế")).toBe("miền Trung");
    expect(voiceRegion("Anh shipper người Sài Gòn")).toBe("miền Nam");
    expect(voiceRegion("Cô gái người Hàn Quốc đi du lịch Hà Nội")).toBe(
      "người Hàn Quốc nói tiếng Việt",
    );
  });

  it("takes the first place named", () => {
    expect(voiceRegion("Người Hà Nội, mới vào Sài Gòn làm việc")).toBe("miền Bắc");
  });

  it("gives the writing rules an accent only when the voice text names a region", () => {
    expect(accentOfVoice("Giọng nam trẻ, miền Bắc, sáng")).toBe("north");
    expect(accentOfVoice("Giọng nữ, giọng Huế nhẹ nhàng")).toBe("central");
    expect(accentOfVoice("Giọng nam trung niên, miền Tây, chậm")).toBe("south");
    expect(accentOfVoice("Giọng nam trẻ, sáng")).toBeUndefined();
    expect(accentOfVoice("Giọng nam trung niên, người Nhật nói tiếng Việt")).toBeUndefined();
  });
});

describe("saved characters from before voices were texts", () => {
  const character = (id: string, fields: Partial<SavedAsset> = {}): SavedAsset => ({
    id,
    kind: "character",
    name: "Ông lão",
    handle: id,
    description: "",
    images: [],
    createdAt: "",
    updatedAt: "",
    ...fields,
  });

  it("turns a catalogue voice into its text and drops the old id", () => {
    const [mai, tuanAnh] = withVoiceTexts([
      character("a", { voiceId: "mai" }),
      character("b", { voiceId: "tuan-anh" }),
    ]);
    expect(mai?.voice).toBe("Giọng nữ trẻ, miền Bắc, tươi sáng, tự nhiên");
    expect(tuanAnh?.voice).toBe("Giọng nam lớn tuổi, miền Bắc, trầm ấm, kể chuyện");
    expect(mai).not.toHaveProperty("voiceId");
  });

  it("gives every other character a default no one else has, and leaves other kinds alone", () => {
    const taken = defaultVoiceText(characterVoiceTraits("Ông lão", ""));
    const [kept, unknown, none, product] = withVoiceTexts([
      character("a", { voice: taken }),
      character("b", { voiceId: "gone" }),
      character("c"),
      character("p", { kind: "product" }),
    ]);
    expect(kept?.voice).toBe(taken);
    expect(unknown?.voice).toMatch(/^Giọng nam lớn tuổi, miền Bắc/);
    expect(new Set([taken, unknown?.voice, none?.voice]).size).toBe(3);
    expect(product).not.toHaveProperty("voice");
  });
});

describe("the name of an uploaded voice sample", () => {
  it("accepts only an upload name, never a path or a generated sample", () => {
    const hex = "a".repeat(64);
    expect(isUploadedSample(`upload-${hex}.mp3`)).toBe(true);
    expect(isUploadedSample(`${hex}.mp3`)).toBe(false);
    expect(isUploadedSample(`../upload-${hex}.mp3`)).toBe(false);
    expect(isUploadedSample(`upload-${hex}.mp3/x`)).toBe(false);
    expect(isUploadedSample(`upload-${hex}.mp3.tmp.mp3`)).toBe(false);
  });
});
