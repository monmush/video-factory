import { describe, expect, it } from "vitest";
import type { ScriptLine } from "./ipc";
import {
  type Alignment,
  type DirectorAnswer,
  heldSpans,
  heldTiming,
  holdErrors,
  holdInserts,
  lineOffsets,
  namedProduct,
  type PlanContext,
  partSplits,
  productFreeProps,
  readDirectorAnswer,
  rulesPlan,
  seatsFor,
  shotTimes,
  withHolds,
  withoutProducts,
} from "./shot-plan";

const line = (characterId: string, text: string): ScriptLine => ({
  characterId,
  speaker: characterId === "g" ? "Cô gái" : "Ông lão",
  text,
});
const LINES = [
  line("g", "Con đúng một trăm phần trăm, sao ai cũng cãi con?"),
  line("o", "Ừ, con cứ nói. Ông pha ấm Bạch Trà Shan Tuyết, con uống thử đi."),
  line("g", "Ơ… ông ơi, trà tràn ra bàn rồi kìa! Ông rót gì mà rót mãi vậy?"),
  line("o", "Chén đầy rồi thì rót thêm làm sao được."),
];
const CTX: PlanContext = {
  lines: LINES,
  cast: [
    { id: "g", name: "Cô gái" },
    { id: "o", name: "Ông lão" },
  ],
  products: [{ id: "p", name: "Bạch Trà Shan Tuyết" }],
  hasPlace: true,
};

const shot = (type: string, lineNo: number, text: string, extra: Record<string, unknown> = {}) => ({
  type,
  line: lineNo,
  text,
  visual: "v",
  why: "w",
  ...extra,
});

const GOOD: DirectorAnswer = {
  seats: [
    { character: "Cô gái", behind: "bamboo" },
    { character: "Ông lão", behind: "window" },
  ],
  props: [{ name: "teapot", where: "centre of the table" }],
  state_changes: [{ from_shot: 4, change: "tea spilled on the table" }],
  shots: [
    shot("speaker", 1, "Con đúng một trăm phần trăm, sao ai cũng cãi con?", {
      character: "Cô gái",
      framing: "medium_close",
    }),
    shot("wide", 2, "Ừ, con cứ nói.", {}),
    shot("detail", 2, "Ông pha ấm Bạch Trà Shan Tuyết, con uống thử đi.", {
      product: "Bạch Trà Shan Tuyết",
    }),
    shot("detail", 3, "Ơ… ông ơi, trà tràn ra bàn rồi kìa!", {}),
    shot("speaker", 3, "Ông rót gì mà rót mãi vậy?", { character: "Cô gái", framing: "close" }),
    shot("listener", 4, "Chén đầy rồi thì", { character: "Cô gái" }),
    shot("speaker", 4, "rót thêm làm sao được.", { character: "Ông lão", framing: "close" }),
  ],
};

describe("seats", () => {
  it("first speaker on the left looking right, second on the right looking left", () => {
    expect(seatsFor(["g", "o"])).toEqual([
      { characterId: "g", side: "left", looks: "frame_right" },
      { characterId: "o", side: "right", looks: "frame_left" },
    ]);
    expect(seatsFor(["g"])).toEqual([{ characterId: "g", side: "centre", looks: "camera" }]);
  });
});

describe("reading the director's answer", () => {
  it("maps names and products to ids and keeps a plan that follows the rules", () => {
    const fixed = structuredClone(GOOD);
    (fixed.shots as unknown[]).splice(
      5,
      2,
      shot("speaker", 4, "Chén đầy rồi thì rót thêm làm sao được.", {
        character: "Ông lão",
        framing: "close",
      }),
    );
    const { plan, errors } = readDirectorAnswer(fixed, CTX);
    expect(errors).toEqual([]);
    expect(plan.shots.map((s) => [s.kind, s.characterId, s.line, s.productId])).toEqual([
      ["speaker", "g", 0, null],
      ["wide", null, 1, null],
      ["detail", null, 1, "p"],
      ["detail", null, 2, null],
      ["speaker", "g", 2, null],
      ["speaker", "o", 3, null],
    ]);
    expect(plan.seats.map((s) => [s.characterId, s.looks, s.behind])).toEqual([
      ["g", "frame_right", "bamboo"],
      ["o", "frame_left", "window"],
    ]);
    expect(plan.stateChanges).toEqual([{ fromShot: 3, change: "tea spilled on the table" }]);
  });

  it("finds the mistakes a machine can check", () => {
    const { errors } = readDirectorAnswer(GOOD, CTX);
    expect(errors).toEqual([
      'Line 4: split "Chén đầy rồi thì" only right after a punctuation mark, never inside a phrase.',
    ]);
    const bad: DirectorAnswer = {
      shots: [
        shot("wide", 1, "Con đúng một trăm phần trăm, sao ai cũng cãi con?"),
        shot("speaker", 2, "Ừ, con cứ nói. Ông pha ấm", { character: "Cô gái" }),
        shot("speaker", 2, "Bạch Trà Shan Tuyết, con uống thử đi.", { character: "Ông lão" }),
        shot("speaker", 3, "Ơ… ông ơi, trà tràn ra bàn rồi kìa! Ông rót gì mà rót mãi vậy?", {
          character: "Cô gái",
        }),
        shot("detail", 4, "Chén đầy rồi thì rót thêm làm sao.", { product: "Trà khác" }),
      ],
    };
    expect(readDirectorAnswer(bad, CTX).errors).toEqual([
      "Shot 2: a speaker shot must show the person saying line 2.",
      'Shot 5: product "Trà khác" is not in this script.',
      'Line 2: split "Ừ, con cứ nói. Ông pha ấm" only right after a punctuation mark, never inside a phrase.',
      'Line 4: the shots\' text must reproduce the line exactly: "Chén đầy rồi thì rót thêm làm sao được.".',
    ]);
  });

  it("accepts any opening and closing shot, and no wide shot at all", () => {
    const answer: DirectorAnswer = {
      shots: [
        shot("wide", 1, "Con đúng một trăm phần trăm, sao ai cũng cãi con?"),
        shot("speaker", 2, "Ừ, con cứ nói. Ông pha ấm Bạch Trà Shan Tuyết, con uống thử đi.", {
          character: "Ông lão",
        }),
        shot("speaker", 3, "Ơ… ông ơi, trà tràn ra bàn rồi kìa! Ông rót gì mà rót mãi vậy?", {
          character: "Cô gái",
        }),
        shot("detail", 4, "Chén đầy rồi thì rót thêm làm sao được.", {}),
      ],
    };
    const { plan, errors } = readDirectorAnswer(answer, CTX);
    expect(errors).toEqual([]);
    expect(plan.shots.at(-1)?.hold).toBe(1);
    const listenerLast = structuredClone(answer);
    (listenerLast.shots as unknown[]).splice(
      3,
      1,
      shot("listener", 4, "Chén đầy rồi thì rót thêm làm sao được.", { character: "Cô gái" }),
    );
    expect(readDirectorAnswer(listenerLast, CTX).errors).toEqual([]);
    const noWide = structuredClone(answer);
    (noWide.shots as unknown[]).splice(
      0,
      1,
      shot("speaker", 1, "Con đúng một trăm phần trăm, sao ai cũng cãi con?", {
        character: "Cô gái",
      }),
    );
    expect(readDirectorAnswer(noWide, CTX).errors).toEqual([]);
  });

  it("asks for variety and long enough parts", () => {
    const lines = [line("g", "Một hai ba bốn năm."), line("o", "Sáu bảy tám chín mười, một.")];
    const ctx = { ...CTX, lines };
    const answer: DirectorAnswer = {
      shots: [
        shot("speaker", 1, "Một hai ba bốn năm.", { character: "Cô gái" }),
        shot("speaker", 2, "Sáu bảy tám chín mười,", { character: "Ông lão" }),
        shot("speaker", 2, "một.", { character: "Ông lão" }),
        shot("speaker", 2, "", { character: "Ông lão" }),
      ],
    };
    expect(readDirectorAnswer(answer, ctx).errors).toEqual([
      'Line 2: "một." is too short to be its own shot; keep it with its neighbour.',
      'Line 2: "" is too short to be its own shot; keep it with its neighbour.',
      "Shots 2–4: three alike in a row; vary the type or framing.",
    ]);
  });

  it("without a place, only speaker, listener and product shots", () => {
    const { errors } = readDirectorAnswer(GOOD, { ...CTX, hasPlace: false });
    expect(errors.filter((e) => e.includes("no place"))).toHaveLength(2);
  });
});

describe("rules plan", () => {
  it("one speaker per line, closing close-up, problems kept", () => {
    const plan = rulesPlan(CTX, ["no answer"]);
    expect(plan.shots.map((s) => [s.kind, s.characterId, s.framing])).toEqual([
      ["speaker", "g", "medium_close"],
      ["speaker", "o", "medium_close"],
      ["speaker", "g", "medium_close"],
      ["speaker", "o", "close"],
    ]);
    expect(plan.problems).toEqual(["no answer"]);
  });

  it("passes the checks a director's answer must pass", () => {
    const name = (id: string | null) => CTX.cast.find((c) => c.id === id)?.name ?? null;
    const answer: DirectorAnswer = {
      shots: rulesPlan(CTX).shots.map((s) => ({
        type: s.kind,
        character: name(s.characterId),
        framing: s.framing,
        line: s.line + 1,
        text: s.text,
        visual: s.visual,
        why: s.why,
        hold: s.hold ?? null,
      })),
    };
    expect(readDirectorAnswer(answer, CTX).errors).toEqual([]);
  });
});

describe("timing", () => {
  const spans = [
    { start: 0.2, end: 3 },
    { start: 3.4, end: 7 },
  ];
  it("shots tile the whole dialogue; cuts between lines sit mid-pause", () => {
    const times = shotTimes(
      [
        { line: 0, text: "a" },
        { line: 1, text: "b" },
      ],
      spans,
      7.3,
    );
    expect(times).toEqual([
      { start: 0, end: 3.2 },
      { start: 3.2, end: 7.3 },
    ]);
  });

  it("splits a line by syllables when no character timing exists", () => {
    expect(partSplits(["Một hai ba,", "bốn"], { start: 1, end: 5 })).toEqual([4]);
  });

  it("splits a line between the words from the provider's character timing", () => {
    const text = "[dry] Ừ, con cứ nói. Ông pha ấm";
    const chars = [...text];
    const alignment: Alignment = {
      characters: chars,
      characterStartTimesSeconds: chars.map((_, i) => i * 0.1),
      characterEndTimesSeconds: chars.map((_, i) => i * 0.1 + 0.08),
    };
    const at = text.indexOf("Ông");
    const [split] = partSplits(
      ["Ừ, con cứ nói.", "Ông pha ấm"],
      { start: 0, end: 3 },
      { alignment, chars: { start: 0, end: chars.length } },
    );
    expect(split).toBeCloseTo(((at - 2) * 0.1 + 0.08 + at * 0.1) / 2);
  });

  it("falls back to syllables when a part is not found in the timing", () => {
    const alignment: Alignment = {
      characters: [..."khác hẳn"],
      characterStartTimesSeconds: Array(8).fill(0),
      characterEndTimesSeconds: Array(8).fill(0),
    };
    expect(
      partSplits(
        ["Một hai ba,", "bốn"],
        { start: 1, end: 5 },
        { alignment, chars: { start: 0, end: 8 } },
      ),
    ).toEqual([4]);
  });
});

function passing(): DirectorAnswer {
  const fixed = structuredClone(GOOD);
  (fixed.shots as unknown[]).splice(
    5,
    2,
    shot("speaker", 4, "Chén đầy rồi thì rót thêm làm sao được.", {
      character: "Ông lão",
      framing: "close",
    }),
  );
  return fixed;
}

describe("products are never generated", () => {
  it("finds a product by its whole name only, with or without accents", () => {
    const names = ["Bạch Trà Shan Tuyết"];
    expect(namedProduct("A Bach Tra Shan Tuyet pouch", names)).toBe("Bạch Trà Shan Tuyết");
    expect(namedProduct("the shan tuyết tea", names)).toBeNull();
    expect(namedProduct("a cup of green tea", ["Mountain Green Tea"])).toBeNull();
    expect(namedProduct("MOUNTAIN green tea on the shelf", ["Mountain Green Tea"])).toBe(
      "Mountain Green Tea",
    );
    expect(namedProduct("the mountain green teapot", ["Mountain Green Tea"])).toBeNull();
    expect(namedProduct("A terracotta teapot and a cup of tea", names)).toBeNull();
    expect(namedProduct("Sơn Trà on the shelf", ["Sơn Trà"])).toBe("Sơn Trà");
  });

  it("packaging is caught by kind too, whatever the product", () => {
    expect(withoutProducts("A teapot on the mat. A tea bag stands beside it.", [])).toBe(
      "A teapot on the mat.",
    );
    expect(productFreeProps([{ name: "pouch", where: "by the pot" }], [])).toEqual([]);
    expect(withoutProducts("A clay jar of honey and a wooden box.", [])).toBe(
      "A clay jar of honey and a wooden box.",
    );
  });

  it("a sentence that rules packaging out is neither a fault nor dropped", () => {
    const text = "Tea cups on a wooden table. No packaging or labels in view.";
    expect(withoutProducts(text, [])).toBe(text);
    const answer = passing();
    (answer.shots as { visual?: string }[])[1] = {
      ...(answer.shots?.[1] as object),
      visual: text,
    };
    expect(readDirectorAnswer(answer, CTX).errors).toEqual([]);
  });

  it("a prop or a visual outside a product detail shot that names a product fails", () => {
    const answer = passing();
    answer.props = [
      { name: "teapot", where: "centre of the table" },
      { name: "Bạch Trà Shan Tuyết tea bag", where: "beside the teapot" },
    ];
    (answer.shots as { visual?: string }[])[1] = {
      ...(answer.shots?.[1] as object),
      visual: "The two at the table, Bach Tra Shan Tuyet between them.",
    };
    (answer.shots as { visual?: string }[])[2] = {
      ...(answer.shots?.[2] as object),
      visual: "Bạch Trà Shan Tuyết on the mat beside the teapot.",
    };
    expect(readDirectorAnswer(answer, CTX).errors).toEqual([
      'Shot 2: only a product detail shot may show or name "Bạch Trà Shan Tuyết"; describe the scene without it.',
      'Prop "Bạch Trà Shan Tuyết tea bag": products and their packaging are never props ("Bạch Trà Shan Tuyết").',
    ]);
  });

  it("still requests drop props and sentences that name a product, whatever the plan says", () => {
    const names = ["Bạch Trà Shan Tuyết"];
    expect(
      productFreeProps(
        [
          { name: "teapot", where: "centre" },
          { name: "tea bag", where: "Bach Tra Shan Tuyet, text facing the camera" },
        ],
        names,
      ),
    ).toEqual([{ name: "teapot", where: "centre" }]);
    expect(
      withoutProducts(
        "The pair sit at the table. The Bạch Trà Shan Tuyết bag stands by the pot.",
        names,
      ),
    ).toBe("The pair sit at the table.");
  });
});

describe("life in the background", () => {
  it("keeps a short ambient clause per seat and refuses a long one", () => {
    const answer = passing();
    answer.seats = [
      { character: "Cô gái", behind: "bamboo", ambient: "bamboo leaves stir in a light breeze" },
      { character: "Ông lão", behind: "window" },
    ];
    const { plan, errors } = readDirectorAnswer(answer, CTX);
    expect(errors).toEqual([]);
    expect(plan.seats.map((s) => s.ambient)).toEqual([
      "bamboo leaves stir in a light breeze",
      undefined,
    ]);
    answer.seats[1] = {
      character: "Ông lão",
      behind: "window",
      ambient:
        "the light shifts slowly across the plaster wall while the leaves of the plant move gently and dust floats",
    };
    expect(readDirectorAnswer(answer, CTX).errors).toEqual([
      "Seat of Ông lão: ambient is one short clause of at most 14 words.",
    ]);
  });
});

describe("holds (C15)", () => {
  it("the last shot always holds at least a second, also in the rules plan", () => {
    expect(readDirectorAnswer(passing(), CTX).plan.shots.at(-1)?.hold).toBe(1);
    const held = passing();
    (held.shots?.at(-1) as { hold?: number }).hold = 2;
    expect(readDirectorAnswer(held, CTX).plan.shots.at(-1)?.hold).toBe(2);
    expect(rulesPlan(CTX).shots.map((s) => s.hold)).toEqual([undefined, undefined, undefined, 1]);
  });

  it("1 to 2 seconds, only where a line ends, at most 4 in all", () => {
    expect(holdErrors([{ line: 0, hold: 2 }, { line: 1 }, { line: 1, hold: 1 }])).toEqual([]);
    expect(
      holdErrors([
        { line: 0, hold: 3 },
        { line: 1, hold: 1 },
        { line: 1, hold: 2 },
      ]),
    ).toEqual([
      "Shot 1: a hold lasts 1 to 2 seconds.",
      "Shot 2: only the shot that ends a line may hold.",
      "Holds add up to 6 seconds; at most 4, the last shot's included.",
    ]);
    expect(holdErrors([{ line: 0, hold: 2 }, { line: 1, hold: 2 }, { line: 2 }])).toEqual([
      "Holds add up to 5 seconds; at most 4, the last shot's included.",
    ]);
  });

  it("silence after a line moves every later shot; the inserts are found again from the job", () => {
    const shots = [{ line: 0, hold: 1.5 }, { line: 1 }, { line: 1, hold: 1 }];
    const spoken = [
      { start: 0, end: 3.2 },
      { start: 3.2, end: 5 },
      { start: 5, end: 7.3 },
    ];
    const { times, inserts } = withHolds(spoken, shots);
    expect(times).toEqual([
      { start: 0, end: 4.7 },
      { start: 4.7, end: 6.5 },
      { start: 6.5, end: 9.8 },
    ]);
    expect(inserts).toEqual([
      { line: 0, at: 3.2, sec: 1.5 },
      { line: 1, at: 7.3, sec: 1 },
    ]);
    expect(holdInserts(shots.map((s, i) => ({ ...s, end: times[i]?.end })))).toEqual(inserts);
    const offsets = lineOffsets(2, inserts);
    expect(offsets).toEqual([0, 1.5]);
    expect(
      heldSpans([{ start: 0.2, end: 3 }, undefined, { start: 3.4, end: 7 }], [0, 0, 1.5]),
    ).toEqual([{ start: 0.2, end: 3 }, undefined, { start: 4.9, end: 8.5 }]);
    const timing = heldTiming(
      {
        alignment: {
          characters: ["a", "b", "c"],
          characterStartTimesSeconds: [0, 1, 4],
          characterEndTimesSeconds: [0.5, 1.5, 4.5],
        },
        lineChars: [
          { start: 0, end: 2 },
          { start: 2, end: 3 },
        ],
      },
      offsets,
    );
    expect(timing.alignment.characterStartTimesSeconds).toEqual([0, 1, 5.5]);
    expect(timing.alignment.characterEndTimesSeconds).toEqual([0.5, 1.5, 6]);
  });
});

describe("sounds without words", () => {
  it("a line's last part ending in a sound is still found in the voice's timing", () => {
    const text = "[dry] Ừ, con cứ nói. Ông pha ấm [laughs]";
    const chars = [...text];
    const alignment: Alignment = {
      characters: chars,
      characterStartTimesSeconds: chars.map((_, i) => i * 0.1),
      characterEndTimesSeconds: chars.map((_, i) => i * 0.1 + 0.08),
    };
    const at = text.indexOf("Ông");
    const [split] = partSplits(
      ["Ừ, con cứ nói.", "Ông pha ấm [cười]"],
      { start: 0, end: 4 },
      { alignment, chars: { start: 0, end: chars.length } },
    );
    expect(split).toBeCloseTo(((at - 2) * 0.1 + 0.08 + at * 0.1) / 2);
  });
});
