import { describe, expect, it } from "vitest";
import { FRAME_USD } from "./board";
import type { ScriptLine } from "./ipc";
import type { PlannedShot, ShotPlan } from "./shot-plan";
import {
  applyFix,
  canFix,
  canRestore,
  FixError,
  fixPriceUsd,
  fixScope,
  restorePrevious,
} from "./video-fix";
import {
  applyPlan,
  frameFor,
  jobPhase,
  newJob,
  nextActions,
  resumeJob,
  revFile,
  settle,
  spentUsd,
  type VideoJob,
  withShotAudio,
} from "./video-job";
import { modelOutput, videoModel } from "./video-models";

/** The default model's rate: every job here is made by it. */
const VIDEO_USD_PER_SEC = modelOutput(videoModel()).usdPerSec;

const NOW = "2026-11-13T10:00:00.000Z";
const LATER = "2026-11-13T11:00:00.000Z";

const line = (characterId: string, text: string): ScriptLine => ({
  characterId,
  speaker: characterId,
  text,
});
const LINES = [
  line("a", "Con chào ông ạ, con mới tới."),
  line("b", "Ừ, ngồi xuống uống chén trà đã."),
  line("a", "Ơ… ông ơi, trà tràn ra bàn rồi kìa! Ông rót gì mà rót mãi vậy?"),
  line("b", "Chén đầy rồi thì rót thêm làm sao được."),
];
const shot = (
  kind: PlannedShot["kind"],
  lineNo: number,
  text: string,
  extra: Partial<PlannedShot> = {},
): PlannedShot => ({
  kind,
  characterId: kind === "speaker" ? (LINES[lineNo]?.characterId ?? null) : null,
  framing: kind === "speaker" ? "medium_close" : null,
  line: lineNo,
  text,
  visual: "",
  productId: null,
  why: "",
  ...extra,
});
const PLAN: ShotPlan = {
  source: "ai",
  seats: [],
  props: [],
  stateChanges: [{ fromShot: 3, change: "tea on the table" }],
  shots: [
    shot("speaker", 0, LINES[0]?.text ?? ""),
    shot("wide", 1, LINES[1]?.text ?? ""),
    shot("speaker", 2, LINES[2]?.text ?? ""),
    shot("detail", 3, LINES[3]?.text ?? "", { productId: "p" }),
  ],
};

/** A finished video: every shot 3 seconds, every part paid for. */
function done(plan: ShotPlan = PLAN): VideoJob {
  const planned = applyPlan(
    newJob({
      sessionId: "s",
      seriesId: "x",
      scriptId: "1",
      title: "T",
      lines: LINES,
      useEnvironment: true,
      now: NOW,
    }),
    plan,
  );
  const voiced = withShotAudio(
    {
      ...planned,
      status: "running",
      dialogue: "dialogue.mp3",
      dialogueSec: 12,
      voiceCostUsd: 0.05,
    },
    planned.shots.map((_, i) => ({
      start: i * 3,
      end: i * 3 + 3,
      audio: `a${i}.mp3`,
      audioSec: 3,
    })),
  );
  return {
    ...voiced,
    status: "done",
    final: "final.mp4",
    finalSec: 12,
    frames: voiced.frames.map((f) => ({
      ...f,
      file: `${f.id}.png`,
      ...(f.kind === "product" ? { source: "photo" as const } : { costUsd: FRAME_USD }),
    })),
    shots: voiced.shots.map((s) => ({
      ...s,
      state: "done",
      clip: `shot-${s.index}.mp4`,
      clipSec: 3,
      ...(s.kind === "speaker" ? { costUsd: 3 * VIDEO_USD_PER_SEC } : {}),
    })),
  };
}

describe("redoing one shot", () => {
  it("a speaking shot: only it is made again, the old cut stays, the total never drops", () => {
    const job = done();
    const spent = spentUsd(job);
    const fixed = applyFix(job, [{ op: "redo_shot", shot: 2 }], LATER);
    expect(fixed.status).toBe("waiting");
    expect(fixed.shots.map((s) => s.state)).toEqual(["done", "done", "queued", "done"]);
    expect(fixed.shots[2]?.clip).toBeUndefined();
    expect(fixed.final).toBeUndefined();
    expect(fixed.previous?.final).toBe("final.mp4");
    expect(fixed.previous?.shots[2]?.clip).toBe("shot-2.mp4");
    expect(spentUsd(fixed)).toBeCloseTo(spent);
    expect(fixPriceUsd(job, [{ op: "redo_shot", shot: 2 }], LATER)).toBeCloseTo(
      3 * VIDEO_USD_PER_SEC,
    );
    expect(jobPhase(fixed)).toBe("shots");
    expect(nextActions({ ...fixed, status: "running" }, new Set())).toEqual([
      { kind: "submit-shot", index: 2 },
    ]);
    // New files never overwrite the previous cut's.
    expect(revFile(fixed, "shot-03", "mp4")).toBe("shot-03-r1.mp4");
    expect(revFile(job, "shot-03", "mp4")).toBe("shot-03.mp4");
  });

  it("with a new direction, the shot's description changes too", () => {
    const fixed = applyFix(done(), [{ op: "redo_shot", shot: 0, visual: " smiles " }], LATER);
    expect(fixed.shots[0]).toMatchObject({ visual: "smiles", state: "queued" });
  });

  it("a wide shot remakes the scene still, not the characters'", () => {
    const job = done();
    const fixed = applyFix(job, [{ op: "redo_shot", shot: 1 }], LATER);
    expect(fixed.frames.filter((f) => !f.file).map((f) => f.id)).toEqual(["wide"]);
    expect(fixed.shots.map((s) => s.state)).toEqual(["done", "queued", "done", "done"]);
    expect(fixPriceUsd(job, [{ op: "redo_shot", shot: 1 }], LATER)).toBeCloseTo(FRAME_USD);
    expect(fixScope(job, [{ op: "redo_shot", shot: 1 }], LATER)).toEqual({
      shots: 1,
      stills: 1,
      voice: false,
    });
  });

  it("a remake always uses the video's model, and records it again when sent", () => {
    const job = { ...done(), model: "omnihuman-v2" };
    // Made earlier with the default (saved before models were recorded).
    const fixed = applyFix(job, [{ op: "redo_shot", shot: 2 }], LATER);
    expect(fixed.shots[2]?.model).toBeUndefined();
    // OmniHuman bills at least 4 seconds; the shot's audio is 3.
    expect(fixPriceUsd(job, [{ op: "redo_shot", shot: 2 }], LATER)).toBeCloseTo(4 * 0.105);
  });

  it("a fix keeps the video's model and resolution", () => {
    const job = { ...done(), model: "kling-avatar-v2-pro", resolution: "1080p" };
    const fixed = applyFix(job, [{ op: "redo_shot", shot: 0 }], LATER);
    expect(fixed).toMatchObject({ model: "kling-avatar-v2-pro", resolution: "1080p" });
  });

  it("a product photo cannot be made again", () => {
    expect(() => applyFix(done(), [{ op: "redo_shot", shot: 3 }], LATER)).toThrow(FixError);
    expect(() => applyFix(done(), [{ op: "redo_shot", shot: 9 }], LATER)).toThrow(
      "Không có cảnh 10",
    );
  });
});

describe("redoing a still", () => {
  it("a character's still takes all of that character's shots with it", () => {
    const job = done();
    const change = { op: "redo_still" as const, frame: "character:a", note: "look right" };
    const fixed = applyFix(job, [change], LATER);
    const frame = fixed.frames.find((f) => f.id === "character:a");
    expect(frame).toMatchObject({ note: "look right", retried: false });
    expect(frame?.file).toBeUndefined();
    expect(fixed.shots.map((s) => s.state)).toEqual(["queued", "done", "queued", "done"]);
    expect(fixPriceUsd(job, [change], LATER)).toBeCloseTo(FRAME_USD + 6 * VIDEO_USD_PER_SEC);
    expect(jobPhase(fixed)).toBe("frames");
  });

  it("refuses stills that are not generated", () => {
    expect(() => applyFix(done(), [{ op: "redo_still", frame: "product:3" }], LATER)).toThrow(
      FixError,
    );
  });
});

describe("showing something else during a line", () => {
  const parts = [
    shot("detail", 2, "Ơ… ông ơi, trà tràn ra bàn rồi kìa!", { visual: "tea spills" }),
    shot("speaker", 2, "Ông rót gì mà rót mãi vậy?", { framing: "close" }),
  ];

  it("replaces that line's shots, keeps the others and their stills", () => {
    const job = done();
    const fixed = applyFix(job, [{ op: "replace_line", line: 2, shots: parts }], LATER);
    expect(fixed.shots.map((s) => [s.index, s.kind, s.state])).toEqual([
      [0, "speaker", "done"],
      [1, "wide", "done"],
      [2, "detail", "planned"],
      [3, "speaker", "planned"],
      [4, "detail", "done"],
    ]);
    // The product still follows its shot to the new position.
    expect(frameFor(fixed, fixed.shots[4] as never)).toMatchObject({
      id: "product:4",
      shot: 4,
      file: "product:3.png",
    });
    expect(fixed.frames.find((f) => f.id === "detail:2")?.file).toBeUndefined();
    expect(fixed.plan?.shots).toHaveLength(5);
    expect(fixed.plan?.stateChanges).toEqual([{ fromShot: 4, change: "tea on the table" }]);
    // New shots need their place in the dialogue first: the voice step cuts again for free.
    expect(jobPhase(fixed)).toBe("voice");
    expect(fixed.dialogue).toBe("dialogue.mp3");
    // One still and one short speaking shot; the replaced shot's cost stays on record.
    expect(spentUsd(fixed)).toBeCloseTo(spentUsd(job));
  });

  it("an identical shot in the line is reused", () => {
    const same = [shot("speaker", 0, LINES[0]?.text ?? "")];
    const fixed = applyFix(done(), [{ op: "replace_line", line: 0, shots: same }], LATER);
    expect(fixed.shots[0]).toMatchObject({ state: "done", clip: "shot-0.mp4" });
  });

  it("a hold after a line: that shot is made again and every shot is placed again, free", () => {
    const job = done();
    const held = [shot("speaker", 2, LINES[2]?.text ?? "", { hold: 1.5 })];
    const fixed = applyFix(job, [{ op: "replace_line", line: 2, shots: held }], LATER);
    expect(fixed.shots[2]).toMatchObject({ hold: 1.5, state: "planned", clip: undefined });
    expect(fixed.shots[3]).toMatchObject({ state: "done", clip: "shot-3.mp4" });
    expect(fixed.shots.every((s) => s.end === undefined)).toBe(true);
    expect(jobPhase(fixed)).toBe("voice");
    expect(fixed.plan?.shots[2]?.hold).toBe(1.5);
    // Only the held speaking shot is paid for again, its silence included.
    expect(fixPriceUsd(job, [{ op: "replace_line", line: 2, shots: held }], LATER)).toBeGreaterThan(
      1.5 * VIDEO_USD_PER_SEC,
    );
    expect(() =>
      applyFix(
        job,
        [{ op: "replace_line", line: 2, shots: [{ ...(held[0] as PlannedShot), hold: 5 }] }],
        LATER,
      ),
    ).toThrow("1 to 2 seconds");
  });

  it("refuses plans that change or badly split the words", () => {
    const fix = (shots: PlannedShot[]) => () =>
      applyFix(done(), [{ op: "replace_line", line: 2, shots }], LATER);
    expect(fix([shot("speaker", 2, "Ơ… ông ơi!")])).toThrow("reproduce the line exactly");
    expect(
      fix([
        shot("speaker", 2, "Ơ… ông ơi, trà tràn ra bàn"),
        shot("speaker", 2, "rồi kìa! Ông rót gì mà rót mãi vậy?"),
      ]),
    ).toThrow("punctuation");
    expect(fix([shot("speaker", 2, LINES[2]?.text ?? "", { characterId: "b" })])).toThrow(
      "person saying the line",
    );
  });
});

describe("the most expensive fix", () => {
  it("a new voice remakes every shot but keeps the stills", () => {
    const job = done();
    const fixed = applyFix(job, [{ op: "redo_voice" }], LATER);
    expect(jobPhase(fixed)).toBe("voice");
    expect(fixed.dialogue).toBeUndefined();
    expect(fixed.shots.every((s) => s.state === "planned" && s.start === undefined)).toBe(true);
    expect(fixed.frames.every((f) => f.file)).toBe(true);
    expect(spentUsd(fixed)).toBeCloseTo(spentUsd(job));
  });
});

describe("the previous cut", () => {
  it("comes back for free, and the newer one after it", () => {
    const job = done();
    const fixing = applyFix(job, [{ op: "redo_shot", shot: 0 }], LATER);
    expect(canRestore(fixing)).toBe(false);
    const fixed: VideoJob = {
      ...fixing,
      status: "done",
      final: "final-r1.mp4",
      shots: fixing.shots.map((s) =>
        s.index === 0
          ? { ...s, state: "done", clip: "shot-01-r1.mp4", costUsd: 3 * VIDEO_USD_PER_SEC }
          : s,
      ),
    };
    const spent = spentUsd(fixed);
    expect(spent).toBeCloseTo(spentUsd(job) + 3 * VIDEO_USD_PER_SEC);
    const back = restorePrevious(fixed, LATER);
    expect([back.final, back.shots[0]?.clip, back.status]).toEqual([
      "final.mp4",
      "shot-0.mp4",
      "done",
    ]);
    expect(spentUsd(back)).toBeCloseTo(spent);
    const again = restorePrevious(back, LATER);
    expect([again.final, again.shots[0]?.clip]).toEqual(["final-r1.mp4", "shot-01-r1.mp4"]);
    expect(spentUsd(again)).toBeCloseTo(spent);
    // The next fix gets a fresh revision either way.
    expect(applyFix(back, [{ op: "redo_shot", shot: 0 }], LATER).rev).toBe(2);
  });

  it("a stopped fix can be abandoned for the cut before it", () => {
    const stopped: VideoJob = {
      ...applyFix(done(), [{ op: "redo_shot", shot: 0 }], LATER),
      status: "stopped",
    };
    expect(restorePrevious(stopped, LATER)).toMatchObject({ status: "done", final: "final.mp4" });
  });

  it("is not offered while a shot is still with the provider", () => {
    const fixing = applyFix(done(), [{ op: "redo_shot", shot: 0 }], LATER);
    const rendering: VideoJob = {
      ...fixing,
      status: "stopped",
      shots: fixing.shots.map((s) =>
        s.index === 0 ? { ...s, state: "rendering", requestId: "r" } : s,
      ),
    };
    expect(canRestore(rendering)).toBe(false);
    expect(() => restorePrevious(rendering, LATER)).toThrow(FixError);
  });
});

describe("the test video's pause", () => {
  const paused = (): VideoJob => {
    const job = done();
    return settle({
      ...job,
      status: "running",
      pause: true,
      final: undefined,
      shots: job.shots.map((s) => ({ ...s, state: "queued", clip: undefined, costUsd: undefined })),
    });
  };

  it("waits once voice and stills exist, before any shot is sent", () => {
    const job = paused();
    expect(job.status).toBe("review");
    expect(nextActions(job, new Set())).toEqual([]);
    const going = resumeJob(job, LATER);
    expect([going.status, going.reviewed]).toEqual(["waiting", true]);
    expect(settle({ ...going, status: "running" }).status).toBe("running");
  });

  it("a still fixed at the pause costs only the still, and pauses again", () => {
    const job = paused();
    expect(canFix(job)).toBe(true);
    const change = { op: "redo_still" as const, frame: "character:a", note: "look right" };
    expect(fixPriceUsd(job, [change], LATER)).toBeCloseTo(FRAME_USD);
    const fixed = applyFix(job, [change], LATER);
    expect(fixed.previous).toBeUndefined();
    const remade = settle({
      ...fixed,
      status: "running",
      frames: fixed.frames.map((f) => (f.file ? f : { ...f, file: "new.png" })),
    });
    expect(remade.status).toBe("review");
  });

  it("jobs that are running cannot be fixed", () => {
    expect(canFix({ ...done(), status: "running", final: undefined })).toBe(false);
  });
});
