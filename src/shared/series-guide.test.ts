import { describe, expect, it } from "vitest";
import {
  answerQuestion,
  confirmGuide,
  directionText,
  editGuide,
  effectiveMention,
  guideFromAnswer,
  guideFromText,
  missingCast,
  type SeriesGuide,
  summaryLine,
} from "./series-guide";

const options = [
  { label: "Thân mật", text: "Hai bạn thân xưng mày tao." },
  { label: "Lịch sự", text: "Hai đồng nghiệp xưng anh em." },
];

const drafted = (): SeriesGuide => ({
  lines: {
    people: { text: "Hai đồng nghiệp.", guessed: true },
    tone: { text: "Nhẹ nhàng.", guessed: true },
  },
  productMention: "natural",
  productMentionGuessed: true,
  targetSec: 45,
  targetSecGuessed: true,
  questions: [
    { id: "q1", slot: "people", ask: "Xưng hô thế nào?", options },
    { id: "q2", slot: "tone", ask: "Mức độ?", options },
  ],
});

describe("reading the drafted guide", () => {
  it("keeps what is usable from a malformed answer and drops bad questions", () => {
    const { guide, title } = guideFromAnswer({
      title: "  Chuyện   văn phòng ",
      story: { text: "  Mỗi tập   một rắc rối.\n", guessed: false },
      tone: { text: "", guessed: true },
      look: "Ánh sáng ấm",
      closing: 42,
      productMention: "sometimes",
      targetSec: 600,
      castMentioned: -1,
      questions: [
        { slot: "people", ask: "Xưng hô?", options },
        { slot: "people", ask: "Chỉ một lựa chọn?", options: [options[0]] },
        { slot: "unknown", ask: "Mục lạ?", options },
        { slot: "tone", ask: "", options },
        { slot: "story", ask: "Kết thế nào?", options: [...options, { label: "", text: "x" }] },
        { slot: "look", ask: "Câu thứ ba?", options },
      ],
    });
    expect(title).toBe("Chuyện văn phòng");
    expect(guide.lines).toEqual({
      story: { text: "Mỗi tập một rắc rối." },
      look: { text: "Ánh sáng ấm" },
    });
    expect(guide.productMention).toBe("natural");
    expect(guide.productMentionGuessed).toBe(true);
    expect(guide.targetSec).toBe(180);
    expect(guide.targetSecGuessed).toBeUndefined();
    expect(guide.castMentioned).toBeUndefined();
    expect(guide.questions?.map((q) => [q.id, q.slot, q.options.length])).toEqual([
      ["q1", "people", 2],
      ["q2", "story", 2],
    ]);
  });

  it("marks an unstated length as guessed at the default", () => {
    const { guide } = guideFromAnswer({ story: { text: "Chuyện" }, targetSec: null });
    expect(guide.targetSec).toBe(45);
    expect(guide.targetSecGuessed).toBe(true);
  });

  it("fails a draft that has no usable line", () => {
    expect(() => guideFromAnswer({ story: { text: "  " }, tone: null })).toThrow();
    expect(() => guideFromAnswer("not an object")).toThrow();
  });
});

describe("what the writer and the director read", () => {
  it("lists the filled slots in order, without product or length", () => {
    const guide = editGuide(drafted(), { lines: { closing: "Hẹn gặp lại." } });
    expect(directionText({ guidance: "thô", guide })).toBe(
      "Nhân vật: Hai đồng nghiệp.\nGiọng điệu: Nhẹ nhàng.\nCâu kết: Hẹn gặp lại.",
    );
  });

  it("falls back to the raw description without a guide", () => {
    expect(directionText({ guidance: "  Hai người bạn kể chuyện.  " })).toBe(
      "Hai người bạn kể chuyện.",
    );
    expect(summaryLine({ guidance: "\n  Dòng đầu\nDòng hai" })).toBe("Dòng đầu");
  });

  it("summarises by the story first", () => {
    const guide = editGuide(drafted(), { lines: { story: "Mỗi tập một chuyện." } });
    expect(summaryLine({ guidance: "", guide })).toBe("Mỗi tập một chuyện.");
    expect(summaryLine({ guidance: "", guide: drafted() })).toBe("Hai đồng nghiệp.");
  });
});

describe("correcting the guide", () => {
  it("clears the guess and the questions of the edited slot only", () => {
    const guide = editGuide(drafted(), { lines: { people: "Hai bạn thân." } });
    expect(guide.lines.people).toEqual({ text: "Hai bạn thân." });
    expect(guide.lines.tone).toEqual({ text: "Nhẹ nhàng.", guessed: true });
    expect(guide.questions?.map((q) => q.id)).toEqual(["q2"]);
  });

  it("keeps a slot whose text did not change and removes an emptied one", () => {
    const guide = editGuide(drafted(), { lines: { people: "Hai đồng nghiệp.", tone: "  " } });
    expect(guide.lines.people?.guessed).toBe(true);
    expect(guide.lines.tone).toBeUndefined();
    expect(guide.questions?.map((q) => q.id)).toEqual(["q1"]);
  });

  it("clears the guess of a changed product rule or length", () => {
    const guide = editGuide(drafted(), { productMention: "none", targetSec: 30 });
    expect(guide).toMatchObject({ productMention: "none", targetSec: 30 });
    expect(guide.productMentionGuessed).toBeUndefined();
    expect(guide.targetSecGuessed).toBeUndefined();
  });

  it("answers a question with the option's text, or just dismisses it", () => {
    const answered = answerQuestion(drafted(), "q1", 1);
    expect(answered.lines.people).toEqual({ text: "Hai đồng nghiệp xưng anh em." });
    expect(answered.questions?.map((q) => q.id)).toEqual(["q2"]);
    const dismissed = answerQuestion(drafted(), "q2", null);
    expect(dismissed.lines.tone?.guessed).toBe(true);
    expect(dismissed.questions?.map((q) => q.id)).toEqual(["q1"]);
    expect(() => answerQuestion(drafted(), "q1", 5)).toThrow();
  });

  it("confirming clears every guess and question", () => {
    const guide = confirmGuide(drafted(), "2026-01-01T00:00:00.000Z");
    expect(guide).toEqual({
      lines: { people: { text: "Hai đồng nghiệp." }, tone: { text: "Nhẹ nhàng." } },
      productMention: "natural",
      targetSec: 45,
      confirmedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("keeps the line breaks of sample dialogue", () => {
    const edited = editGuide(drafted(), {
      lines: { tone: "Bỗ bã.  Ví dụ:\n  A: Biết gì mà nói.\n\n\n\nB: Ơ hay." },
    });
    expect(edited.lines.tone?.text).toBe("Bỗ bã. Ví dụ:\nA: Biết gì mà nói.\n\nB: Ơ hay.");
  });

  it("starts from the raw description when there is no guide yet", () => {
    expect(guideFromText("  Hai người\n bạn  ")).toEqual({
      lines: { story: { text: "Hai người\nbạn" } },
      productMention: "natural",
      targetSec: 45,
    });
  });
});

describe("rules the guide implies", () => {
  it("names no product when the series has none, whatever the guide says", () => {
    expect(effectiveMention({ ...drafted(), productMention: "closing" }, 0)).toBe("none");
    expect(effectiveMention({ ...drafted(), productMention: "closing" }, 2)).toBe("closing");
    expect(effectiveMention(undefined, 1)).toBe("natural");
  });

  it("counts the characters the description mentions but the series lacks", () => {
    expect(missingCast({ ...drafted(), castMentioned: 3 }, 1)).toBe(2);
    expect(missingCast({ ...drafted(), castMentioned: 1 }, 2)).toBe(0);
    expect(missingCast(undefined, 0)).toBe(0);
  });
});
