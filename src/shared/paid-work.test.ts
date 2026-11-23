import { describe, expect, it } from "vitest";
import { SOUND_EFFECT_USD_PER_SEC, STILL_USD } from "./cost/rates";
import type { ScriptLine } from "./ipc";
import {
  deleteWarning,
  paidWork,
  quitConfirmation,
  stillOwedHint,
  videosBeingMade,
  windowCloseConfirmation,
} from "./paid-work";
import { rulesPlan } from "./shot-plan";
import type { JobSound } from "./sound";
import type { JobSegment } from "./speech";
import { speechModel, speechUsd } from "./speech-models";
import { applyPlan, newJob, type VideoJob, withShotAudio } from "./video-job";
import { modelOutput, videoModel } from "./video-models";

const VIDEO_USD_PER_SEC = modelOutput(videoModel()).usdPerSec;
const NOW = "2026-11-21T10:00:00.000Z";

const line = (characterId: string, text: string): ScriptLine => ({
  characterId,
  speaker: characterId,
  text,
});
const LINES = [line("a", "Con chào ông ạ"), line("b", "Ừ, ngồi xuống uống chén trà đã")];

function made(sessionId: string, patch: Partial<VideoJob> = {}): VideoJob {
  const planned = applyPlan(
    newJob({
      sessionId,
      seriesId: "x",
      scriptId: `${sessionId}-1`,
      title: "T",
      lines: LINES,
      useEnvironment: true,
      now: NOW,
    }),
    rulesPlan({
      lines: LINES,
      cast: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      products: [],
      hasPlace: true,
    }),
  );
  const voiced = withShotAudio(
    { ...planned, dialogue: "dialogue.mp3" },
    LINES.map((_, i) => ({ start: i * 3, end: i * 3 + 3, audio: `line-${i}.mp3`, audioSec: 3 })),
  );
  return {
    ...voiced,
    frames: voiced.frames.map((f) => ({ ...f, file: `${f.id}.png` })),
    ...patch,
  };
}

const rendering = (job: VideoJob, index: number, extra: object = {}) =>
  job.shots.map((s) =>
    s.index === index ? { ...s, state: "rendering" as const, requestId: `r${index}`, ...extra } : s,
  );

const sound = (requestId?: string): JobSound => ({
  id: "ambience",
  role: "ambience",
  text: "wind",
  seconds: 2,
  loop: true,
  attempts: 0,
  ...(requestId ? { requestId } : {}),
});

const segment = (patch: Partial<JobSegment> = {}): JobSegment => ({
  id: "line-1-a",
  line: 0,
  shots: [0],
  speakerShot: 0,
  characterId: "a",
  text: "Con chào ông ạ",
  frame: "character:a",
  hold: 0,
  state: "rendering",
  model: "wan-3",
  seconds: 4,
  requestId: "g1",
  retried: false,
  failures: 0,
  ...patch,
});

function dubbedRunning(): VideoJob {
  const job = made("s1", { status: "running" });
  return {
    ...job,
    shots: rendering(job, 1),
    frames: job.frames.map((f, i) => (i === 0 ? { ...f, file: undefined, requestId: "f1" } : f)),
    sounds: [sound("n1")],
  };
}

function stoppedWithClipOut(): VideoJob {
  const job = made("s1", { status: "stopped" });
  return { ...job, scriptId: "s1-2", shots: rendering(job, 0) };
}

function nativeWaiting(): VideoJob {
  return { ...made("s2", { status: "waiting", voiceMode: "native" }), segments: [segment()] };
}

describe("paid work in progress", () => {
  it("counts videos being made and every request still out, with its calculated cost", () => {
    const idle = made("s3", { status: "idle" });
    const work = paidWork([dubbedRunning(), stoppedWithClipOut(), nativeWaiting(), idle]);
    expect(work.videos).toBe(2);
    expect(work.requests).toBe(5);
    expect(work.usd).toBeCloseTo(
      3 * VIDEO_USD_PER_SEC +
        STILL_USD +
        2 * SOUND_EFFECT_USD_PER_SEC +
        3 * VIDEO_USD_PER_SEC +
        speechUsd(speechModel("wan-3"), 4),
    );
  });

  it("a result already received is no longer out", () => {
    const job = dubbedRunning();
    const received = {
      ...job,
      shots: rendering(job, 1, { resultUrl: "https://result" }),
      frames: job.frames.map((f) => ({ ...f, file: `${f.id}.png` })),
      sounds: [{ ...sound("n1"), resultUrl: "https://sound" }],
    };
    expect(paidWork([received])).toEqual({ videos: 1, requests: 0, usd: 0 });
    const spoken = { ...nativeWaiting(), segments: [segment({ resultUrl: "https://clip" })] };
    expect(paidWork([spoken])).toEqual({ videos: 1, requests: 0, usd: 0 });
  });

  it("lists, per session, only the videos being made", () => {
    expect(
      videosBeingMade([
        dubbedRunning(),
        stoppedWithClipOut(),
        nativeWaiting(),
        made("s3", { status: "idle" }),
      ]),
    ).toEqual({ s1: 1, s2: 1 });
  });
});

const nothing = { videos: 0, requests: 0, usd: 0 };
const REOPEN = "Mở lại ứng dụng để nhận kết quả và tạo tiếp phần còn lại.";

describe("quit confirmation", () => {
  it("is not asked with no paid work in progress", () => {
    expect(quitConfirmation(nothing, 0)).toBeNull();
  });

  it("says what keeps being billed, what continues later and what is lost", () => {
    expect(quitConfirmation({ videos: 2, requests: 3, usd: 1.5 }, 1)).toEqual({
      message: "Đang tạo 2 video",
      detail: `3 yêu cầu đã gửi vẫn chạy và vẫn tính tiền (~$1.50). ${REOPEN} 1 bước đang tạo sẽ mất nếu thoát bây giờ.`,
    });
  });

  it("with videos being made but nothing out, only says they continue later", () => {
    expect(quitConfirmation({ videos: 1, requests: 0, usd: 0 }, 0)).toEqual({
      message: "Đang tạo 1 video",
      detail: REOPEN,
    });
  });

  it("with a stopped video's requests still out, names no video count", () => {
    expect(quitConfirmation({ videos: 0, requests: 2, usd: 0.4 }, 0)).toEqual({
      message: "Đang tạo dở",
      detail: `2 yêu cầu đã gửi vẫn chạy và vẫn tính tiền (~$0.40). ${REOPEN}`,
    });
  });

  it("with only a blocking step running, says only that it is lost", () => {
    expect(quitConfirmation(nothing, 2)).toEqual({
      message: "Đang tạo dở",
      detail: "2 bước đang tạo sẽ mất nếu thoát bây giờ.",
    });
  });
});

describe("closing the window", () => {
  it("is confirmed only while a blocking step runs", () => {
    expect(windowCloseConfirmation(0)).toBeNull();
    expect(windowCloseConfirmation(1)).toEqual({
      message: "Đang tạo dở",
      detail: "1 bước đang tạo sẽ mất nếu đóng cửa sổ bây giờ.",
    });
  });
});

describe("deleting with paid work in progress", () => {
  it("warns only while videos are being made or requests are out", () => {
    expect(deleteWarning(nothing)).toBeNull();
    expect(deleteWarning({ videos: 2, requests: 0, usd: 0 })).toBe(
      "Đang tạo 2 video, sẽ dừng lại.",
    );
    expect(deleteWarning({ videos: 1, requests: 3, usd: 0.9 })).toBe(
      "Đang tạo 1 video. 3 yêu cầu đã gửi vẫn tính tiền (~$0.90), kết quả sẽ mất.",
    );
    expect(deleteWarning({ videos: 0, requests: 1, usd: 0.3 })).toBe(
      "1 yêu cầu đã gửi vẫn tính tiền (~$0.30), kết quả sẽ mất.",
    );
  });
});

describe("stopping", () => {
  it("shows the most that may still be billed, and nothing when nothing is out", () => {
    expect(stillOwedHint(0)).toBeUndefined();
    expect(stillOwedHint(0.42)).toBe("· vẫn trả tối đa ~$0.42");
  });
});
