import { describe, expect, it } from "vitest";
import { estimateVoiceUsd } from "./board";
import { withInUsePaid } from "./cost/charges.fixture";
import { costToFinishUsd, shotEstimateUsd } from "./cost/estimate";
import { costPanel } from "./cost/table";
import {
  cheaperAlternatives,
  emptyRecord,
  evidenceMinimumSec,
  fitDuration,
  type LiveAnswer,
  type LiveContext,
  liveDirection,
  type ModelSchema,
  readLivePlan,
  readMediaUrl,
  recordResult,
  requestCost,
  statedMinimumSec,
  type ToolRecord,
} from "./live-plan";
import { mediaLevel } from "./media-level";
import { MAX_BUSY_ANSWERS } from "./net-error";
import {
  applyLivePlan,
  followBatch,
  frameDeps,
  madeByProvider,
  newJob,
  nextActions,
  shotAttemptFailed,
  stepReportedFailure,
  stepThrew,
  type VideoJob,
  waitingForNetwork,
} from "./video-job";

const NOW = "2026-11-13T10:00:00.000Z";
const level = mediaLevel("balanced");
const LINES = [
  { characterId: "a", speaker: "An", text: "Chào ông, hôm nay trời đẹp quá ạ." },
  { characterId: "b", speaker: "Ba", text: "Ừ, ngồi xuống uống chén trà đã cháu." },
];
const ctx: LiveContext = {
  lines: LINES,
  cast: [
    { id: "a", name: "An" },
    { id: "b", name: "Ba" },
  ],
  products: [],
  hasPlace: true,
  refs: ["place-1", "cast1-1", "cast2-1"],
  level,
};

const IMAGE = "img/edit";
const LIPS = "lips/min5";
const CHEAP = "lips/free";

function session(): ToolRecord {
  const record = emptyRecord();
  const schema = (endpoint: string, params: unknown[]) =>
    recordResult(
      record,
      "mcp__fal__get_model_schema",
      [JSON.stringify({ endpoint_id: endpoint, display_name: endpoint, input_params: params })],
      false,
    );
  schema(IMAGE, [
    { name: "prompt", type: "string", required: true },
    { name: "image_urls", type: "array<string>", required: true },
  ]);
  schema(LIPS, [
    { name: "image_url", type: "string", required: true },
    {
      name: "audio_url",
      type: "string",
      required: true,
      description: "Audio to synchronize the mouth to, at least 5 seconds",
    },
  ]);
  schema(CHEAP, [
    { name: "image_url", type: "string", required: true },
    { name: "audio_url", type: "string", required: true },
  ]);
  recordResult(
    record,
    "mcp__fal__get_pricing",
    [
      JSON.stringify({
        prices: [
          { endpoint_id: IMAGE, unit_price: 0.08, unit: "images" },
          { endpoint_id: LIPS, unit_price: 0.08, unit: "seconds" },
          { endpoint_id: CHEAP, unit_price: 6, unit: "minutes" },
        ],
      }),
    ],
    false,
  );
  recordResult(
    record,
    "mcp__fal__recommend_model",
    [
      JSON.stringify({
        decision_id: "d",
        interpreted_task: { operation_id: "lip-sync" },
        results: [{ fit_candidates: [{ endpoint_id: CHEAP, fit_status: "pass" }] }],
      }),
    ],
    false,
  );
  return record;
}

const answer = (): LiveAnswer => ({
  keyframes: [
    {
      id: "master",
      kind: "master",
      endpoint: IMAGE,
      input: { prompt: "Wide", image_urls: ["{{place-1}}", "{{cast1-1}}", "{{cast2-1}}"] },
    },
    {
      id: "an",
      kind: "character",
      character: "An",
      framing: "over Ba's shoulder",
      endpoint: IMAGE,
      input: { prompt: "An", image_urls: ["{{cast1-1}}", "{{keyframe:master}}"] },
    },
    {
      id: "ba",
      kind: "character",
      character: "Ba",
      endpoint: IMAGE,
      input: { prompt: "Ba", image_urls: ["{{cast2-1}}", "{{keyframe:master}}"] },
    },
  ],
  shots: [
    {
      n: 1,
      line: 1,
      type: "speaker",
      character: "An",
      text: LINES[0]?.text,
      keyframe: "an",
      route: "lip-sync",
      endpoint: LIPS,
      input: { image_url: "{{keyframe}}", audio_url: "{{audio}}" },
    },
    {
      n: 2,
      line: 2,
      type: "speaker",
      character: "Ba",
      text: LINES[1]?.text,
      keyframe: "ba",
      route: "lip-sync",
      endpoint: LIPS,
      input: { image_url: "{{keyframe}}", audio_url: "{{audio}}" },
    },
  ],
  models: [
    { endpoint: IMAGE, role: "keyframes", why: "x" },
    { endpoint: LIPS, role: "lip-sync", why: "x" },
  ],
});

function plannedJob(): VideoJob {
  const record = session();
  const { plan, errors } = readLivePlan(answer(), ctx, record);
  expect(errors).toEqual([]);
  const live = liveDirection(plan, record, LINES, {
    connection: "signed-in",
    model: null,
    ms: 0,
  });
  const job = newJob({
    sessionId: "s",
    seriesId: "r",
    scriptId: "x",
    title: "t",
    lines: LINES,
    useEnvironment: true,
    now: NOW,
  });
  return { ...applyLivePlan(job, live), status: "running" };
}

describe("minimum lengths from what the tools said", () => {
  it("reads stated minimums from schemas and guide text", () => {
    expect(statedMinimumSec("Audio to sync, at least 5 seconds")).toBe(5);
    expect(statedMinimumSec("minimum of 2 s")).toBe(2);
    expect(statedMinimumSec("up to 15 min")).toBeUndefined();
    expect(session().schemas[LIPS]?.minAudioSec).toBe(5);
    const guide = `## Host\\n\`${CHEAP}\`: animates a face.\\n- \`audio_url\`: required, at least 3 s and up to 15 min.`;
    expect(evidenceMinimumSec(guide, CHEAP)).toBe(3);
    expect(evidenceMinimumSec(guide, "other/model")).toBeUndefined();
  });

  it("bills and pads lip-sync to the minimum, and counts per-minute rates", () => {
    const record = session();
    const rate = { usd: 0.08, unit: "seconds", minSeconds: 5 };
    expect(requestCost(rate, record.schemas[LIPS], {}, "lip-sync", 2.2)).toMatchObject({
      quantity: "5 giây",
    });
    expect(requestCost(rate, undefined, {}, "lip-sync", 2.2).usd).toBeCloseTo(0.4);
    expect(requestCost({ usd: 6, unit: "minutes" }, undefined, {}, "lip-sync", 3).usd).toBeCloseTo(
      0.3,
    );
  });

  it("names a cheaper fit-checked model for these shots", () => {
    const record = session();
    const { plan } = readLivePlan(answer(), ctx, record);
    const [warning] = cheaperAlternatives(plan, record);
    expect(warning).toMatch(
      /^Khẩu hình: lips\/free would cost ~\$0\.\d\d for these shots instead of ~\$0\.80/,
    );
  });
});

describe("making a motion clip last the shot", () => {
  const schema = (param: Record<string, unknown>): ModelSchema => ({
    endpoint: "m",
    name: "m",
    category: "",
    outputs: [],
    params: [{ name: "duration", type: "integer", required: false, ...param }],
  });
  it("picks the smallest allowed length that covers it", () => {
    expect(fitDuration(schema({ enum: ["5", "10"] }), {}, 6.2)).toEqual({
      input: { duration: "10" },
      seconds: 10,
    });
    expect(fitDuration(schema({ min: 3, max: 15, default: 5 }), { duration: 3 }, 3.4)).toEqual({
      input: { duration: 4 },
      seconds: 4,
    });
    expect(fitDuration(schema({ min: 3, max: 15 }), {}, 1.2).seconds).toBe(3);
  });
});

describe("a planned job", () => {
  it("has one still per keyframe, made after the keyframes it uses", () => {
    const job = plannedJob();
    expect(job.frames.map((f) => [f.id, f.kind])).toEqual([
      ["kf:master", "wide"],
      ["kf:an", "character"],
      ["kf:ba", "character"],
    ]);
    expect(job.shots.map((s) => [s.route, s.keyframe])).toEqual([
      ["lip-sync", "an"],
      ["lip-sync", "ba"],
    ]);
    const an = job.frames[1];
    expect(an && frameDeps(job, an)).toEqual(["kf:master"]);
    const voiced = {
      ...job,
      dialogue: "d.mp3",
      shots: job.shots.map((s, i) => ({
        ...s,
        start: i * 3,
        end: i * 3 + 3,
        audio: `a${i}.mp3`,
        audioSec: 2.4,
        state: "queued" as const,
      })),
    };
    expect(nextActions(voiced, new Set())).toEqual([{ kind: "frame", frame: "kf:master" }]);
    const masterDone = {
      ...voiced,
      frames: voiced.frames.map((f) => (f.id === "kf:master" ? { ...f, file: "m.png" } : f)),
    };
    expect(nextActions(masterDone, new Set()).map((a) => a.kind === "frame" && a.frame)).toEqual([
      "kf:an",
      "kf:ba",
    ]);
  });

  it("shows the same price on the table and the hold, before and after the voice", () => {
    const job = plannedJob();
    const table = costPanel(job);
    expect(table?.estimateUsd).toBeCloseTo(costToFinishUsd(job) ?? Number.NaN);
    expect(table?.estimateUsd).toBeCloseTo((job.live?.costs.rows[0]?.usd ?? 0) + 0.24 + 0.8);
    expect(table?.estimateUsd).toBeCloseTo(job.live?.costs.knownUsd ?? 0);
    expect(table?.paid).toBeNull();
    const voiced = withInUsePaid({
      ...job,
      status: "running" as const,
      dialogue: "d.mp3",
      voiceCostUsd: 0.01,
      shots: job.shots.map((s) => ({ ...s, start: 0, end: 6, audioSec: 6 })),
    });
    const after = costPanel(voiced);
    expect(after?.estimateUsd).toBeCloseTo(
      estimateVoiceUsd(LINES) + (costToFinishUsd(voiced) ?? Number.NaN),
    );
    expect(after?.paid).toEqual({ usd: 0.01, billed: false });
    expect(after?.leftUsd).toBeCloseTo(costToFinishUsd(voiced) ?? Number.NaN);
    expect(after?.steps.at(-1)).toMatchObject({ quantity: "6 giây" });
  });

  it("falls back after a planned shot fails twice", () => {
    const job = plannedJob();
    const shot = job.shots[0];
    if (!shot) throw new Error("no shot");
    const once = shotAttemptFailed(job, { ...shot, endpoint: LIPS }, "x");
    expect(once).toMatchObject({ state: "queued", retried: true, endpoint: undefined });
    const twice = shotAttemptFailed(job, once, "x");
    expect(twice).toMatchObject({ state: "queued", fallback: true, retried: false });
    expect(madeByProvider(twice)).toBe(true);
    expect(madeByProvider({ kind: "wide", route: "motion", fallback: true })).toBe(false);
    expect(madeByProvider({ kind: "wide", route: "motion" })).toBe(true);
  });

  it("keeps a made step with no recorded price unknown, never free", () => {
    const base = plannedJob();
    if (!base.live) throw new Error("no plan");
    const { [LIPS]: _, ...rates } = base.live.rates;
    const job: VideoJob = { ...base, live: { ...base.live, rates } };
    const shot = job.shots[0];
    if (!shot) throw new Error("no shot");
    expect(shotEstimateUsd(job, shot)).toBeNull();
    const made: VideoJob = {
      ...job,
      shots: job.shots.map((s) =>
        s.index === 0 ? { ...s, state: "done", clip: "c.mp4", costUsd: null } : s,
      ),
    };
    const table = costPanel(made);
    expect(table?.steps.find((r) => r.label.startsWith("Cảnh 1"))).toMatchObject({
      estimateUsd: null,
      paid: { usd: null, billed: false },
    });
    expect(table?.unknownSteps).toBe(costPanel(job)?.unknownSteps);
  });

  it("keeps its own size and models whatever the batch says", () => {
    const job = { ...plannedJob(), resolution: "1080p" };
    expect(followBatch(job, { model: "kling-avatar-v2-standard", resolution: "720p" })).toBe(job);
  });
});

describe("reading a result", () => {
  it("finds the first image or video", () => {
    expect(readMediaUrl({ images: [{ url: "https://x/a.png" }] }, "image")).toBe("https://x/a.png");
    expect(readMediaUrl({ video: { url: "https://x/v.mp4" } }, "video")).toBe("https://x/v.mp4");
    expect(readMediaUrl({ output: { clip: "https://x/c.mp4?t=1" } }, "video")).toBe(
      "https://x/c.mp4?t=1",
    );
    expect(readMediaUrl({ video: null }, "video")).toBeUndefined();
  });
});

describe("network trouble", () => {
  const offlineError = () =>
    new TypeError("fetch failed", {
      cause: Object.assign(new Error("getaddrinfo ENOTFOUND v3b.fal.media"), { code: "ENOTFOUND" }),
    });
  const T0 = Date.parse(NOW);

  it("never counts toward the fallback, however often it happens", () => {
    let job = plannedJob();
    for (let i = 0; i < 6; i++) {
      job = stepThrew(job, { frame: "kf:an" }, offlineError(), T0 + i * 120_000);
      job = stepThrew(job, { shot: 0 }, offlineError(), T0 + i * 120_000);
    }
    const an = job.frames.find((f) => f.id === "kf:an");
    expect(an).toMatchObject({ retried: false });
    expect(an?.fallback).toBeUndefined();
    expect(an?.error).toBeUndefined();
    expect(job.shots[0]).toMatchObject({ state: "planned", retried: false, failures: 0 });
    expect(job.shots[0]?.fallback).toBeUndefined();
    expect(job.status).toBe("running");
    expect(job.offline?.tries).toBe(6);
  });

  it("still counts real failures: two, then the fallback", () => {
    let job = plannedJob();
    job = stepThrew(job, { frame: "kf:an" }, new Error("input.prompt: too long"), T0);
    expect(job.frames[1]).toMatchObject({ retried: true });
    job = stepReportedFailure(job, { frame: "kf:an" }, "model failed");
    expect(job.frames[1]).toMatchObject({ fallback: true, retried: false });
    expect(job.offline).toBeUndefined();
  });

  it("waits before trying again, longer each round; failures side by side are one round", () => {
    let job = stepThrew(plannedJob(), { frame: "kf:master" }, offlineError(), T0);
    job = stepThrew(job, { frame: "kf:an" }, offlineError(), T0 + 100);
    expect(job.offline?.tries).toBe(1);
    expect(waitingForNetwork(job, T0 + 4_000)).toBe(true);
    expect(waitingForNetwork(job, T0 + 5_000)).toBe(false);
    job = stepThrew(job, { frame: "kf:master" }, offlineError(), T0 + 5_000);
    expect(job.offline?.tries).toBe(2);
    expect(waitingForNetwork(job, T0 + 14_000)).toBe(true);
    expect(waitingForNetwork(job, T0 + 15_000)).toBe(false);
  });

  it("keeps a saved request id: the result is fetched by it, never bought again", () => {
    const base = plannedJob();
    const sent = {
      ...base,
      frames: base.frames.map((f) =>
        f.id === "kf:master" ? { ...f, requestId: "req-1", endpoint: IMAGE } : f,
      ),
    };
    const job = stepThrew(sent, { frame: "kf:an" }, offlineError(), T0);
    expect(job.frames[0]).toMatchObject({ requestId: "req-1", endpoint: IMAGE });
    expect(nextActions({ ...job, offline: undefined }, new Set())).toContainEqual({
      kind: "poll-frame",
      frame: "kf:master",
    });
  });

  it("a provider that keeps answering busy counts as a failed attempt after a bounded number of tries", () => {
    const busy = () => Object.assign(new Error("Internal Server Error"), { status: 500 });
    let job = plannedJob();
    for (let i = 0; i < MAX_BUSY_ANSWERS - 1; i++) {
      job = stepThrew(job, { shot: 0 }, busy(), T0 + i * 120_000);
    }
    expect(job.shots[0]).toMatchObject({ retried: false, failures: 0 });
    expect(job.offline).toBeDefined();
    job = stepThrew(job, { shot: 0 }, busy(), T0 + MAX_BUSY_ANSWERS * 120_000);
    expect(job.shots[0]).toMatchObject({ retried: true, failures: 1 });
    expect(job.shots[0]?.busyAnswers).toBeUndefined();
    for (let i = 0; i < MAX_BUSY_ANSWERS; i++) {
      job = stepThrew(job, { shot: 0 }, busy(), T0 + (10 + i) * 120_000);
    }
    expect(job.shots[0]).toMatchObject({ fallback: true, failures: 2 });
  });
});
