import { describe, expect, it } from "vitest";
import { estimateVoiceUsd } from "./board";
import { buildDirection } from "./build-direction";
import { plannedShotSec } from "./live-plan";
import { mediaLevel } from "./media-level";
import {
  NO_CAPTIONS,
  STILL_BEFORE_SPEAKING,
  STILL_IDENTITY,
  STILL_NO_TEXT,
  speakPrompt,
  stillBeforeSpeakingWith,
  withNoCaptions,
} from "./prompt-text";
import { builtinRecipe, type Recipe } from "./recipe";
import { readShotList, type ShotList } from "./shot-list";
import { answer, CTX, LINES } from "./shot-list.fixture";
import { applyFix, canRestore, FixError, restorePrevious } from "./video-fix";
import {
  applyLivePlan,
  costToFinishUsd,
  costToPreviewUsd,
  frameDeps,
  frameFor,
  newJob,
  nextActions,
  stopsForPreview,
  type VideoJob,
} from "./video-job";
import { startTake } from "./video-takes";

const level = mediaLevel("balanced");
const CAST = [
  { id: "a", name: "An", photos: 3 },
  { id: "b", name: "Ba", photos: 2 },
];

function list(caps = { motion: false }, edit?: (a: ReturnType<typeof answer>) => void): ShotList {
  const a = answer();
  edit?.(a);
  const { list, errors } = readShotList(a, CTX, caps);
  expect(errors).toEqual([]);
  return list;
}

const build = (l: ShotList, recipe: Recipe = builtinRecipe(level)) =>
  buildDirection({ list: l, recipe, lines: LINES, level, cast: CAST, placePhotos: 3 });

const MOTION: NonNullable<Recipe["motion"]> = {
  endpoint: "maker/image-to-video",
  name: "Motion One",
  input: { image_url: "{{keyframe}}", prompt: "{{prompt}}", duration: "5" },
  rate: { usd: 0.1, unit: "seconds" },
  schema: {
    endpoint: "maker/image-to-video",
    name: "Motion One",
    category: "image-to-video",
    params: [
      { name: "image_url", type: "string", required: true },
      { name: "prompt", type: "string", required: true },
      { name: "duration", type: "string", required: false, enum: ["5", "10"] },
    ],
    outputs: ["video"],
  },
};

describe("buildDirection", () => {
  it("makes the master from the place, then everyone in cast order", () => {
    const live = build(list());
    const master = live.plan.keyframes[0];
    expect(master?.references).toEqual([
      "place-1",
      "place-2",
      "cast1-1",
      "cast1-2",
      "cast1-3",
      "cast2-1",
      "cast2-2",
    ]);
    expect(master?.input.image_urls).toEqual(master?.references.map((r) => `{{${r}}}`));
    const prompt = String(master?.input.prompt);
    expect(
      prompt.startsWith("Images 1-2 are the place. Images 3-5 are An. Images 6-7 are Ba."),
    ).toBe(true);
    expect(prompt).toContain("Make a vertical 9:16 photograph. An and Ba sit");
    // The framing field repeats the description's opening: never sent twice.
    expect(prompt).not.toContain("Wide shot at eye level.");
    expect(prompt).toContain(STILL_IDENTITY);
    expect(prompt).not.toContain(STILL_BEFORE_SPEAKING);
    expect(prompt.endsWith(STILL_NO_TEXT)).toBe(true);
    // The rest of the template is the fixed pipeline's request.
    expect(master?.input).toMatchObject({ image_size: "portrait_16_9", quality: "high" });
  });

  it("makes an over-the-shoulder picture from the master, the main person, then the other", () => {
    const live = build(list());
    const ots = live.plan.keyframes.find((k) => k.id === "ba-ots");
    expect(ots?.references).toEqual([
      "keyframe:master",
      "cast2-1",
      "cast2-2",
      "cast1-1",
      "cast1-2",
    ]);
    const prompt = String(ots?.input.prompt);
    expect(prompt).toMatch(
      /^Image 1 is the master scene\. Images 2-3 are Ba\. Images 4-5 are An\./,
    );
    // A speak shot starts from it, and two people share it: only Ba speaks.
    expect(prompt).toContain(stillBeforeSpeakingWith("Ba"));
    expect(prompt).not.toContain(STILL_BEFORE_SPEAKING);
    // The still check expects the two people it lists.
    expect(ots?.people).toBe(2);
  });

  it("makes a plate with nobody in it from the master alone", () => {
    const plate = build(list()).plan.keyframes.find((k) => k.id === "plate");
    expect(plate?.references).toEqual(["keyframe:master"]);
    expect(String(plate?.input.prompt)).not.toContain(STILL_IDENTITY);
  });

  it("shares capped references so everyone keeps a photo, the place giving way first", () => {
    const recipe = builtinRecipe(level);
    recipe.stills.maxReferences = 4;
    const master = build(list(), recipe).plan.keyframes[0];
    expect(master?.references).toEqual(["place-1", "cast1-1", "cast1-2", "cast2-1"]);
    expect(String(master?.input.prompt)).toMatch(
      /^Image 1 is the place\. Images 2-3 are An\. Image 4 is Ba\./,
    );
  });

  it("keeps a photo of every cast member in the master of a cast of three", () => {
    const cast = [...CAST, { id: "c", name: "Cô", photos: 3 }];
    const master = buildDirection({
      list: list(),
      recipe: builtinRecipe(level),
      lines: LINES,
      level,
      cast,
      placePhotos: 3,
    }).plan.keyframes[0];
    expect(master?.references).toEqual([
      "place-1",
      "place-2",
      "cast1-1",
      "cast1-2",
      "cast2-1",
      "cast2-2",
      "cast3-1",
      "cast3-2",
    ]);
  });

  it("refuses a picture with more people than the image model takes references", () => {
    const recipe = builtinRecipe(level);
    recipe.stills.maxReferences = 2;
    expect(() => build(list(), recipe)).toThrow(/needs at least 3 reference images.*takes 2/);
  });

  it("asks speaking shots with the seat's ambient and the shot's clause, local routes with nothing", () => {
    const live = build(list());
    expect(live.plan.routes.map((r) => [r.route, r.keyframe, Boolean(r.endpoint)])).toEqual([
      ["lip-sync", "an", true],
      ["still-move", "master", false],
      ["lip-sync", "ba-ots", true],
      ["product", "plate", false],
      ["lip-sync", "an", true],
    ]);
    const first = live.plan.routes[0]?.input;
    expect(first).toMatchObject({ image_url: "{{keyframe}}", audio_url: "{{audio}}" });
    expect(String(first?.prompt)).toMatch(
      /speaks naturally.*bamboo leaves stir in a light breeze.*nods slightly$/,
    );
  });

  it("has no motion without a motion model, and fits the length when there is one", () => {
    const withMotion = list({ motion: true }, (a) => {
      const s = a.shots?.[1] as Record<string, unknown>;
      s.route = "motion";
      s.motion = "Leaves sway; the camera pushes in slowly.";
    });
    expect(() => build(withMotion, { ...builtinRecipe(level), motion: null })).toThrow(
      /no motion model/,
    );
    const recipe = { ...builtinRecipe(level), motion: MOTION };
    const live = build(withMotion, recipe);
    const r = live.plan.routes[1];
    expect(r?.endpoint).toBe(MOTION.endpoint);
    expect(r?.input).toEqual({
      image_url: "{{keyframe}}",
      prompt: "Leaves sway; the camera pushes in slowly.",
      duration: "5",
    });
    expect(live.plan.models.map((m) => m.role)).toEqual(["keyframes", "lip-sync", "motion"]);
    // Without motion shots the motion model is neither listed nor priced.
    const none = build(list(), recipe);
    expect(none.plan.models.map((m) => m.role)).toEqual(["keyframes", "lip-sync"]);
    expect(Object.keys(none.rates)).not.toContain(MOTION.endpoint);
  });

  it("throws when a built request breaks the recipe's schema", () => {
    const recipe = builtinRecipe(level);
    recipe.stills.input = { ...recipe.stills.input, colour: "warm" };
    expect(() => build(list(), recipe)).toThrow(/has no field "colour"/);
  });

  it("prices every step from the recipe's rates", () => {
    const live = build(list());
    const speak = builtinRecipe(level).speak.rate.usd as number;
    const shots = list().shots.shots;
    const lips = [0, 2, 4].reduce(
      (n, i) => n + Math.max(2, plannedShotSec(shots[i] as never)) * speak,
      0,
    );
    expect(live.costs.knownUsd).toBeCloseTo(estimateVoiceUsd(LINES) + 4 * 0.12 + lips, 6);
    expect(live.costs.unknownSteps).toBe(0);
    expect(live.connection).toBe("recipe");
    expect(live.recipe).toEqual({ id: "builtin", source: "builtin" });
    expect(live.costs.rows.find((r) => r.step === "Khung hình master")?.model).toBe(
      "GPT Image 2.6",
    );
  });

  it("goes into a job as keyframe stills made after the master", () => {
    const job = newJob({
      sessionId: "s",
      seriesId: "r",
      scriptId: "x",
      title: "t",
      lines: LINES,
      useEnvironment: true,
      now: "2026-11-16T10:00:00.000Z",
    });
    const planned = applyLivePlan(job, build(list()));
    expect(planned.frames.map((f) => [f.id, f.kind])).toEqual([
      ["kf:master", "wide"],
      ["kf:an", "character"],
      ["kf:ba-ots", "character"],
      ["kf:plate", "product"],
    ]);
    for (const f of planned.frames.slice(1)) expect(frameDeps(planned, f)).toEqual(["kf:master"]);
    expect(frameDeps(planned, planned.frames[0] as never)).toEqual([]);
    expect(planned.frames[3]?.productId).toBe("p");
    // Each still knows how many people its picture lists, for the still check.
    expect(planned.frames.map((f) => f.people)).toEqual([2, 1, 2, undefined]);
    // Voice done: the master first, then every other picture.
    const voiced = {
      ...planned,
      status: "running" as const,
      dialogue: "d.mp3",
      shots: planned.shots.map((s, i) => ({
        ...s,
        start: i * 3,
        end: i * 3 + 3,
        ...(s.route === "lip-sync" ? { audio: `a${i}.mp3`, audioSec: 2.4 } : {}),
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
      "kf:ba-ots",
      "kf:plate",
    ]);
  });
});

describe("a fix on a planned video", () => {
  const planned = () => {
    const job = newJob({
      sessionId: "s",
      seriesId: "r",
      scriptId: "x",
      title: "t",
      lines: LINES,
      useEnvironment: true,
      now: "2026-11-16T10:00:00.000Z",
    });
    // At "Nghe và xem cảnh chính", where #3 was fixed from the chat.
    return { ...applyLivePlan(job, build(list())), status: "review" as const };
  };

  const ba = (text: string) => ({
    kind: "speaker",
    characterId: "b",
    framing: "medium_close",
    line: 1,
    text,
    visual: "Ba smiles.",
  });

  it("starts new shots from the plan's pictures, never a still of its own", () => {
    const job = planned();
    // Line 2 was a wide then Ba: now Ba speaks first, then the wide.
    const fixed = applyFix(
      job,
      [
        {
          op: "replace_line",
          line: 1,
          shots: [
            ba("Ừ cháu ngồi đây,"),
            { kind: "wide", line: 1, text: "uống chén trà đã cháu.", visual: "The courtyard." },
          ] as never,
        },
      ],
      "2026-11-16T11:00:00.000Z",
    );
    expect(fixed.shots[1]?.keyframe).toBe("ba-ots");
    expect(fixed.shots[2]?.keyframe).toBe("master");
    expect(frameFor(fixed, fixed.shots[2] as never)?.id).toBe("kf:master");
    expect(fixed.frames.every((f) => f.id.startsWith("kf:"))).toBe(true);
    const routes = fixed.live?.plan.routes ?? [];
    expect(routes[1]?.route).toBe("lip-sync");
    expect(routes[1]?.endpoint).toBe(job.live?.plan.routes[2]?.endpoint);
    expect(routes[2]).toMatchObject({ route: "still-move", keyframe: "master", endpoint: null });
  });

  it("keeps each later shot's route when a fix changes the number of shots", () => {
    const job = planned();
    // Line 2's two shots become one: the product shot moves from 4th to 3rd.
    const fixed = applyFix(
      job,
      [
        {
          op: "replace_line",
          line: 1,
          shots: [ba("Ừ cháu ngồi đây, uống chén trà đã cháu.")] as never,
        },
      ],
      "2026-11-16T11:00:00.000Z",
    );
    const routes = fixed.live?.plan.routes ?? [];
    expect(routes).toHaveLength(fixed.shots.length);
    expect(fixed.shots[2]?.productId).toBe("p");
    expect(routes[2]).toEqual(job.live?.plan.routes[3]);
  });

  const finished = () => ({ ...planned(), status: "done" as const, final: "f.mp4" });
  const oneShotLine = [
    {
      op: "replace_line" as const,
      line: 1,
      shots: [ba("Ừ cháu ngồi đây, uống chén trà đã cháu.")] as never,
    },
  ];
  const LATER = "2026-11-16T11:00:00.000Z";

  it("going back to the cut before a fix brings back that cut's routes", () => {
    const job = finished();
    const fixed = { ...applyFix(job, oneShotLine, LATER), status: "done" as const, final: "g.mp4" };
    const back = restorePrevious(fixed, LATER);
    expect(back.shots).toHaveLength(job.shots.length);
    expect(back.live?.plan.routes).toEqual(job.live?.plan.routes);
    expect(restorePrevious(back, LATER).live?.plan.routes).toEqual(fixed.live?.plan.routes);
  });

  it("a cut saved without routes comes back only when its shots line up with the routes", () => {
    const job = finished();
    const legacy = (j: VideoJob) => {
      const { routes: _, ...cut } = j.previous ?? { frames: [], shots: [] };
      return { ...j, status: "done" as const, final: "g.mp4", previous: cut };
    };
    const reshaped = legacy(applyFix(job, oneShotLine, LATER));
    expect(canRestore(reshaped)).toBe(false);
    expect(() => restorePrevious(reshaped, LATER)).toThrow(FixError);
    const sameShape = legacy(applyFix(job, [{ op: "redo_shot", shot: 0 }], LATER));
    expect(restorePrevious(sameShape, LATER).live?.plan.routes).toEqual(job.live?.plan.routes);
  });

  it("is never made again as a take with another speaking model", () => {
    expect(() => startTake(finished(), "omnihuman-v2", LATER)).toThrow(FixError);
  });

  it("keeps the still of a kept shot that starts from an action picture", () => {
    const job = {
      ...applyLivePlan(
        newJob({
          sessionId: "s",
          seriesId: "r",
          scriptId: "x",
          title: "t",
          lines: LINES,
          useEnvironment: true,
          now: "2026-11-16T10:00:00.000Z",
        }),
        build(
          list(undefined, (a) => {
            a.pictures?.push({
              id: "pour",
              kind: "action",
              character: null,
              people: ["An"],
              framing: "close",
              description: "An listens, hands around a cup.",
            });
            const shots = a.shots ?? [];
            shots[1] = {
              ...shots[1],
              type: "listener",
              character: "An",
              framing: "close",
              picture: "pour",
            } as never;
          }),
        ),
      ),
      status: "review" as const,
    };
    const made = {
      ...job,
      frames: job.frames.map((f) => (f.id === "kf:pour" ? { ...f, file: "pour.png" } : f)),
    };
    const fixed = applyFix(
      made,
      [
        {
          op: "replace_line",
          line: 2,
          shots: [
            {
              kind: "speaker",
              characterId: "a",
              framing: "close",
              line: 2,
              text: "Dạ cháu cảm ơn, ông pha trà ngon lắm ạ.",
              visual: "An grins.",
              hold: 1,
            },
          ] as never,
        },
      ],
      LATER,
    );
    expect(fixed.shots[1]?.keyframe).toBe("pour");
    expect(frameFor(fixed, fixed.shots[1] as never)).toMatchObject({
      id: "kf:pour",
      file: "pour.png",
    });
  });
});

describe("what the next hold makes", () => {
  const job = () =>
    applyLivePlan(
      newJob({
        sessionId: "s",
        seriesId: "r",
        scriptId: "x",
        title: "t",
        lines: LINES,
        useEnvironment: true,
        now: "2026-11-16T10:00:00.000Z",
      }),
      build(list()),
    );

  it("is the preview, priced to the pause, until voice and stills exist", () => {
    const planned = { ...job(), pause: true };
    expect(stopsForPreview(planned)).toBe(true);
    expect(costToPreviewUsd(planned)).toBeGreaterThan(0);
    expect(costToPreviewUsd(planned)).toBeLessThan(costToFinishUsd(planned));
  });

  it("is the video once the preview is made, never priced at $0", () => {
    const made = {
      ...job(),
      pause: true,
      status: "review" as const,
      dialogue: "dialogue.mp3",
      frames: job().frames.map((f) => ({ ...f, file: `${f.id}.png`, costUsd: 0.12 })),
    };
    expect(stopsForPreview(made)).toBe(false);
    expect(costToFinishUsd(made)).toBeGreaterThan(0);
  });
});

describe("the no-text rule", () => {
  it("is added once to any request with a prompt, never to one without", () => {
    const once = withNoCaptions({ prompt: "Leaves sway." });
    expect(once.prompt).toBe(`Leaves sway. ${NO_CAPTIONS}`);
    expect(withNoCaptions(once)).toEqual(once);
    expect(withNoCaptions({ image_url: "{{keyframe}}" })).toEqual({ image_url: "{{keyframe}}" });
    // Speaking and listening sentences already carry it.
    expect(speakPrompt(false, "steam drifts")).toContain(NO_CAPTIONS);
    expect(speakPrompt(true, undefined)).toContain(NO_CAPTIONS);
  });
});
