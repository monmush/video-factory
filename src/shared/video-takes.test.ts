import { describe, expect, it } from "vitest";
import { FRAME_USD } from "./board";
import type { ScriptLine } from "./ipc";
import type { PlannedShot, ShotPlan } from "./shot-plan";
import { applyFix, restorePrevious } from "./video-fix";
import {
  applyPlan,
  costToFinishUsd,
  newJob,
  nextActions,
  settle,
  spentUsd,
  type VideoJob,
  withShotAudio,
} from "./video-job";
import { modelOutput, videoModel } from "./video-models";
import {
  canSwitch,
  chooseTake,
  chosenModel,
  chosenView,
  deleteTake,
  focusTake,
  startTake,
  takeCostUsd,
  takeModels,
  takePriceUsd,
  viewTake,
} from "./video-takes";

const NOW = "2026-11-13T10:00:00.000Z";
const LATER = "2026-11-13T11:00:00.000Z";
const KLING = videoModel().id;
const RATE = modelOutput(videoModel()).usdPerSec;

const LINES: ScriptLine[] = [
  { characterId: "a", speaker: "a", text: "Con chào ông ạ, con mới tới." },
  { characterId: "b", speaker: "b", text: "Ừ, ngồi xuống uống chén trà đã." },
  { characterId: "a", speaker: "a", text: "Trà này thơm quá ông ơi." },
];
const shot = (kind: PlannedShot["kind"], line: number, extra: Partial<PlannedShot> = {}) => ({
  kind,
  characterId: kind === "speaker" ? (LINES[line]?.characterId ?? null) : null,
  framing: kind === "speaker" ? ("medium_close" as const) : null,
  line,
  text: LINES[line]?.text ?? "",
  visual: "",
  productId: null,
  why: "",
  ...extra,
});
const PLAN: ShotPlan = {
  source: "ai",
  seats: [],
  props: [],
  stateChanges: [],
  shots: [shot("speaker", 0), shot("wide", 1), shot("speaker", 2)],
};

function done(): VideoJob {
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
    PLAN,
  );
  const voiced = withShotAudio(
    { ...planned, status: "running", dialogue: "dialogue.mp3", dialogueSec: 9, voiceCostUsd: 0.05 },
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
    finalSec: 9,
    frames: voiced.frames.map((f) => ({ ...f, file: `${f.id}.png`, costUsd: FRAME_USD })),
    shots: voiced.shots.map((s) => ({
      ...s,
      state: "done",
      clip: `shot-${s.index}.mp4`,
      clipSec: 3,
      ...(s.kind === "speaker" ? { costUsd: 3 * RATE, model: KLING } : {}),
    })),
  };
}

function finish(job: VideoJob, final: string): VideoJob {
  const model = videoModel(job.model).id;
  return settle({
    ...job,
    status: "running",
    shots: job.shots.map((s) =>
      s.state === "done"
        ? s
        : {
            ...s,
            state: "done",
            model,
            clip: `${s.index}-${final}`,
            clipSec: 3,
            costUsd: s.kind === "speaker" ? 4 * 0.105 : undefined,
          },
    ),
    final,
    finalSec: 9,
  });
}

describe("takes with another model", () => {
  it("a take reuses voice, stills, plan and free shots, and pays only for speaking shots", () => {
    const job = done();
    const spent = spentUsd(job);
    const take = startTake(job, "omnihuman-v2", LATER);
    expect(take).toMatchObject({ model: "omnihuman-v2", status: "waiting", rev: 1 });
    expect(take.dialogue).toBe("dialogue.mp3");
    expect(take.frames.every((f) => f.file)).toBe(true);
    expect(take.shots.map((s) => s.state)).toEqual(["queued", "done", "queued"]);
    expect(take.final).toBeUndefined();
    expect(costToFinishUsd(take)).toBeCloseTo(2 * 4 * 0.105);
    expect(takePriceUsd(job, "omnihuman-v2", LATER)).toBeCloseTo(2 * 4 * 0.105);
    expect(spentUsd(take)).toBeCloseTo(spent);
    expect(takeModels(take)).toEqual([KLING, "omnihuman-v2"]);
    expect(chosenModel(take)).toBe(KLING);
    expect(chosenView(take).final).toBe("final.mp4");
    expect(nextActions({ ...take, status: "running" }, new Set())).toEqual([
      { kind: "submit-shot", index: 0 },
      { kind: "submit-shot", index: 2 },
    ]);
  });

  it("one take per model, only from a finished video, never while something renders", () => {
    const job = done();
    expect(() => startTake(job, KLING, LATER)).toThrow("Video đã có bản này");
    const take = startTake(job, "omnihuman-v2", LATER);
    expect(() => startTake(take, "kling-avatar-v2-pro", LATER)).toThrow();
    expect(canSwitch(take)).toBe(false);
    expect(() => focusTake(take, KLING, LATER)).toThrow();
  });

  it("the take uses the video's resolution fitted to its model", () => {
    const job = { ...done(), resolution: "1080p" };
    expect(startTake(job, "omnihuman-v2", LATER).resolution).toBe("720p");
    expect(startTake(job, "kling-avatar-v2-pro", LATER).resolution).toBe("1080p");
    expect(startTake(job, "omnihuman-v2", LATER).shots[1]?.state).toBe("queued");
  });

  it("choosing, switching and the total spent across takes", () => {
    const job = done();
    const take = finish(startTake(job, "omnihuman-v2", LATER), "final-r1.mp4");
    expect(take.status).toBe("done");
    const total = spentUsd(job) + 2 * 4 * 0.105;
    expect(spentUsd(take)).toBeCloseTo(total);
    const chosen = chooseTake(take, "omnihuman-v2", LATER);
    expect(chosenView(chosen).final).toBe("final-r1.mp4");
    const back = focusTake(chosen, KLING, LATER);
    expect(back.model).toBe(KLING);
    expect(back.final).toBe("final.mp4");
    expect(spentUsd(back)).toBeCloseTo(total);
    expect(chosenView(back).final).toBe("final-r1.mp4");
    expect(viewTake(back, "omnihuman-v2").shots[0]?.model).toBe("omnihuman-v2");
  });

  it("a fix acts on the take worked on, with its model and revision history", () => {
    const take = finish(startTake(done(), "omnihuman-v2", LATER), "final-r1.mp4");
    const fixed = applyFix(take, [{ op: "redo_shot", shot: 0 }], LATER);
    expect(fixed.rev).toBe(2);
    expect(fixed.previous?.final).toBe("final-r1.mp4");
    expect(costToFinishUsd(fixed)).toBeCloseTo(4 * 0.105);
    const restored = restorePrevious(finish(fixed, "final-r2.mp4"), LATER);
    expect(restored.final).toBe("final-r1.mp4");
    expect(restored.model).toBe("omnihuman-v2");
  });

  it("deleting a take that is not the video removes only its own files and keeps its cost", () => {
    const take = finish(startTake(done(), "omnihuman-v2", LATER), "final-r1.mp4");
    expect(() => deleteTake(take, KLING, LATER)).toThrow("Đây là bản đang dùng");
    const total = spentUsd(take);
    const { job, files } = deleteTake(take, "omnihuman-v2", LATER);
    expect(job.model).toBe(KLING);
    expect(job.takes).toBeUndefined();
    expect(takeModels(job)).toEqual([KLING]);
    expect(spentUsd(job)).toBeCloseTo(total);
    expect(files.sort()).toEqual(["0-final-r1.mp4", "2-final-r1.mp4", "final-r1.mp4"]);
    const chosen = chooseTake(take, "omnihuman-v2", LATER);
    const dropped = deleteTake(chosen, KLING, LATER);
    expect(dropped.job.model).toBe("omnihuman-v2");
    expect(dropped.files).toContain("final.mp4");
    expect(dropped.files).not.toContain("dialogue.mp3");
    expect(spentUsd(dropped.job)).toBeCloseTo(total);
  });

  it("each take's cost is the shared voice and stills plus its own shots, kept through switching", () => {
    const job = done();
    const shared = 0.05 + job.frames.length * FRAME_USD;
    const originalShots = 2 * 3 * RATE;
    expect(takeCostUsd(job, KLING)).toBeCloseTo(shared + originalShots);
    const take = finish(startTake(job, "omnihuman-v2", LATER), "final-r1.mp4");
    expect(takeCostUsd(take, "omnihuman-v2")).toBeCloseTo(shared + 2 * 4 * 0.105);
    expect(takeCostUsd(take, KLING)).toBeCloseTo(shared + originalShots);
    const back = focusTake(take, KLING, LATER);
    const fixed = finish(applyFix(back, [{ op: "redo_shot", shot: 0 }], LATER), "final-r2.mp4");
    expect(takeCostUsd(fixed, KLING)).toBeCloseTo(shared + originalShots + 4 * 0.105);
    expect(takeCostUsd(fixed, "omnihuman-v2")).toBeCloseTo(shared + 2 * 4 * 0.105);
    expect(spentUsd(fixed)).toBeCloseTo(shared + originalShots + 3 * 4 * 0.105);
    const parked = focusTake(fixed, "omnihuman-v2", LATER);
    expect(takeCostUsd(parked, KLING)).toBeCloseTo(shared + originalShots + 4 * 0.105);
  });

  it("takes saved before costs were kept per take are reconstructed from their cuts", () => {
    const base = done();
    const fabricCut = {
      ...base,
      voiceCostUsd: 0.43,
      frames: base.frames.map((f) => ({ ...f, costUsd: 0.6 / base.frames.length })),
      shots: base.shots.map((s) => ({
        ...s,
        costUsd: s.kind === "speaker" ? 4.31 / 2 : undefined,
      })),
    };
    const pro: VideoJob = {
      ...base,
      model: "kling-avatar-v2-pro",
      voiceCostUsd: 0,
      frames: base.frames.map((f) => ({ ...f, costUsd: undefined })),
      shots: base.shots.map((s) => ({ ...s, costUsd: s.kind === "speaker" ? 3.4 / 2 : undefined })),
      pastCostUsd: 1.03 + 4.31,
      takes: [{ model: "fabric-1-720p", status: "done", cut: fabricCut }],
    };
    expect(spentUsd(pro)).toBeCloseTo(8.74);
    expect(takeCostUsd(pro, "fabric-1-720p")).toBeCloseTo(5.34);
    expect(takeCostUsd(pro, "kling-avatar-v2-pro")).toBeCloseTo(4.43);
    expect(takeCostUsd({ ...pro, pastCostUsd: 6 }, "fabric-1-720p")).toBeNull();
  });
});
