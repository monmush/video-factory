import { describe, expect, it } from "vitest";
import { rejectClip } from "./clip-check";
import { NOW, placed, plannedJob, running, spoken, withStills } from "./job.fixture";
import { sceneNotes } from "./scene-notes";
import { segmentCutOff, segmentKept } from "./speech";
import {
  frameFor,
  JOB_VERSION,
  type JobShot,
  migrateJob,
  settle,
  stepReportedFailure,
  stillToDrawAgain,
  type VideoJob,
  videoModelOf,
} from "./video-job";

const MOVING = 1;

const made = (): VideoJob => running(placed(spoken(withStills(plannedJob()))));

const shotAt = (job: VideoJob, index: number) => job.shots[index] as JobShot;

const spokenShot = (job: VideoJob) => shotAt(job, job.segments?.[0]?.shots[0] as number);

const withSegment = (
  job: VideoJob,
  change: (
    s: NonNullable<VideoJob["segments"]>[number],
  ) => NonNullable<VideoJob["segments"]>[number],
): VideoJob => ({
  ...job,
  segments: job.segments?.map((s, i) => (i === 0 ? change(s) : s)),
});

function captioned(job: VideoJob, index: number): VideoJob {
  const url = `https://example.invalid/${Math.random()}`;
  const sent = {
    ...job,
    shots: job.shots.map((s) =>
      s.index === index ? { ...s, state: "rendering" as const, requestId: "r", resultUrl: url } : s,
    ),
  };
  return settle(rejectClip(sent, index, url, NOW));
}

describe("what the scene's picture says happened", () => {
  it("says nothing when every step went through the first time", () => {
    const job = made();
    expect(job.shots.map((s) => sceneNotes(job, s))).toEqual(job.shots.map(() => []));
  });

  it("says a speech was cut short and made again longer, and asks to listen when the second was kept", () => {
    const keptAfterTwo = withSegment(made(), (s) => {
      const once = segmentCutOff({ ...s, state: "rendering" }, videoModelOf(made()), NOW);
      const heard = { clip: "c.mp4", clipSec: 6, speech: { start: 0, end: 6 }, cutOff: true };
      return segmentKept({ ...once, model: "wan-3", state: "rendering" }, heard, NOW);
    });
    expect(sceneNotes(keptAfterTwo, spokenShot(keptAfterTwo))).toEqual([
      "Lời nói bị cắt ở cuối nên đã tạo lại dài hơn.",
      "Lời nói có thể bị cắt ở cuối, hãy nghe lại cảnh này.",
    ]);
  });

  it("names the model that added lettering, and says plainly when the scene is waiting for Thử lại", () => {
    const redoing = captioned(made(), MOVING);
    expect(sceneNotes(redoing, shotAt(redoing, MOVING))).toEqual([
      "Wan 3.0 tự thêm chữ vào cảnh nên đang tạo lại.",
    ]);
    const given = captioned(captioned(redoing, MOVING), MOVING);
    expect(shotAt(given, MOVING).state).toBe("failed");
    expect(sceneNotes(given, shotAt(given, MOVING))).toEqual([
      "Wan 3.0 tự thêm chữ vào cảnh 3 lần.",
      "Chưa tạo được cảnh này, giữ Thử lại để tạo lại.",
    ]);
  });

  it("tells a refusal from an error and keeps the refusing model's name", () => {
    let job = withSegment(made(), (s) => ({ ...s, state: "rendering", model: "minimax-h3-max" }));
    const refusal = "content_policy_violation: flagged";
    job = stepReportedFailure(job, { segment: job.segments?.[0]?.id as string }, refusal);
    job = withSegment(job, (s) => ({ ...s, state: "rendering", model: "minimax-h3-max" }));
    job = stepReportedFailure(job, { segment: job.segments?.[0]?.id as string }, refusal);
    expect(sceneNotes(job, spokenShot(job))).toEqual([
      "MiniMax H3 Max từ chối tạo cảnh này 2 lần.",
      "Chưa tạo được cảnh này, giữ Thử lại để tạo lại.",
    ]);
  });

  it("says a moving shot that kept failing became a still", () => {
    let job = made();
    job = stepReportedFailure(job, { shot: MOVING }, "Internal error");
    job = stepReportedFailure(job, { shot: MOVING }, "Internal error");
    job = {
      ...job,
      shots: job.shots.map((s) => (s.index === MOVING ? { ...s, state: "done" } : s)),
    };
    expect(sceneNotes(job, shotAt(job, MOVING))).toEqual([
      "Wan 3.0 báo lỗi 2 lần, đã thử lại.",
      "Không tạo được chuyển động, dùng ảnh tĩnh.",
    ]);
  });

  it("puts a redrawn still on every scene made from it", () => {
    const job = made();
    const frame = frameFor(job, spokenShot(job));
    const redrawn: VideoJob = {
      ...job,
      frames: job.frames.map((f) =>
        f.id === frame?.id
          ? {
              ...stillToDrawAgain(f, "unexpected text 'SALE'; 2 people", "gpt-image", NOW),
              file: "x.png",
            }
          : f,
      ),
    };
    const using = redrawn.shots.filter((s) => frameFor(redrawn, s)?.id === frame?.id);
    for (const shot of using) {
      expect(sceneNotes(redrawn, shot)).toEqual([
        "GPT Image 2.6 tự thêm chữ vào hình nên đã vẽ lại.",
        "Hình vẽ sai số người nên đã vẽ lại.",
      ]);
    }
  });

  it("explains a video made before the record existed from its counters", () => {
    const old = withSegment(made(), (s) => ({
      ...s,
      cutOffs: 2,
      failures: 2,
      rejectedClips: 1,
      rejectedModels: ["wan-3"],
    }));
    const loaded = migrateJob({ ...old, version: JOB_VERSION });
    expect(sceneNotes(loaded, spokenShot(loaded))).toEqual([
      "Wan 3.0 tự thêm chữ vào cảnh nên đã tạo lại.",
      "Lời nói bị cắt ở cuối 2 lần nên đã tạo lại dài hơn.",
    ]);
    expect(migrateJob(loaded)).toEqual(loaded);
  });
});
