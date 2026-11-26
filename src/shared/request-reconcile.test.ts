import { describe, expect, it } from "vitest";
import type { ScriptLine } from "./ipc";
import { AUTO_MODELS } from "./models";
import {
  openCutout,
  openRequests,
  parseLines,
  type RequestRecord,
  reconcileJob,
  withSending,
} from "./request-reconcile";
import { rulesPlan } from "./shot-plan";
import { clearShot } from "./video-fix";
import { applyPlan, newJob, shotFailed, type VideoJob } from "./video-job";

const NOW = "2026-11-19T07:00:00.000Z";
const line = (characterId: string, text: string): ScriptLine => ({
  characterId,
  speaker: characterId,
  text,
});
const LINES = [line("a", "Con chào ông ạ"), line("b", "Ừ, ngồi xuống uống chén trà đã")];

function job(): VideoJob {
  const base = applyPlan(
    newJob({
      sessionId: "s",
      seriesId: "x",
      scriptId: "v",
      title: "T",
      lines: LINES,
      useEnvironment: true,
      models: AUTO_MODELS,
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
  return {
    ...base,
    status: "running",
    shots: base.shots.map((s, i) => ({
      ...s,
      state: "queued",
      start: i,
      end: i + 1,
      audio: `a${i}.mp3`,
    })),
  };
}

const rec = (fields: Partial<RequestRecord>): RequestRecord => ({
  at: "2026-11-19T07:01:00.000Z",
  requestId: "r1",
  provider: "fal",
  endpoint: "fal-ai/x",
  sessionId: "s",
  scriptId: "v",
  ...fields,
});

const frameId = (j: VideoJob) => (j.frames[0] as { id: string }).id;

describe("open requests", () => {
  it("are recorded, with no result logged and no failure recorded", () => {
    const requests = [
      rec({ requestId: "done" }),
      rec({ requestId: "failed" }),
      rec({ requestId: "failed", failed: true }),
      rec({ requestId: "lost" }),
    ];
    expect(openRequests(requests, [{ requestId: "done" }]).map((r) => r.requestId)).toEqual([
      "lost",
    ]);
  });

  it("skip a line cut off mid-write", () => {
    expect(parseLines<{ a: number }>('{"a":1}\n{"a":\n\n{"a":2}\n')).toEqual([{ a: 1 }, { a: 2 }]);
  });
});

describe("reconcile on start", () => {
  it("attaches a still's request sent with its mark, so it is polled, not sent again", () => {
    const id = frameId(job());
    const marked = withSending(job(), { frame: id }, "m1");
    const { job: next, attached } = reconcileJob(marked, [
      rec({ purpose: "video-frame", frame: id, attempt: "m1" }),
    ]);
    const frame = next.frames.find((f) => f.id === id);
    expect(frame).toMatchObject({ requestId: "r1", submittedAt: "2026-11-19T07:01:00.000Z" });
    expect(frame?.sending).toBeUndefined();
    expect(frame?.endpoint).toBeUndefined();
    expect(attached).toHaveLength(1);
  });

  it("attaches a shot with the endpoint it went to, so it is polled there", () => {
    const marked = withSending(job(), { shot: 1 }, "m2");
    const { job: next } = reconcileJob(marked, [
      rec({
        purpose: "video-shot",
        shot: 1,
        attempt: "m2",
        endpoint: "alibaba/wan-3.0/image-to-video",
      }),
    ]);
    expect(next.shots[1]).toMatchObject({
      state: "rendering",
      requestId: "r1",
      endpoint: "alibaba/wan-3.0/image-to-video",
    });
    expect(next.shots[1]?.sending).toBeUndefined();
  });

  it("attaches a planned shot or keyframe only with its endpoint", () => {
    const base = { ...job(), live: {} as VideoJob["live"] };
    base.shots = base.shots.map((s) => ({ ...s, route: "lipsync" as never }));
    base.frames = base.frames.map((f) => ({ ...f, keyframe: "k" }));
    const id = frameId(base);
    const marked = withSending(withSending(base, { shot: 0 }, "a"), { frame: id }, "b");
    const { job: next } = reconcileJob(marked, [
      rec({ purpose: "video-shot", shot: 0, attempt: "a", endpoint: "fal-ai/avatar" }),
      rec({ purpose: "video-frame", frame: id, attempt: "b", endpoint: undefined }),
    ]);
    expect(next.shots[0]).toMatchObject({ state: "rendering", endpoint: "fal-ai/avatar" });
    expect(next.frames[0]?.requestId).toBeUndefined();
    expect(next.frames[0]?.sending).toBeUndefined();
  });

  it("takes the latest of several fitting records", () => {
    const marked = withSending(job(), { shot: 0 }, "m");
    const fit = { purpose: "video-shot", shot: 0, attempt: "m", model: "k" };
    const { job: next } = reconcileJob(marked, [
      rec({ ...fit, requestId: "old", at: "2026-11-19T07:01:00.000Z" }),
      rec({ ...fit, requestId: "new", at: "2026-11-19T07:02:00.000Z" }),
    ]);
    expect(next.shots[0]?.requestId).toBe("new");
  });

  it("never attaches a record of another attempt, step, script or session", () => {
    const marked = withSending(job(), { shot: 0 }, "m");
    const fit = { purpose: "video-shot", shot: 0, attempt: "m", model: "k" };
    const { job: next, attached } = reconcileJob(marked, [
      rec({ ...fit, attempt: "other" }),
      rec({ ...fit, attempt: undefined }),
      rec({ ...fit, shot: 1 }),
      rec({ ...fit, scriptId: "w" }),
      rec({ ...fit, sessionId: "t" }),
      rec({ ...fit, purpose: "video-frame" }),
    ]);
    expect(attached).toEqual([]);
    expect(next.shots[0]?.state).toBe("queued");
    expect(next.shots[0]?.requestId).toBeUndefined();
    expect(next.shots[0]?.sending).toBeUndefined();
  });

  it("never attaches old records without a mark, nor a request already in the job", () => {
    const j = job();
    expect(reconcileJob(j, [rec({ purpose: "video-shot", shot: 0, model: "k" })]).job).toBe(j);
    const marked = withSending(j, { shot: 0 }, "m");
    marked.shots[1] = {
      ...(marked.shots[1] as VideoJob["shots"][number]),
      state: "rendering",
      requestId: "r1",
    };
    const { job: next } = reconcileJob(marked, [
      rec({ purpose: "video-shot", shot: 0, attempt: "m", model: "k" }),
    ]);
    expect(next.shots[0]?.requestId).toBeUndefined();
  });

  it("never attaches to a step that no longer waits to be sent", () => {
    const marked = withSending(job(), { shot: 0 }, "m");
    marked.shots[0] = {
      ...(marked.shots[0] as VideoJob["shots"][number]),
      state: "done",
      clip: "c.mp4",
    };
    const { job: next } = reconcileJob(marked, [
      rec({ purpose: "video-shot", shot: 0, attempt: "m", model: "k" }),
    ]);
    expect(next.shots[0]?.state).toBe("done");
    expect(next.shots[0]?.requestId).toBeUndefined();
  });

  it("collects a stopped job's shot that was being sent", () => {
    const marked = withSending(job(), { shot: 0 }, "m");
    marked.status = "stopped";
    marked.shots[0] = { ...(marked.shots[0] as VideoJob["shots"][number]), state: "stopped" };
    const { job: next } = reconcileJob(marked, [
      rec({ purpose: "video-shot", shot: 0, attempt: "m", model: "k" }),
    ]);
    expect(next.shots[0]).toMatchObject({ state: "rendering", requestId: "r1" });
  });

  it("drops the mark whenever the input may change: a failed attempt or a fix", () => {
    const marked = withSending(job(), { shot: 0 }, "m");
    const shot = marked.shots[0] as VideoJob["shots"][number];
    expect(shotFailed(shot, "x").sending).toBeUndefined();
    expect(clearShot(shot).sending).toBeUndefined();
  });
});

describe("cut-outs", () => {
  it("match on product, photo and the photo's file; the latest wins", () => {
    const fit = { purpose: "product-cutout", productId: "p", photoId: "i", photoFile: "i.jpg" };
    const open = [
      rec({ ...fit, requestId: "a", at: "2026-11-19T07:01:00.000Z" }),
      rec({ ...fit, requestId: "b", at: "2026-11-19T07:02:00.000Z" }),
      rec({ ...fit, requestId: "c", photoFile: "replaced.png" }),
      rec({ purpose: "product-cutout", productId: "p", requestId: "dialog" }),
    ];
    expect(openCutout(open, "p", "i", "i.jpg")?.requestId).toBe("b");
    expect(openCutout(open, "p", "i", "other.jpg")).toBeUndefined();
    expect(openCutout(open, "q", "i", "i.jpg")).toBeUndefined();
  });
});
