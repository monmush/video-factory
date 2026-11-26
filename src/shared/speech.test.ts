import { describe, expect, it } from "vitest";
import { shotTimes, withHolds } from "./shot-plan";
import {
  cutOffAskedAgainLonger,
  endingBeforeTrailingQuiet,
  type GroupedShot,
  type HeardSegment,
  newSegment,
  SPEECH_LEAD_SEC,
  type SpeechBounds,
  type SpeechSegment,
  segmentCutOff,
  segmentKept,
  segmentTriedAfresh,
  silenceThresholdDb,
  speechBounds,
  speechCutOff,
  speechSegments,
  speechTimeline,
  trailingQuietSec,
  wantedSec,
} from "./speech";
import { SPEECH_MARGIN_SEC, videoModel } from "./video-models";

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
      undefined,
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
      undefined,
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
      undefined,
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

  it("a segment saved before paces existed asks for the clip length it always did", () => {
    const words = "một hai ba bốn năm sáu bảy tám chín mười";
    expect(wantedSec({ text: words, hold: 0 })).toBeCloseTo(10 / 2.7 + SPEECH_MARGIN_SEC);
  });

  it("the same words at a faster pace ask for a shorter clip", () => {
    const words = { text: "một hai ba bốn năm sáu bảy tám chín mười", hold: 0 };
    expect(wantedSec({ ...words, pace: 5 })).toBeLessThan(wantedSec({ ...words, pace: 4 }));
    expect(wantedSec({ ...words, pace: 4 })).toBeLessThan(wantedSec(words));
  });

  const SEGMENT: SpeechSegment = {
    id: "line-1-1",
    line: 0,
    shots: [0],
    speakerShot: 0,
    characterId: "a",
    text: "Chào ông, hôm nay trời đẹp quá ạ.",
    frame: "f",
    hold: 0,
  };

  it("speech cut off at the end asks again longer once, as one failed attempt", () => {
    const sent = {
      ...newSegment(SEGMENT),
      state: "rendering" as const,
      model: "minimax-h3-max",
      seconds: 4,
      requestId: "r",
      costUsd: 0.6,
    };
    const again = segmentCutOff(sent, videoModel("wan-3"));
    expect(again).toMatchObject({ state: "queued", retried: true, atLeastSec: 6, cutOffs: 1 });
    expect(again.requestId).toBeUndefined();
    expect(cutOffAskedAgainLonger(sent, true)).toBe(true);
    expect(cutOffAskedAgainLonger(again, true)).toBe(false);
    expect(cutOffAskedAgainLonger(sent, false)).toBe(false);
  });

  it("a second cut-off keeps the clip with a note instead of failing the scene", () => {
    const heard = { clip: "c.mp4", clipSec: 6, speech: { start: 0.4, end: 6 }, cutOff: true };
    const kept = segmentKept({ ...newSegment(SEGMENT), state: "rendering", model: "wan-3" }, heard);
    expect(kept).toMatchObject({ state: "done", clip: "c.mp4", speech: heard.speech });
    expect(kept.mishaps?.map((m) => [m.kind, m.model])).toEqual([["cut-kept", "wan-3"]]);
    expect(segmentKept(newSegment(SEGMENT), { ...heard, cutOff: false }).mishaps).toBeUndefined();
  });

  it("trying a failed segment again by hand starts from the normal length", () => {
    const failed = {
      ...newSegment(SEGMENT),
      state: "failed" as const,
      retried: true,
      atLeastSec: 9,
    };
    const again = segmentTriedAfresh(failed);
    expect(again).toMatchObject({ state: "queued", retried: false });
    expect(wantedSec(again)).toBe(wantedSec(newSegment(SEGMENT)));
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

  const FRAMES_A_SECOND = 40;
  const clipEndingQuietFor = (clipSec: number, quietSec: number) => {
    const frames = Array.from({ length: clipSec * FRAMES_A_SECOND }, () => -14);
    return frames.fill(-48, frames.length - Math.round(quietSec * FRAMES_A_SECOND));
  };
  const heardIn = (clipSec: number, quietSec: number) => {
    const untilTheEnd = { start: 0.3, end: clipSec };
    const quiet = trailingQuietSec(clipEndingQuietFor(clipSec, quietSec), -35, clipSec);
    return endingBeforeTrailingQuiet(untilTheEnd, quiet, clipSec) as SpeechBounds;
  };

  it("a line that ends a fifth of a second before the clip does is complete, not cut off", () => {
    const speech = heardIn(5, 0.2);
    expect(speech.end).toBeCloseTo(4.8);
    expect(speechCutOff(speech, 5)).toBe(false);
  });

  it("a voice still sounding in the clip's last instant is cut off", () => {
    expect(speechCutOff(heardIn(5, 0.025), 5)).toBe(true);
    expect(speechCutOff(heardIn(5, 0), 5)).toBe(true);
  });

  it("an ending the silence detector found is kept as it is, so a soft laugh after the line is not trimmed", () => {
    const quiet = trailingQuietSec(clipEndingQuietFor(5, 2.4), -35, 5);
    expect(endingBeforeTrailingQuiet({ start: 0.3, end: 3 }, quiet, 5)).toEqual({
      start: 0.3,
      end: 3,
    });
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

describe("the level below which a clip counts as quiet", () => {
  const clipWithBackgroundAt = (backgroundDb: number) => [
    ...Array.from({ length: 15 }, () => backgroundDb - 4),
    ...Array.from({ length: 25 }, () => backgroundDb),
    ...Array.from({ length: 60 }, (_, i) => -18 - (i % 6)),
  ];

  it("stays at -35 dB for a clean clip, so a soft ending is not trimmed", () => {
    for (const background of [-56.3, -53.9, -55]) {
      expect(silenceThresholdDb(clipWithBackgroundAt(background))).toBe(-35);
    }
  });

  it("listens above the sound of a stream under the speech", () => {
    expect(silenceThresholdDb(clipWithBackgroundAt(-42.9))).toBeCloseTo(-26.9, 1);
    expect(silenceThresholdDb(clipWithBackgroundAt(-37.8))).toBeCloseTo(-21.8, 1);
  });

  it("never rises above -20 dB, however loud the background", () => {
    expect(silenceThresholdDb(clipWithBackgroundAt(-25))).toBe(-20);
  });

  it("falls back to -35 dB when nothing was measured or every frame is silent", () => {
    expect(silenceThresholdDb([])).toBe(-35);
    expect(silenceThresholdDb([Number.NEGATIVE_INFINITY, Number.NaN])).toBe(-35);
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
