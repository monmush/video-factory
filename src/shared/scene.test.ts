import { describe, expect, it } from "vitest";
import { plannedShotSec } from "./live-plan";
import { sceneBrief, sceneFraming, sceneSeconds, spokenParts } from "./scene";

const KEYFRAMES = [
  { id: "ots", framing: "Over-the-shoulder medium close-up of Ba, from behind An's shoulder" },
  { id: "close", framing: "Close-up on An's face at eye level" },
];

describe("scene framing", () => {
  const person = { kind: "speaker", framing: "medium_close", productId: null } as const;

  it("labels a person's shot by its picture, then its own framing", () => {
    expect(sceneFraming({ ...person, keyframe: "ots" }, KEYFRAMES)).toBe("Qua vai");
    expect(sceneFraming({ ...person, kind: "listener", keyframe: "ots" }, KEYFRAMES)).toBe(
      "Qua vai",
    );
    expect(sceneFraming({ ...person, framing: "close", keyframe: "close" }, KEYFRAMES)).toBe(
      "Cận mặt",
    );
    expect(sceneFraming(person)).toBe("Trung cảnh");
    expect(sceneFraming({ ...person, keyframe: "missing" }, KEYFRAMES)).toBe("Trung cảnh");
  });

  it("labels wide and detail shots by kind", () => {
    expect(sceneFraming({ kind: "wide", framing: null, productId: null })).toBe("Toàn cảnh");
    expect(sceneFraming({ kind: "detail", framing: null, productId: "p" })).toBe("Sản phẩm");
    expect(sceneFraming({ kind: "detail", framing: null, productId: null })).toBe("Cận chi tiết");
  });
});

describe("scene length", () => {
  it("uses the shot's place in the video when known, whole seconds, at least 1", () => {
    expect(sceneSeconds({ text: "x", start: 1.2, end: 4.6 }, 4)).toBe(3);
    expect(sceneSeconds({ text: "x", start: 0, end: 0.2 }, 4)).toBe(1);
  });

  it("estimates from the words and the hold before the voice exists", () => {
    const words = "Ông ơi, ba ngày rồi con chưa đi được, ông có cách nào không";
    expect(sceneSeconds({ text: words }, 4)).toBe(Math.round(plannedShotSec({ text: words }, 4)));
    expect(sceneSeconds({ text: words, hold: 2 }, 4)).toBe(
      Math.round(plannedShotSec({ text: words, hold: 2 }, 4)),
    );
    expect(sceneSeconds({ text: "À" }, 4)).toBe(1);
  });
});

describe("scene brief", () => {
  it("keeps a sentence and drops the short labels of older plans", () => {
    expect(
      sceneBrief({
        brief: " Cô gái ôm bụng, nhăn mặt nhìn sang ông lão;  sau lưng là khóm trúc. ",
      }),
    ).toBe("Cô gái ôm bụng, nhăn mặt nhìn sang ông lão; sau lưng là khóm trúc.");
    expect(sceneBrief({ brief: "Cận Lan, hơi ngượng" })).toBeNull();
    expect(sceneBrief({ brief: "Ông lão" })).toBeNull();
    expect(sceneBrief({})).toBeNull();
  });
});

describe("spoken parts", () => {
  it("separates bracketed sounds from speech", () => {
    expect(spokenParts("Thật à [cười khẽ]")).toEqual([
      { text: "Thật à", sound: false },
      { text: "[cười khẽ]", sound: true },
    ]);
    expect(spokenParts("Chào ông")).toEqual([{ text: "Chào ông", sound: false }]);
  });
});
