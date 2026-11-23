import { describe, expect, it } from "vitest";
import { buildDirection } from "./build-direction";
import {
  CLIP_NOT_USABLE,
  MAX_AUTO_REDOS_PER_SHOT,
  rejectClip,
  withUnrecordedSpeakerRejections,
} from "./clip-check";
import { redoneCharges, spentUsd, withRecordedCharges } from "./cost/charges";
import { withInUsePaid } from "./cost/charges.fixture";
import { costToFinishUsd, shotEstimateUsd } from "./cost/estimate";
import { STILL_USD as FRAME_USD, MOTION_RATE } from "./cost/rates";
import type { ScriptLine } from "./ipc";
import { mediaLevel } from "./media-level";
import { MOTION_OF_A_STILL_MOMENT } from "./prompt-text";
import { builtinRecipe } from "./recipe";
import { readShotList, type ShotListAnswer } from "./shot-list";
import { answer, CTX, LINES } from "./shot-list.fixture";
import type { ShotPlan } from "./shot-plan";
import { applyFix } from "./video-fix";
import {
  applyLivePlan,
  applyPlan,
  jobPhase,
  madeByProvider,
  newJob,
  resumeJob,
  settle,
  type VideoJob,
  withJobSounds,
  withShotAudio,
} from "./video-job";
import { modelOutput, videoModel } from "./video-models";
import {
  chooseVersion,
  chosenVersion,
  chosenView,
  deleteVersion,
  focusVersion,
  levelsToTry,
  planAtLevel,
  startVersion,
  versionCostUsd,
  versionLabel,
  versionPriceUsd,
  versions,
  versionView,
  viewVersion,
  workingVersion,
} from "./video-takes";

const NOW = "2026-11-19T10:00:00.000Z";
const LATER = "2026-11-19T11:00:00.000Z";
const CAST = [
  { id: "a", name: "An", photos: 3 },
  { id: "b", name: "Ba", photos: 2 },
];
const KLING = videoModel("kling-avatar-v2-standard");
const OMNI = videoModel("omnihuman-v2");
const SPEAKING = [0, 2, 4];
const WIDE = 1;
const PRODUCT = 3;

function staged(moving: boolean, sound: boolean): ShotListAnswer {
  const a = answer();
  const wide = (a.shots ?? [])[WIDE] as Record<string, unknown>;
  if (sound) {
    a.ambience = "quiet courtyard, distant birdsong";
    wide.sound = "porcelain cup set down on a wooden table";
  }
  if (moving) {
    wide.route = "motion";
    wide.motion = "Bamboo leaves stir and the camera drifts toward the table.";
  }
  return a;
}

function plannedAt(levelId: string): VideoJob {
  const level = mediaLevel(levelId);
  const { list, errors } = readShotList(staged(level.motion, level.sound), CTX, {
    motion: level.motion,
    sound: level.sound,
  });
  expect(errors).toEqual([]);
  const live = buildDirection({
    list,
    recipe: builtinRecipe(level),
    lines: LINES,
    level,
    cast: CAST,
    placePhotos: 3,
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
  return {
    ...applyLivePlan(job, live),
    level: level.id,
    model: level.speaker,
    resolution: level.output,
    reviewed: true,
    modelLocked: true,
  };
}

const timed = (job: VideoJob) =>
  withShotAudio(
    job,
    job.shots.map((s, i) => ({
      start: i * 3,
      end: i * 3 + 3,
      ...(madeByProvider(s) ? { audio: `audio-${i}-r${job.rev ?? 0}.mp3`, audioSec: 3 } : {}),
    })),
  );

function finish(job: VideoJob, tag: string): VideoJob {
  const ready = jobPhase(job) === "voice" ? withJobSounds(timed(job)) : job;
  return withInUsePaid(
    settle({
      ...ready,
      status: "running",
      shots: ready.shots.map((s) =>
        s.state === "done"
          ? s
          : {
              ...s,
              state: "done" as const,
              clip: `shot-${s.index}-${tag}.mp4`,
              clipSec: 3,
              ...(madeByProvider(s)
                ? {
                    costUsd: shotEstimateUsd(ready, s),
                    endpoint: ready.live?.plan.routes[s.index]?.endpoint ?? undefined,
                    requestId: `req-${s.index}-${tag}`,
                  }
                : {}),
            },
      ),
      sounds: ready.sounds?.map((s) =>
        s.file ? s : { ...s, file: `${s.id}-${tag}.mp3`, costUsd: 0.01 },
      ),
      final: `final-${tag}.mp4`,
      finalSec: 15,
    }),
  );
}

function voicedAt(levelId: string): VideoJob {
  const planned = plannedAt(levelId);
  return withInUsePaid(
    withJobSounds(
      timed({
        ...planned,
        dialogue: "dialogue.mp3",
        dialogueSec: 14,
        voiceCostUsd: 0.05,
        lineSpans: LINES.map((_, i) => ({ start: i * 5, end: i * 5 + 5 })),
        frames: planned.frames.map((f) => ({ ...f, file: `${f.id}.png`, costUsd: FRAME_USD })),
      }),
    ),
  );
}

const madeAt = (levelId: string) => finish(voicedAt(levelId), "a");

const routeOf = (job: VideoJob, i: number) => job.live?.plan.routes[i];
const stateOf = (job: VideoJob) => job.shots.map((s) => s.state);

describe("a second version at another quality level", () => {
  it("Cân bằng to Cao cấp remakes only the speaking shots, with the new model's minimum", () => {
    const job = madeAt("balanced");
    expect(job.status).toBe("done");
    const high = startVersion(job, "high", LATER);
    expect(high).toMatchObject({ level: "high", model: OMNI.id, status: "waiting", rev: 1 });
    expect(stateOf(high)).toEqual(["queued", "done", "queued", "done", "queued"]);
    for (const i of SPEAKING) {
      expect(routeOf(high, i)?.endpoint).toBe(OMNI.endpoint);
      expect(routeOf(high, i)?.input?.prompt).toBe(routeOf(job, i)?.input?.prompt);
    }
    expect(routeOf(high, WIDE)).toEqual(routeOf(job, WIDE));
    expect(high.shots[WIDE]?.clip).toBe(job.shots[WIDE]?.clip);
    expect(high.frames.map((f) => f.file)).toEqual(job.frames.map((f) => f.file));
    expect(high.sounds?.map((s) => s.file)).toEqual(job.sounds?.map((s) => s.file));
    expect(high.dialogue).toBe(job.dialogue);
    const omniSec = Math.max(4, 3) * modelOutput(OMNI).usdPerSec;
    expect(versionPriceUsd(job, "high", LATER)).toBeCloseTo(SPEAKING.length * omniSec);
    expect(spentUsd(high)).toBeCloseTo(spentUsd(job));
  });

  it("Cân bằng to Nhanh keeps the speaking shots, makes moving shots locally and drops sound", () => {
    const job = madeAt("balanced");
    const fast = startVersion(job, "fast", LATER);
    expect(fast).toMatchObject({ level: "fast", resolution: "720p" });
    expect(routeOf(fast, WIDE)).toMatchObject({ route: "still-move", endpoint: null });
    expect(fast.shots[WIDE]?.state).toBe("queued");
    for (const i of SPEAKING) expect(fast.shots[i]?.clip).toBe(job.shots[i]?.clip);
    expect(fast.shots[PRODUCT]?.state).toBe("queued");
    expect(fast.sounds).toBeUndefined();
    expect(versionPriceUsd(job, "fast", LATER)).toBe(0);
  });

  it("Nhanh to Cân bằng animates the wide shot from the same still and keeps the speaking shots", () => {
    const job = madeAt("fast");
    expect(routeOf(job, WIDE)?.route).toBe("still-move");
    const balanced = startVersion(job, "balanced", LATER);
    expect(routeOf(balanced, WIDE)).toMatchObject({ route: "motion", keyframe: "master" });
    expect(routeOf(balanced, WIDE)?.input?.prompt).toBe(MOTION_OF_A_STILL_MOMENT);
    for (const i of SPEAKING) expect(balanced.shots[i]?.clip).toBe(job.shots[i]?.clip);
    expect(balanced.frames.every((f, i) => f.file === job.frames[i]?.file)).toBe(true);
    expect(jobPhase(balanced)).toBe("voice");
    const motionUsd = 3 * (MOTION_RATE.usd ?? 0);
    expect(versionPriceUsd(job, "balanced", LATER)).toBeCloseTo(motionUsd);
    const done = finish(balanced, "b");
    expect(done.voiceCostUsd).toBe(0);
    expect(spentUsd(done) - spentUsd(job)).toBeCloseTo(motionUsd);
  });

  it("every offered level draws the same stills, so stills are never paid again", () => {
    const stills = (id: string) => builtinRecipe(mediaLevel(id)).stills;
    expect(stills("fast")).toEqual(stills("balanced"));
    expect(stills("high")).toEqual(stills("balanced"));
  });

  it("never pays again for a clip another version already made", () => {
    const balanced = madeAt("balanced");
    const high = finish(startVersion(balanced, "high", LATER), "b");
    const fast = startVersion(high, "fast", LATER);
    for (const i of SPEAKING) {
      expect(fast.shots[i]?.clip).toBe(balanced.shots[i]?.clip);
      expect(routeOf(fast, i)?.endpoint).toBe(KLING.endpoint);
    }
    expect(costToFinishUsd(fast)).toBe(0);
  });

  it("each version shows what it cost to make and together they make the total", () => {
    const balanced = madeAt("balanced");
    const first = spentUsd(balanced);
    const high = finish(startVersion(balanced, "high", LATER), "b");
    const fast = finish(startVersion(high, "fast", LATER), "c");
    const total = spentUsd(fast);
    const each = versions(fast).map((v) => versionCostUsd(fast, v) ?? Number.NaN);
    expect(versions(fast)).toEqual(["balanced", "high", "fast"]);
    expect(each[0]).toBeCloseTo(first);
    expect(each[1]).toBeCloseTo(total - first);
    expect(each[2]).toBeCloseTo(0);
    expect(each.reduce((n, v) => n + v, 0)).toBeCloseTo(total);
    const back = focusVersion(fast, "balanced", LATER);
    expect(spentUsd(back)).toBeCloseTo(total);
    expect(versionCostUsd(back, "high")).toBeCloseTo(total - first);
    expect(spentUsd(versionView(back, "high"))).toBeCloseTo(total - first);
    const views = versions(back).map((v) => versionView(back, v));
    expect(views.reduce((n, v) => n + spentUsd(v), 0)).toBeCloseTo(total);
    expect(views.flatMap(redoneCharges)).toEqual([]);
  });

  it("switches, picks and deletes versions, keeping files another version still uses", () => {
    const balanced = madeAt("balanced");
    const high = finish(startVersion(balanced, "high", LATER), "b");
    expect(chosenVersion(high)).toBe("balanced");
    expect(chosenView(high).final).toBe("final-a.mp4");
    expect(() => chooseVersion(startVersion(balanced, "high", LATER), "high", LATER)).toThrow();
    const picked = chooseVersion(high, "high", LATER);
    expect(chosenView(picked).final).toBe("final-b.mp4");
    expect(versionLabel(picked, "high")).toBe("Cao cấp");
    expect(viewVersion(picked, "balanced").shots[0]?.clip).toBe("shot-0-a.mp4");
    const fast = finish(startVersion(picked, "fast", LATER), "c");
    expect(() => deleteVersion(fast, "high", LATER)).toThrow("Đây là bản đang dùng");
    const total = spentUsd(fast);
    const { job, files } = deleteVersion(fast, "balanced", LATER);
    expect(versions(job)).toEqual(["high", "fast"]);
    expect(files).toEqual(["final-a.mp4"]);
    expect(spentUsd(job)).toBeCloseTo(total);
    expect(levelsToTry(job).map((l) => l.id)).toEqual(["balanced"]);
  });

  it("a version made again after being deleted shows only its own cost", () => {
    const balanced = madeAt("balanced");
    const high = finish(startVersion(balanced, "high", LATER), "b");
    const once = versionCostUsd(high, "high") ?? 0;
    const { job } = deleteVersion(high, "high", LATER);
    expect(versions(job)).toEqual(["balanced"]);
    const again = finish(startVersion(job, "high", LATER), "c");
    expect(versionCostUsd(again, "high")).toBeCloseTo(once);
    expect(versionCostUsd(again, "balanced")).toBeCloseTo(spentUsd(balanced));
    expect(spentUsd(again)).toBeCloseTo(spentUsd(balanced) + 2 * once);
  });

  it("only from a finished video, once per level, never while something renders", () => {
    const job = madeAt("balanced");
    expect(() => startVersion(job, "balanced", LATER)).toThrow("Video đã có bản này");
    const high = startVersion(job, "high", LATER);
    expect(() => startVersion(high, "fast", LATER)).toThrow();
    expect(() => focusVersion(high, "balanced", LATER)).toThrow();
    expect(levelsToTry(job).map((l) => l.id)).toEqual(["fast", "high"]);
  });

  it("a fix acts on the version worked on, and switching makes older proposals stale", () => {
    const high = finish(startVersion(madeAt("balanced"), "high", LATER), "b");
    const fixed = applyFix(high, [{ op: "redo_shot", shot: 0 }], LATER);
    expect(routeOf(fixed, 0)?.endpoint).toBe(OMNI.endpoint);
    expect(costToFinishUsd(fixed)).toBeCloseTo(4 * modelOutput(OMNI).usdPerSec);
    expect(focusVersion(high, "balanced", LATER).rev).toBe((high.rev ?? 0) + 1);
  });

  it("automatic clip redos are counted per video across all versions", () => {
    const job = { ...madeAt("balanced"), autoRedos: 4 };
    const high = startVersion(job, "high", LATER);
    const sent = {
      ...high,
      status: "running" as const,
      shots: high.shots.map((s) =>
        s.index === 0 ? { ...s, state: "rendering" as const, resultUrl: "u", requestId: "r" } : s,
      ),
    };
    expect(rejectClip(sent, 0, "u").shots[0]?.state).toBe("failed");
    const finished = finish(high, "b");
    expect(
      deleteVersion(chooseVersion(finished, "high", LATER), "balanced", LATER).job.autoRedos,
    ).toBe(4);
  });
});

describe("quality of a staged video that has not started", () => {
  it("moves between levels with the same staging in code, without staging again", () => {
    const job = plannedAt("balanced");
    const high = planAtLevel(job, "high");
    expect(high).toMatchObject({ level: "high", model: OMNI.id });
    for (const i of SPEAKING) expect(routeOf(high as VideoJob, i)?.endpoint).toBe(OMNI.endpoint);
    expect(routeOf(high as VideoJob, WIDE)).toEqual(routeOf(job, WIDE));
    expect(high?.plan).toBe(job.plan);
    expect(costToFinishUsd(high as VideoJob)).toBeGreaterThan(costToFinishUsd(job) ?? Number.NaN);
    expect(planAtLevel(job, "fast")).toBeNull();
  });
});

const OLD_LINES: ScriptLine[] = [
  { characterId: "a", speaker: "a", text: "Con chào ông ạ, con mới tới." },
  { characterId: "b", speaker: "b", text: "Ừ, ngồi xuống uống chén trà đã." },
];
const OLD_PLAN: ShotPlan = {
  source: "ai",
  seats: [],
  props: [],
  stateChanges: [],
  shots: OLD_LINES.map((l, i) => ({
    kind: "speaker",
    characterId: l.characterId,
    framing: "medium_close",
    line: i,
    text: l.text,
    visual: "",
    productId: null,
    why: "",
  })),
};

function takesByModel(pastCostUsd = 0.43 + 4.31): VideoJob {
  const base = applyPlan(
    newJob({
      sessionId: "s",
      seriesId: "x",
      scriptId: "1",
      title: "T",
      lines: OLD_LINES,
      useEnvironment: false,
      now: NOW,
    }),
    OLD_PLAN,
  );
  const shots = base.shots.map((s) => ({
    ...s,
    state: "done" as const,
    start: s.index * 3,
    end: s.index * 3 + 3,
    clip: `fabric-${s.index}.mp4`,
    costUsd: 4.31 / 2,
  }));
  const fabricCut = { voiceCostUsd: 0.43, frames: [], shots, final: "final.mp4" };
  const saved: VideoJob = {
    ...base,
    status: "done",
    model: "kling-avatar-v2-pro",
    final: "final-r1.mp4",
    voiceCostUsd: 0,
    shots: shots.map((s) => ({ ...s, clip: `pro-${s.index}.mp4`, costUsd: 3.4 / 2 })),
    pastCostUsd,
    takes: [{ model: "fabric-1-720p", status: "done", cut: fabricCut }],
    chosen: "kling-avatar-v2-pro",
  };
  return withRecordedCharges(saved, workingVersion(saved));
}

describe("versions saved by speaking model before quality levels", () => {
  it("stay readable, switchable and deletable, labelled without a model name", () => {
    const job = takesByModel();
    expect(versions(job)).toEqual(["kling-avatar-v2-pro", "fabric-1-720p"]);
    expect(versions(job).map((v) => versionLabel(job, v))).toEqual(["Bản 1", "Bản 2"]);
    expect(viewVersion(job, "fabric-1-720p").final).toBe("final.mp4");
    expect(levelsToTry(job)).toEqual([]);
    expect(() => startVersion({ ...job, level: "balanced" }, "high", LATER)).toThrow();
    const back = focusVersion(job, "fabric-1-720p", LATER);
    expect(workingVersion(back)).toBe("fabric-1-720p");
    expect(back.final).toBe("final.mp4");
    expect(spentUsd(back)).toBeCloseTo(spentUsd(job));
    expect(deleteVersion(job, "fabric-1-720p", LATER).files.sort()).toEqual([
      "fabric-0.mp4",
      "fabric-1.mp4",
      "final.mp4",
    ]);
  });

  it("their cost per version is rebuilt from their cuts", () => {
    const job = takesByModel();
    expect(spentUsd(job)).toBeCloseTo(8.14);
    expect(versionCostUsd(job, "fabric-1-720p")).toBeCloseTo(0.43 + 4.31);
    expect(versionCostUsd(job, "kling-avatar-v2-pro")).toBeCloseTo(0.43 + 3.4);
    expect(versionCostUsd(takesByModel(6), "fabric-1-720p")).toBeNull();
  });
});

function captioned(job: VideoJob, index: number): VideoJob {
  const url = `https://clips/${index}-${job.shots[index]?.rejectedClips ?? 0}.mp4`;
  const sent: VideoJob = {
    ...job,
    status: "running",
    shots: job.shots.map((s) =>
      s.index === index
        ? {
            ...s,
            state: "rendering",
            endpoint: routeOf(job, index)?.endpoint ?? undefined,
            requestId: `req-${url}`,
            resultUrl: url,
          }
        : s,
    ),
  };
  return settle(rejectClip(sent, index, url));
}

describe("a speaking clip with added lettering", () => {
  it("is made next on the other model from the same picture and audio, at that model's price", () => {
    const before = voicedAt("balanced");
    const j = captioned(before, 0);
    expect(j.shots[0]).toMatchObject({ state: "queued", audio: before.shots[0]?.audio });
    const was = routeOf(before, 0);
    const now = routeOf(j, 0);
    expect(now).toMatchObject({
      route: "lip-sync",
      endpoint: OMNI.endpoint,
      keyframe: was?.keyframe,
    });
    for (const field of ["image_url", "audio_url", "prompt"]) {
      expect(now?.input?.[field]).toBe(was?.input?.[field]);
    }
    expect(j.live?.rates[OMNI.endpoint]?.minSeconds).toBe(OMNI.minSec);
    expect(shotEstimateUsd(j, j.shots[0] as VideoJob["shots"][number])).toBeCloseTo(
      4 * modelOutput(OMNI).usdPerSec,
    );
    for (const i of SPEAKING.slice(1)) expect(routeOf(j, i)?.endpoint).toBe(KLING.endpoint);
  });

  it("goes back to the usual model in a Cao cấp video", () => {
    expect(routeOf(captioned(voicedAt("high"), 0), 0)?.endpoint).toBe(KLING.endpoint);
  });

  it("a moving shot keeps its model and stops at the per-shot limit", () => {
    let j = voicedAt("balanced");
    const motion = routeOf(j, WIDE);
    expect(motion?.route).toBe("motion");
    for (let i = 0; i < MAX_AUTO_REDOS_PER_SHOT; i++) {
      j = captioned(j, WIDE);
      expect(j.shots[WIDE]?.state).toBe("queued");
      expect(routeOf(j, WIDE)).toEqual(motion);
    }
    expect(captioned(j, WIDE).shots[WIDE]?.state).toBe("failed");
  });

  it("an earlier failure with no models recorded is retried on the other model", () => {
    const base = voicedAt("balanced");
    const failed: VideoJob = {
      ...base,
      status: "failed",
      autoRedos: 2,
      shots: base.shots.map((s) =>
        s.index === 0
          ? { ...s, state: "failed", rejectedClips: 5, autoRedos: 2, error: CLIP_NOT_USABLE }
          : s,
      ),
    };
    const j = withUnrecordedSpeakerRejections(JSON.parse(JSON.stringify(failed)) as VideoJob);
    expect(routeOf(j, 0)?.endpoint).toBe(OMNI.endpoint);
    expect(shotEstimateUsd(j, j.shots[0] as VideoJob["shots"][number])).toBeCloseTo(
      4 * modelOutput(OMNI).usdPerSec,
    );
    const resumed = resumeJob(j, LATER);
    expect(resumed.shots[0]?.state).toBe("queued");
    expect(routeOf(resumed, 0)?.endpoint).toBe(OMNI.endpoint);
  });

  it("a version at another level does not go back to the model that added lettering", () => {
    const j = finish(captioned(voicedAt("balanced"), 0), "a");
    const fast = startVersion(j, "fast", LATER);
    expect(routeOf(fast, 0)?.endpoint).toBe(OMNI.endpoint);
    expect(fast.shots[0]?.clip).toBe(j.shots[0]?.clip);
    const high = startVersion(j, "high", LATER);
    expect(high.shots[0]?.clip).toBe(j.shots[0]?.clip);
    expect(versionPriceUsd(j, "high", LATER)).toBeCloseTo(
      (SPEAKING.length - 1) * 4 * modelOutput(OMNI).usdPerSec,
    );
  });
});
