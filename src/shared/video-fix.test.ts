import { describe, expect, it } from "vitest";
import { redoneCharges, spentUsd } from "./cost/charges";
import { withInUsePaid } from "./cost/charges.fixture";
import { STILL_USD as FRAME_USD } from "./cost/rates";
import { finished, plannedJob, withStills } from "./job.fixture";
import { answer, LINES } from "./shot-list.fixture";
import type { PlannedShot } from "./shot-plan";
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
  frameFor,
  jobPhase,
  nextActions,
  resumeJob,
  revFile,
  settle,
  type VideoJob,
} from "./video-job";
import { motionUsd, videoModel } from "./video-models";

const LATER = "2026-11-25T11:00:00.000Z";
const MOVING = 1;
const WAN_ONE_SECOND = motionUsd(videoModel("wan-3"), 1);

const done = (): VideoJob =>
  withInUsePaid({
    ...finished(),
    shots: finished().shots.map((s) =>
      s.index === MOVING ? { ...s, clipSec: 1, costUsd: WAN_ONE_SECOND, requestId: "r1" } : s,
    ),
  });

const stillDone = (): VideoJob => withInUsePaid(finished(plannedJob(undefined, answer())));

const shot = (
  kind: PlannedShot["kind"],
  line: number,
  text: string,
  extra: Partial<PlannedShot> = {},
): PlannedShot => ({
  kind,
  characterId: kind === "speaker" ? (LINES[line]?.characterId ?? null) : null,
  framing: kind === "speaker" ? "medium_close" : null,
  line,
  text,
  visual: "",
  productId: null,
  why: "",
  ...extra,
});

describe("redoing one shot", () => {
  it("a moving shot: only it is made again, the old cut stays, the total never drops", () => {
    const job = done();
    const spent = spentUsd(job);
    const fixed = applyFix(job, [{ op: "redo_shot", shot: MOVING }], LATER);
    expect(fixed.status).toBe("waiting");
    expect(fixed.shots.map((s) => s.state)).toEqual(["done", "queued", "done", "done", "done"]);
    expect(fixed.shots[MOVING]?.clip).toBeUndefined();
    expect(fixed.final).toBeUndefined();
    expect(fixed.previous?.final).toBe("final.mp4");
    expect(fixed.previous?.shots[MOVING]?.clip).toBe("shot-1.mp4");
    expect(spentUsd(fixed)).toBeCloseTo(spent);
    expect(fixPriceUsd(job, [{ op: "redo_shot", shot: MOVING }], LATER)).toBeCloseTo(
      WAN_ONE_SECOND,
    );
    expect(jobPhase(fixed)).toBe("shots");
    expect(nextActions({ ...fixed, status: "running" }, new Set())).toEqual([
      { kind: "submit-shot", index: MOVING },
    ]);
    expect(revFile(fixed, "shot-02", "mp4")).toBe("shot-02-r1.mp4");
    expect(revFile(job, "shot-02", "mp4")).toBe("shot-02.mp4");
  });

  it("with a new direction, the shot's description changes too", () => {
    const fixed = applyFix(done(), [{ op: "redo_shot", shot: MOVING, visual: " pours " }], LATER);
    expect(fixed.shots[MOVING]).toMatchObject({ visual: "pours", state: "queued" });
  });

  it("a shot made from its still remakes that still, not the people's", () => {
    const job = stillDone();
    const fixed = applyFix(job, [{ op: "redo_shot", shot: 1 }], LATER);
    expect(fixed.frames.filter((f) => !f.file).map((f) => f.id)).toEqual(["kf:master"]);
    expect(fixed.shots.map((s) => s.state)).toEqual(["done", "queued", "done", "done", "done"]);
    expect(fixPriceUsd(job, [{ op: "redo_shot", shot: 1 }], LATER)).toBeCloseTo(FRAME_USD);
    expect(fixScope(job, [{ op: "redo_shot", shot: 1 }], LATER)).toEqual({ shots: 1, stills: 1 });
  });

  it("a product photo cannot be made again", () => {
    const job = done();
    const photo = {
      ...job,
      frames: job.frames.map((f) =>
        f.kind === "product" ? { ...f, source: "photo" as const } : f,
      ),
    };
    expect(() => applyFix(photo, [{ op: "redo_shot", shot: 3 }], LATER)).toThrow(FixError);
    expect(() => applyFix(job, [{ op: "redo_shot", shot: 9 }], LATER)).toThrow("Không có cảnh 10");
  });
});

describe("redoing a still", () => {
  it("the scene's still takes the shots made from it with it", () => {
    const job = stillDone();
    const change = { op: "redo_still" as const, frame: "kf:master", note: "warmer light" };
    const fixed = applyFix(job, [change], LATER);
    const frame = fixed.frames.find((f) => f.id === "kf:master");
    expect(frame).toMatchObject({ note: "warmer light", retried: false });
    expect(frame?.file).toBeUndefined();
    expect(fixed.shots.map((s) => s.state)).toEqual(["done", "queued", "done", "done", "done"]);
    expect(fixPriceUsd(job, [change], LATER)).toBeCloseTo(FRAME_USD);
    expect(jobPhase(fixed)).toBe("frames");
  });

  it("refuses stills that are not generated", () => {
    const job = done();
    const photo = {
      ...job,
      frames: job.frames.map((f) =>
        f.kind === "product" ? { ...f, source: "photo" as const } : f,
      ),
    };
    expect(() => applyFix(photo, [{ op: "redo_still", frame: "kf:plate" }], LATER)).toThrow(
      FixError,
    );
  });
});

describe("a fix of something taken from the series' material", () => {
  const fromStore = (): VideoJob => {
    const job = done();
    return {
      ...job,
      frames: job.frames.map((f) =>
        f.id === "kf:master" ? { ...f, source: "material", material: "m1", costUsd: undefined } : f,
      ),
      shots: job.shots.map((s) =>
        s.index === MOVING ? { ...s, reused: "c1", costUsd: undefined } : s,
      ),
    };
  };

  it("a still made again is generated, never taken from the store again", () => {
    const fixed = applyFix(fromStore(), [{ op: "redo_still", frame: "kf:master" }], LATER);
    expect(fixed.frames.find((f) => f.id === "kf:master")).toMatchObject({
      fresh: true,
      material: "m1",
    });
    expect(fixed.shots[MOVING]?.reused).toBeUndefined();
  });

  it("a clip made again is made by the video model, never replayed from the store again", () => {
    const fixed = applyFix(fromStore(), [{ op: "redo_shot", shot: MOVING }], LATER);
    expect(fixed.shots[MOVING]).toMatchObject({ state: "queued", reused: undefined });
    expect(fixed.frames.find((f) => f.id === "kf:master")).toMatchObject({
      fresh: true,
      file: "kf:master.png",
    });
  });
});

describe("showing something else during a line, before anything speaks", () => {
  const paused = (): VideoJob =>
    settle({ ...withStills(plannedJob()), status: "running", pause: true });
  const parts = [
    shot("detail", 1, "Ừ cháu ngồi đây,", { visual: "Ba pats the cushion" }),
    shot("speaker", 1, "uống chén trà đã cháu."),
  ];

  it("replaces that line's shots and keeps the others and their stills", () => {
    const job = paused();
    expect(job.status).toBe("review");
    const fixed = applyFix(job, [{ op: "replace_line", line: 1, shots: parts }], LATER);
    expect(fixed.shots.map((s) => [s.index, s.kind])).toEqual([
      [0, "speaker"],
      [1, "detail"],
      [2, "speaker"],
      [3, "detail"],
      [4, "speaker"],
    ]);
    expect(frameFor(fixed, fixed.shots[0] as never)?.file).toBe("kf:an.png");
    expect(fixed.segments?.map((s) => s.shots)).toEqual([[0], [1, 2], [3, 4]]);
    expect(fixed.plan?.shots).toHaveLength(5);
  });

  it("a hold after a line places every shot again, and is limited", () => {
    const job = paused();
    const held = [shot("speaker", 0, LINES[0]?.text ?? "", { hold: 1.5 })];
    const fixed = applyFix(job, [{ op: "replace_line", line: 0, shots: held }], LATER);
    expect(fixed.shots[0]).toMatchObject({ hold: 1.5 });
    expect(fixed.shots.every((s) => s.end === undefined)).toBe(true);
    expect(fixed.plan?.shots[0]?.hold).toBe(1.5);
    expect(() =>
      applyFix(
        job,
        [{ op: "replace_line", line: 0, shots: [{ ...(held[0] as PlannedShot), hold: 5 }] }],
        LATER,
      ),
    ).toThrow("1 to 2 seconds");
  });

  it("refuses plans that change or badly split the words", () => {
    const fix = (shots: PlannedShot[]) => () =>
      applyFix(paused(), [{ op: "replace_line", line: 1, shots }], LATER);
    expect(fix([shot("speaker", 1, "Ừ cháu ngồi đây.")])).toThrow("reproduce the line exactly");
    expect(
      fix([shot("speaker", 1, "Ừ cháu ngồi đây, uống"), shot("speaker", 1, "chén trà đã cháu.")]),
    ).toThrow("punctuation");
    expect(fix([shot("speaker", 1, LINES[1]?.text ?? "", { characterId: "a" })])).toThrow(
      "person saying the line",
    );
  });
});

describe("the previous cut", () => {
  it("comes back for free, and the newer one after it", () => {
    const job = done();
    const fixing = applyFix(job, [{ op: "redo_shot", shot: MOVING }], LATER);
    expect(canRestore(fixing)).toBe(false);
    const fixed: VideoJob = withInUsePaid({
      ...fixing,
      status: "done",
      final: "final-r1.mp4",
      shots: fixing.shots.map((s) =>
        s.index === MOVING
          ? {
              ...s,
              state: "done",
              clip: "shot-02-r1.mp4",
              requestId: "r1-fix",
              costUsd: WAN_ONE_SECOND,
            }
          : s,
      ),
    });
    const spent = spentUsd(fixed);
    expect(spent).toBeCloseTo(spentUsd(job) + WAN_ONE_SECOND);
    expect(redoneCharges(fixed).map((c) => c.requestId)).toEqual(["r1"]);
    const back = restorePrevious(fixed, LATER);
    expect([back.final, back.shots[MOVING]?.clip, back.status]).toEqual([
      "final.mp4",
      "shot-1.mp4",
      "done",
    ]);
    expect(spentUsd(back)).toBeCloseTo(spent);
    expect(redoneCharges(back).map((c) => c.requestId)).toEqual(["r1-fix"]);
    const again = restorePrevious(back, LATER);
    expect([again.final, again.shots[MOVING]?.clip]).toEqual(["final-r1.mp4", "shot-02-r1.mp4"]);
    expect(spentUsd(again)).toBeCloseTo(spent);
    expect(applyFix(back, [{ op: "redo_shot", shot: MOVING }], LATER).rev).toBe(2);
  });

  it("a stopped fix can be abandoned for the cut before it", () => {
    const stopped: VideoJob = {
      ...applyFix(done(), [{ op: "redo_shot", shot: MOVING }], LATER),
      status: "stopped",
    };
    expect(restorePrevious(stopped, LATER)).toMatchObject({ status: "done", final: "final.mp4" });
  });

  it("is not offered while a shot is still with the provider, nor for a video made the old way", () => {
    const fixing = applyFix(done(), [{ op: "redo_shot", shot: MOVING }], LATER);
    const rendering: VideoJob = {
      ...fixing,
      status: "stopped",
      shots: fixing.shots.map((s) =>
        s.index === MOVING ? { ...s, state: "rendering", requestId: "r" } : s,
      ),
    };
    expect(canRestore(rendering)).toBe(false);
    expect(() => restorePrevious(rendering, LATER)).toThrow(FixError);
    expect(canRestore({ ...fixing, status: "stopped", dubbed: true })).toBe(false);
  });
});

describe("the test video's pause", () => {
  const paused = (): VideoJob =>
    settle({ ...withStills(plannedJob()), status: "running", pause: true });

  it("waits once the stills exist, before anything speaks", () => {
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
    const change = { op: "redo_still" as const, frame: "kf:an", note: "look right" };
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
