import { describe, expect, it } from "vitest";
import { buildDirection } from "./build-direction";
import { redoneCharges, spentUsd } from "./cost/charges";
import { withInUsePaid } from "./cost/charges.fixture";
import { costToFinishUsd } from "./cost/estimate";
import { plannedShotSec } from "./live-plan";
import { levelRates, mediaLevel } from "./media-level";
import { builtinRecipe } from "./recipe";
import { reconcileJob } from "./request-reconcile";
import { readShotList, type ShotListAnswer } from "./shot-list";
import { answer, CTX, LINES } from "./shot-list.fixture";
import {
  type AudioLayer,
  type JobSound,
  MAX_SOUND_ATTEMPTS,
  MIX,
  mixGraph,
  placeLayers,
  type SoundSource,
  soundAttemptFailed,
} from "./sound";
import {
  applyLivePlan,
  newJob,
  nextActions,
  settle,
  stepReportedFailure,
  type VideoJob,
  withJobSounds,
} from "./video-job";
import { videoModel } from "./video-models";

const CAST = [
  { id: "a", name: "An", photos: 3 },
  { id: "b", name: "Ba", photos: 2 },
];

function withSounds(a: ShotListAnswer): ShotListAnswer {
  a.ambience = "quiet courtyard, distant birdsong, faint breeze";
  const shots = a.shots ?? [];
  (shots[1] as { sound?: string | null }).sound = "porcelain cup set down on a wooden table";
  (shots[0] as { sound?: string | null }).sound = "a chair scraping";
  (shots[3] as { sound?: string | null }).sound = "soft music playing";
  return a;
}

const read = (a: ShotListAnswer, sound: boolean) => {
  const { list, errors } = readShotList(a, CTX, { motion: false, sound });
  expect(errors).toEqual([]);
  return list;
};

function plannedJob(levelId: string, a: ShotListAnswer = withSounds(answer())): VideoJob {
  const level = mediaLevel(levelId);
  const live = buildDirection({
    list: read(a, level.sound),
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
    now: "2026-11-19T10:00:00.000Z",
  });
  return { ...applyLivePlan(job, live), level: level.id };
}

function voiced(job: VideoJob): VideoJob {
  return withJobSounds({
    ...job,
    status: "running",
    dialogue: "dialogue.mp3",
    dialogueSec: 14,
    frames: job.frames.map((f) => ({ ...f, file: `${f.id}.png` })),
    shots: job.shots.map((s, i) => ({
      ...s,
      start: i * 3,
      end: i * 3 + 3,
      state: "done" as const,
      clip: `shot-${i}.mp4`,
      audio: `audio-${i}.mp3`,
      audioSec: 3,
    })),
  });
}

describe("planned sound", () => {
  it("keeps one ambience and the sounds of shots that do not speak, never music", () => {
    const plan = read(withSounds(answer()), true).shots;
    expect(plan.ambience).toBe("quiet courtyard, distant birdsong, faint breeze");
    expect(plan.shots.map((s) => s.sound ?? null)).toEqual([
      null,
      "porcelain cup set down on a wooden table",
      null,
      null,
      null,
    ]);
  });

  it("keeps the leading parts of an ambience that runs over the word limit", () => {
    const long =
      "quiet tea room at midday, faint air-conditioner hum, soft distant street sound through the window, faint curtain rustle";
    const plan = read({ ...withSounds(answer()), ambience: long }, true).shots;
    expect(plan.ambience).toBe(
      "quiet tea room at midday, faint air-conditioner hum, soft distant street sound through the window",
    );
  });

  it("is left out entirely when the level has no sound", () => {
    const plan = read(withSounds(answer()), false).shots;
    expect(plan.ambience).toBeUndefined();
    expect(plan.shots.some((s) => s.sound)).toBe(false);
  });

  it("a plan without sound fields stays valid and makes no sound steps", () => {
    const job = voiced(plannedJob("balanced", answer()));
    expect(job.sounds).toBeUndefined();
    expect(nextActions(job, new Set())).toEqual([{ kind: "assemble" }]);
  });
});

describe("the high level", () => {
  it("lip-syncs with its own model and prices short speaking shots at that model's minimum", () => {
    const high = plannedJob("high");
    const live = high.live;
    if (!live) throw new Error("no live plan");
    const speaker = videoModel(mediaLevel("high").speaker);
    const lips = live.plan.routes.filter((r) => r.route === "lip-sync");
    expect(lips.every((r) => r.endpoint === speaker.endpoint)).toBe(true);
    const rate = levelRates(mediaLevel("high")).speak;
    const expected = [0, 2, 4].reduce(
      (n, i) =>
        n +
        Math.max(rate.minSeconds ?? 0, plannedShotSec(live.plan.shots.shots[i] as never)) *
          (rate.usd ?? 0),
      0,
    );
    const priced = live.costs.rows
      .filter((r) => r.step.endsWith("· Nói"))
      .reduce((n, r) => n + (r.usd ?? 0), 0);
    expect(priced).toBeCloseTo(expected);
    expect(live.costs.rows.filter((r) => r.step.endsWith("· Nói")).map((r) => r.quantity)).toEqual([
      "4 giây",
      "4 giây",
      "4 giây",
    ]);
  });
});

describe("sound steps", () => {
  it("are priced before the hold and counted once paid", () => {
    const balanced = plannedJob("balanced");
    const silent = plannedJob("balanced", answer());
    expect(
      (costToFinishUsd(balanced) ?? Number.NaN) - (costToFinishUsd(silent) ?? Number.NaN),
    ).toBeGreaterThan(0.01);
    const made = withInUsePaid(voiced(balanced));
    const paid: VideoJob = withInUsePaid({
      ...made,
      sounds: made.sounds?.map((s) => ({ ...s, file: `${s.id}.mp3`, costUsd: 0.01 })),
    });
    expect(spentUsd(paid) - spentUsd(made)).toBeCloseTo(0.02);
  });

  it("asks each sound once: never again while sending, sent or after a restart", () => {
    const job = voiced(plannedJob("balanced"));
    expect(job.sounds?.map((s) => [s.id, s.seconds, s.loop])).toEqual([
      ["ambience", 15, true],
      ["spot:1", 3, false],
    ]);
    const submits = (j: VideoJob, busy = new Set<string>()) =>
      nextActions(j, busy).filter((a) => a.kind === "submit-sound");
    expect(submits(job)).toHaveLength(2);
    expect(submits(job, new Set(["sound:ambience"]))).toHaveLength(1);
    const sent = {
      ...job,
      sounds: job.sounds?.map((s) =>
        s.id === "ambience" ? { ...s, requestId: "r1", submittedAt: "t" } : s,
      ),
    };
    expect(submits(sent).map((a) => a.kind === "submit-sound" && a.sound)).toEqual(["spot:1"]);
    expect(nextActions(sent, new Set())).toContainEqual({ kind: "poll-sound", sound: "ambience" });

    const crashedWhileSending = {
      ...job,
      sounds: job.sounds?.map((s) => (s.id === "ambience" ? { ...s, sending: "att" } : s)),
    };
    const { job: back } = reconcileJob(crashedWhileSending, [
      {
        at: "2026-11-19T10:01:00.000Z",
        requestId: "r9",
        provider: "fal",
        endpoint: "e",
        purpose: "video-sound",
        sessionId: "s",
        scriptId: "x",
        sound: "ambience",
        attempt: "att",
      },
    ]);
    const ambience = back.sounds?.find((s) => s.id === "ambience");
    expect(ambience).toMatchObject({ requestId: "r9" });
    expect(ambience?.sending).toBeUndefined();
    expect(submits(back).map((a) => a.kind === "submit-sound" && a.sound)).toEqual(["spot:1"]);
  });

  it("retries a failed sound once, then the video is assembled without it", () => {
    const job = voiced(plannedJob("balanced"));
    const assembles = (j: VideoJob) => nextActions(j, new Set()).some((a) => a.kind === "assemble");
    expect(assembles(job)).toBe(false);
    let failing = job;
    for (let i = 0; i < MAX_SOUND_ATTEMPTS; i++) {
      failing = settle(stepReportedFailure(failing, { sound: "ambience" }, "boom"));
      expect(failing.status).toBe("running");
    }
    const ambience = failing.sounds?.find((s) => s.id === "ambience");
    expect(ambience).toMatchObject({ dropped: true, attempts: MAX_SOUND_ATTEMPTS });
    const sendsAgain = (j: VideoJob) =>
      nextActions(j, new Set()).some((a) => a.kind === "submit-sound" && a.sound === "ambience");
    expect(sendsAgain(failing)).toBe(false);
    const spotMade = {
      ...failing,
      sounds: failing.sounds?.map((s) => (s.id === "spot:1" ? { ...s, file: "spot.mp3" } : s)),
    };
    expect(assembles(spotMade)).toBe(true);
  });

  it("a sound that failed once is sent again, as its one retry", () => {
    const sound: JobSound = {
      id: "ambience",
      role: "ambience",
      text: "room",
      seconds: 10,
      loop: true,
      attempts: 0,
      requestId: "r1",
    };
    const once = soundAttemptFailed(sound, "x");
    expect(once).toMatchObject({ attempts: 1, requestId: undefined });
    expect(once.dropped).toBeUndefined();
    expect(soundAttemptFailed(once, "x").dropped).toBe(true);
  });

  it("are not asked again when the shot times move but the sound stays the same", () => {
    const job = voiced(plannedJob("balanced"));
    const made = withInUsePaid({
      ...job,
      sounds: job.sounds?.map((s) => ({ ...s, file: `${s.id}.mp3`, costUsd: 0.01 })),
    });
    const again = withJobSounds({
      ...made,
      dialogueSec: 20,
      shots: made.shots.map((s) => ({ ...s, start: (s.start ?? 0) + 1, end: (s.end ?? 0) + 1 })),
    });
    expect(again.sounds?.every((s) => s.file)).toBe(true);
    expect(redoneCharges(again)).toEqual([]);
  });

  it("a sound asked differently is made again and the one discarded counts as redone", () => {
    const job = voiced(plannedJob("balanced"));
    const made = withInUsePaid({
      ...job,
      sounds: job.sounds?.map((s) => ({ ...s, file: `${s.id}.mp3`, costUsd: 0.01 })),
    });
    const plan = made.plan as NonNullable<VideoJob["plan"]>;
    const changed = withJobSounds({ ...made, plan: { ...plan, ambience: "rain on a tin roof" } });
    expect(changed.sounds?.find((s) => s.id === "ambience")?.file).toBeUndefined();
    expect(spentUsd(changed)).toBeCloseTo(spentUsd(made));
    expect(redoneCharges(changed).map((c) => c.step)).toEqual(["sound:ambience"]);
  });
});

describe("layer placement", () => {
  const ambience: AudioLayer = {
    kind: "file",
    file: "a.mp3",
    fileSec: 15,
    role: "ambience",
    start: 0,
    length: 40,
  };
  const spot: AudioLayer = {
    kind: "file",
    file: "s.mp3",
    fileSec: 3.2,
    role: "spot",
    start: 6.5,
    length: 2.4,
  };

  it("loops a short ambience under the whole video, faded in and out, well below the voice", () => {
    const [placed] = placeLayers([ambience], 40);
    expect(placed).toMatchObject({ start: 0, length: 40, loop: true, fadeIn: 1, fadeOut: 1.5 });
    expect(placed?.gainDb).toBeLessThan(-15);
    expect(placeLayers([{ ...ambience, fileSec: 41 }], 40)[0]?.loop).toBe(false);
  });

  it("starts a spot sound with its shot and stops it at the shot's end or the video's end", () => {
    expect(placeLayers([spot], 40)[0]).toMatchObject({ start: 6.5, length: 2.4, loop: false });
    expect(placeLayers([{ ...spot, length: 9 }], 40)[0]?.length).toBe(3.2);
    expect(placeLayers([spot], 7.5)[0]?.length).toBe(1);
    expect(placeLayers([spot], 6.5)).toEqual([]);
    const gain = (l: AudioLayer) => placeLayers([l], 40)[0]?.gainDb ?? 0;
    expect(gain(spot)).toBeGreaterThan(gain(ambience));
    expect(gain(spot)).toBeLessThan(0);
  });

  it("mixes layers a source made as files and layers kept from a clip's own sound", () => {
    const clipsOwnSound: SoundSource = {
      id: "clips-own-sound",
      usdPerSec: 0,
      asks: () => [],
      layers: (cues) =>
        cues.flatMap((c): AudioLayer[] =>
          c.shot === undefined
            ? []
            : [{ kind: "clip", shot: c.shot, role: c.role, start: c.start, length: c.length }],
        ),
    };
    const cues = [
      { id: "ambience", role: "ambience" as const, text: "room", start: 0, length: 20 },
      { id: "spot:2", role: "spot" as const, text: "cup", start: 6, length: 3, shot: 2 },
    ];
    expect(clipsOwnSound.asks(cues)).toEqual([]);
    const layers = [ambience, ...clipsOwnSound.layers(cues, [])];
    const placed = placeLayers(layers, 20);
    expect(placed.map((p) => p.layer.kind)).toEqual(["file", "clip"]);
    const { filter, loops } = mixGraph(
      -24,
      placed.map((p) => ({ placed: p, measuredLufs: -30 })),
      20,
    );
    expect(loops).toEqual([true, false]);
    expect(filter).toContain("[2:a]");
    expect(filter).toContain("adelay=6000|6000");
    expect(filter).toContain("sidechaincompress");
    expect(filter).toMatch(/\[voice\]\[ducked\]amix=inputs=2/);
  });

  it("with no layers the voice alone is levelled and padded to the video's length", () => {
    const { filter, loops } = mixGraph(-26, [], 12.5);
    expect(loops).toEqual([]);
    expect(filter).toContain(`volume=${(MIX.voiceLufs + 26).toFixed(2)}dB`);
    expect(filter).toContain("apad=whole_dur=12.500,atrim=0:12.500[mix]");
  });
});
