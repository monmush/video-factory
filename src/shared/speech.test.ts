import { describe, expect, it } from "vitest";
import { shotTimes, withHolds } from "./shot-plan";
import {
  type GroupedShot,
  type HeardSegment,
  newSegment,
  SPEECH_LEAD_SEC,
  segmentCutOff,
  speechBounds,
  speechCutOff,
  speechSegments,
  speechTimeline,
  wantedSec,
} from "./speech";

const shot = (
  index: number,
  lineIndex: number,
  kind: GroupedShot["kind"],
  text: string,
  extra: Partial<GroupedShot> = {},
): GroupedShot => ({
  index,
  lineIndex,
  kind,
  text,
  characterId: kind === "speaker" ? (lineIndex % 2 ? "b" : "a") : null,
  ...extra,
});

const LINES = [{ characterId: "a" }, { characterId: "b" }];
const frameOf = (s: GroupedShot) => `frame-of-${s.index}`;
const portrait = (id: string) => `portrait-${id}`;

describe("speech segments", () => {
  it("a speaker shot in the middle of a line starts a new segment; cutaways ride on the one before", () => {
    const segments = speechSegments(
      LINES,
      [
        shot(0, 0, "speaker", "Chào ông,"),
        shot(1, 0, "detail", "hôm nay"),
        shot(2, 0, "speaker", "trời đẹp quá ạ.", { hold: 1 }),
      ],
      frameOf,
      portrait,
    );
    expect(segments.map((s) => s.shots)).toEqual([[0, 1], [2]]);
    expect(segments.map((s) => s.text)).toEqual(["Chào ông, hôm nay", "trời đẹp quá ạ."]);
    expect(segments.map((s) => s.frame)).toEqual(["frame-of-0", "frame-of-2"]);
    expect(segments.map((s) => s.hold)).toEqual([0, 1]);
  });

  it("a cutaway before the first speaker shot belongs to that speaker shot's segment", () => {
    const [segment] = speechSegments(
      LINES,
      [shot(0, 0, "wide", "Ừ cháu ngồi đây,"), shot(1, 0, "speaker", "uống chén trà đã cháu.")],
      frameOf,
      portrait,
    );
    expect(segment?.shots).toEqual([0, 1]);
    expect(segment?.speakerShot).toBe(1);
    expect(segment?.text).toBe("Ừ cháu ngồi đây, uống chén trà đã cháu.");
    expect(segment?.frame).toBe("frame-of-1");
  });

  it("a line without a speaker shot speaks from a picture of its speaker", () => {
    const segments = speechSegments(
      LINES,
      [
        shot(0, 0, "speaker", "Chào ông."),
        shot(1, 1, "listener", "Ừ,", { characterId: "a" }),
        shot(2, 1, "detail", "ngồi xuống đi."),
      ],
      frameOf,
      portrait,
    );
    const second = segments[1];
    expect(second).toMatchObject({ line: 1, shots: [1, 2], speakerShot: null, characterId: "b" });
    expect(second?.frame).toBe("portrait-b");
  });
});

describe("how long a segment is asked for", () => {
  it("covers the words, a sound after them and the hold, plus a margin", () => {
    const plain = { text: "một hai ba bốn năm sáu bảy tám chín mười", hold: 0 };
    const laughing = { text: "một hai ba bốn năm sáu bảy tám chín mười [cười]", hold: 1 };
    expect(wantedSec(laughing) - wantedSec(plain)).toBeCloseTo(2);
  });

  it("speech cut off at the end asks again longer, as one failed attempt", () => {
    const sent = {
      ...newSegment({
        id: "line-1-1",
        line: 0,
        shots: [0],
        speakerShot: 0,
        characterId: "a",
        text: "Chào ông, hôm nay trời đẹp quá ạ.",
        frame: "f",
        hold: 0,
      }),
      state: "rendering" as const,
      model: "veo-3.1-fast",
      seconds: 4,
      requestId: "r",
      costUsd: 0.6,
    };
    const again = segmentCutOff(sent, "wan-3");
    expect(again).toMatchObject({ state: "queued", retried: true, atLeastSec: 6, cutOffs: 1 });
    expect(again.requestId).toBeUndefined();
    expect(
      segmentCutOff({ ...again, state: "rendering", model: "veo-3.1-fast", seconds: 6 }, "wan-3")
        .state,
    ).toBe("failed");
  });
});

const LOG = (lines: string[]) => lines.map((l) => `[silencedetect @ 0x1] ${l}`).join("\n");

describe("speech in a clip", () => {
  it("is what lies between the leading and the trailing quiet", () => {
    const log = LOG([
      "silence_start: 0",
      "silence_end: 0.46 | silence_duration: 0.46",
      "silence_start: 1.2",
      "silence_end: 1.6 | silence_duration: 0.4",
      "silence_start: 2.87",
      "silence_end: 5.02 | silence_duration: 2.15",
    ]);
    const bounds = speechBounds(log, 5);
    expect(bounds).toEqual({ start: 0.46, end: 2.87 });
    expect(speechCutOff(bounds as { start: number; end: number }, 5)).toBe(false);
  });

  it("speech that runs to the very end of the clip is cut off", () => {
    const log = LOG(["silence_start: 0", "silence_end: 0.3 | silence_duration: 0.3"]);
    const bounds = speechBounds(log, 4) as { start: number; end: number };
    expect(bounds).toEqual({ start: 0.3, end: 4 });
    expect(speechCutOff(bounds, 4)).toBe(true);
  });

  it("a trailing quiet that is never closed still ends the speech", () => {
    expect(speechBounds(LOG(["silence_start: 3.1"]), 6)).toEqual({ start: 0, end: 3.1 });
  });

  it("a clip that is quiet throughout has no speech", () => {
    expect(speechBounds(LOG(["silence_start: 0", "silence_end: 6 | silence_duration: 6"]), 6)).toBe(
      null,
    );
  });
});

describe("the dialogue timeline from the segments", () => {
  const heard: HeardSegment[] = [
    { id: "a", line: 0, text: "Chào ông, hôm nay", clipSec: 5, speech: { start: 0.5, end: 2.5 } },
    { id: "b", line: 0, text: "trời đẹp quá ạ.", clipSec: 4, speech: { start: 0.1, end: 1.2 } },
    { id: "c", line: 1, text: "Ừ, ngồi xuống đi.", clipSec: 6, speech: { start: 1, end: 3 } },
  ];

  it("joins each segment's speech with a short lead-in and lead-out, in line order", () => {
    const t = speechTimeline([heard[2], heard[0], heard[1]] as HeardSegment[], 2);
    const lead = SPEECH_LEAD_SEC;
    expect(t.pieces.map((p) => p.segment)).toEqual(["a", "b", "c"]);
    expect(t.pieces[0]).toEqual({ segment: "a", from: 0.5 - lead, to: 2.5 + lead, at: 0 });
    const first = 2 + 2 * lead;
    const second = 1.2 + lead;
    expect(t.pieces[1]?.at).toBeCloseTo(first);
    expect(t.pieces[1]?.from).toBe(0);
    expect(t.dialogueSec).toBeCloseTo(first + second + 2 + 2 * lead);
    expect(t.lineSpans[0]?.start).toBeCloseTo(lead);
    expect(t.lineSpans[0]?.end).toBeCloseTo(first + 1.2);
    expect(t.lineSpans[1]?.start).toBeCloseTo(first + second + lead);
  });

  it("splits a line's shots where its segments meet, so lips stay with their own words", () => {
    const t = speechTimeline(heard, 2);
    const planned = [
      { line: 0, text: "Chào ông," },
      { line: 0, text: "hôm nay" },
      { line: 0, text: "trời đẹp quá ạ." },
      { line: 1, text: "Ừ, ngồi xuống đi." },
    ];
    const times = shotTimes(planned, t.lineSpans, t.dialogueSec, t.timing);
    const aEnd = 2.5 - (0.5 - SPEECH_LEAD_SEC);
    const bStart = (t.pieces[1]?.at ?? 0) + 0.1;
    expect(times[1]?.end).toBeCloseTo((aEnd + bStart) / 2, 2);
  });

  it("a hold is added once, after the dialogue, not inside it", () => {
    const t = speechTimeline(heard, 2);
    const planned = [
      { line: 0, text: "Chào ông, hôm nay" },
      { line: 0, text: "trời đẹp quá ạ.", hold: 1 },
      { line: 1, text: "Ừ, ngồi xuống đi.", hold: 1 },
    ];
    const spoken = shotTimes(planned, t.lineSpans, t.dialogueSec, t.timing);
    const { times } = withHolds(spoken, planned);
    expect(times.at(-1)?.end).toBeCloseTo(t.dialogueSec + 2);
  });
});
