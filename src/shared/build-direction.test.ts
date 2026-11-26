import { describe, expect, it } from "vitest";
import { buildDirection } from "./build-direction";
import { costToFinishUsd, costToPreviewUsd } from "./cost/estimate";
import { STILL_USD } from "./cost/rates";
import { AUTO_MODELS } from "./models";
import { PACE_OF_VIDEOS_MADE_BEFORE_PACES } from "./pace";
import {
  CLEAN_FOOTAGE,
  NO_CAPTIONS,
  STILL_BEFORE_SPEAKING,
  STILL_IDENTITY,
  STILL_NO_TEXT,
  speakPrompt,
  stillBeforeSpeakingWith,
  withCleanFrame,
} from "./prompt-text";
import { builtinRecipe, type Recipe } from "./recipe";
import { readShotList, type ShotList } from "./shot-list";
import { answer, CTX, LINES } from "./shot-list.fixture";
import { applyFix, canRestore, FixError, restorePrevious } from "./video-fix";
import {
  applyLivePlan,
  frameDeps,
  frameFor,
  newJob,
  nextActions,
  stopsForPreview,
  type VideoJob,
} from "./video-job";

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

const build = (l: ShotList, recipe: Recipe = builtinRecipe(AUTO_MODELS)) =>
  buildDirection({
    list: l,
    recipe,
    cast: CAST,
    placePhotos: 3,
    pace: PACE_OF_VIDEOS_MADE_BEFORE_PACES,
  });

const MOTION: Recipe["motion"] = {
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
    expect(prompt).not.toContain("Wide shot at eye level.");
    expect(prompt).toContain(STILL_IDENTITY);
    expect(prompt).not.toContain(STILL_BEFORE_SPEAKING);
    expect(prompt.endsWith(STILL_NO_TEXT)).toBe(true);
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
    expect(prompt).toContain(stillBeforeSpeakingWith("Ba"));
    expect(prompt).not.toContain(STILL_BEFORE_SPEAKING);
    expect(ots?.people).toBe(2);
  });

  it("makes a plate with nobody in it from the master alone", () => {
    const plate = build(list()).plan.keyframes.find((k) => k.id === "plate");
    expect(plate?.references).toEqual(["keyframe:master"]);
    expect(String(plate?.input.prompt)).not.toContain(STILL_IDENTITY);
  });

  it("shares capped references so everyone keeps a photo, the place giving way first", () => {
    const recipe = builtinRecipe(AUTO_MODELS);
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
      recipe: builtinRecipe(AUTO_MODELS),
      cast,
      placePhotos: 3,
      pace: PACE_OF_VIDEOS_MADE_BEFORE_PACES,
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
    const recipe = builtinRecipe(AUTO_MODELS);
    recipe.stills.maxReferences = 2;
    expect(() => build(list(), recipe)).toThrow(/needs at least 3 reference images.*takes 2/);
  });

  it("keeps a speaking shot's clause for its speech, and sends no request for it or a local route", () => {
    const live = build(list());
    expect(live.plan.routes.map((r) => [r.route, r.keyframe, Boolean(r.endpoint)])).toEqual([
      ["lip-sync", "an", false],
      ["still-move", "master", false],
      ["lip-sync", "ba-ots", false],
      ["product", "plate", false],
      ["lip-sync", "an", false],
    ]);
    expect(live.plan.routes[0]).toMatchObject({ input: null, motion: "nods slightly" });
  });

  it("makes a listener the director asked to speak a moving shot of them listening", () => {
    const listening = list({ motion: true }, (a) => {
      const s = a.shots?.[1] as Record<string, unknown>;
      Object.assign(s, { type: "listener", character: "An", framing: "close" });
      Object.assign(s, { picture: "an", route: "speak", motion: "glances at the cup" });
    });
    const route = build(listening).plan.routes[1];
    expect(route).toMatchObject({ route: "motion", endpoint: "alibaba/wan-3.0/image-to-video" });
    expect(String(route?.input?.prompt)).toMatch(
      /listens silently.*bamboo leaves stir in a light breeze.*glances at the cup$/,
    );
  });

  it("fits a moving shot's length to its video model", () => {
    const withMotion = list({ motion: true }, (a) => {
      const s = a.shots?.[1] as Record<string, unknown>;
      s.route = "motion";
      s.motion = "Leaves sway; the camera pushes in slowly.";
    });
    const recipe = { ...builtinRecipe(AUTO_MODELS), motion: MOTION };
    const live = build(withMotion, recipe);
    const r = live.plan.routes[1];
    expect(r?.endpoint).toBe(MOTION.endpoint);
    expect(r?.input).toEqual({
      image_url: "{{keyframe}}",
      prompt: "Leaves sway; the camera pushes in slowly.",
      duration: "5",
    });
    expect(live.plan.models.map((m) => m.role)).toEqual(["keyframes", "motion"]);
    const none = build(list(), recipe);
    expect(none.plan.models.map((m) => m.role)).toEqual(["keyframes"]);
    expect(Object.keys(none.rates)).not.toContain(MOTION.endpoint);
  });

  it("throws when a built request breaks the recipe's schema", () => {
    const recipe = builtinRecipe(AUTO_MODELS);
    recipe.stills.input = { ...recipe.stills.input, colour: "warm" };
    expect(() => build(list(), recipe)).toThrow(/has no field "colour"/);
  });

  it("prices the pictures from the recipe's rates", () => {
    const live = build(list());
    expect(live.costs.knownUsd).toBeCloseTo(4 * STILL_USD, 6);
    expect(live.costs.unknownSteps).toBe(0);
    expect(live.connection).toBe("recipe");
    expect(live.recipe).toEqual({ id: "builtin-gpt-image-wan-3", source: "builtin" });
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
      models: AUTO_MODELS,
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
    expect(planned.frames.map((f) => f.people)).toEqual([2, 1, 2, undefined]);
    const voiced = {
      ...planned,
      status: "running" as const,
      dialogue: "d.mp3",
      shots: planned.shots.map((s, i) => ({
        ...s,
        start: i * 3,
        end: i * 3 + 3,
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
      models: AUTO_MODELS,
      now: "2026-11-16T10:00:00.000Z",
    });
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
          models: AUTO_MODELS,
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
        models: AUTO_MODELS,
        now: "2026-11-16T10:00:00.000Z",
      }),
      build(list()),
    );

  it("is the preview, priced to the pause, until voice and stills exist", () => {
    const planned = { ...job(), pause: true };
    expect(stopsForPreview(planned)).toBe(true);
    expect(costToPreviewUsd(planned)).toBeGreaterThan(0);
    expect(costToPreviewUsd(planned)).toBeLessThan(costToFinishUsd(planned) ?? 0);
  });

  it("is the video once the preview is made, never priced at $0", () => {
    const made = {
      ...job(),
      pause: true,
      status: "review" as const,
      dialogue: "dialogue.mp3",
      frames: job().frames.map((f) => ({ ...f, file: `${f.id}.png`, costUsd: STILL_USD })),
    };
    expect(stopsForPreview(made)).toBe(false);
    expect(costToFinishUsd(made)).toBeGreaterThan(0);
  });
});

describe("the clean-frame rule", () => {
  it("is added once to any request with a prompt, never to one without", () => {
    const once = withCleanFrame({ prompt: "Leaves sway." });
    expect(once.prompt).toBe(`Leaves sway. ${CLEAN_FOOTAGE}`);
    expect(withCleanFrame(once)).toEqual(once);
    expect(withCleanFrame({ image_url: "{{keyframe}}" })).toEqual({ image_url: "{{keyframe}}" });
    expect(speakPrompt(false, "steam drifts")).toContain(CLEAN_FOOTAGE);
    expect(speakPrompt(true, undefined)).toContain(CLEAN_FOOTAGE);
  });

  it("never names captions or text to a model that only has a prompt", () => {
    const planned = withCleanFrame({ prompt: `${speakPrompt(false, undefined)} ${NO_CAPTIONS}` });
    expect(planned.prompt).not.toMatch(/caption|subtitle|text|watermark/i);
    expect(speakPrompt(true, "steam drifts", "She nods")).not.toMatch(
      /caption|subtitle|text|watermark/i,
    );
  });

  it("keeps the no-captions sentence for a model with a negative prompt", () => {
    const sent = withCleanFrame({ prompt: "Leaves sway.", negative_prompt: "blur" });
    expect(sent).toEqual({ prompt: `Leaves sway. ${NO_CAPTIONS}`, negative_prompt: "blur" });
    expect(withCleanFrame({ negative_prompt: "blur" })).toEqual({ negative_prompt: "blur" });
  });
});
