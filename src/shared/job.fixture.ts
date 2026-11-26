import { buildDirection } from "./build-direction";
import { AUTO_MODELS, type JobModels } from "./models";
import { PACE_OF_VIDEOS_MADE_BEFORE_PACES } from "./pace";
import { builtinRecipe } from "./recipe";
import { readShotList, type ShotListAnswer } from "./shot-list";
import { answer, CTX, LINES } from "./shot-list.fixture";
import { applyLivePlan, newJob, type VideoJob, withShotTimes, withSpeech } from "./video-job";
import { voicesNeeded } from "./voice-step";

export const NOW = "2026-11-25T10:00:00.000Z";

export const CAST = [
  { id: "a", name: "An", photos: 3 },
  { id: "b", name: "Ba", photos: 2 },
];

export const MOVING_WIDE = "The leaves stir and the camera pushes in slowly.";

export function withMovingWide(given: ShotListAnswer = answer()): ShotListAnswer {
  return {
    ...given,
    shots: given.shots?.map((s) =>
      s.type === "wide" ? { ...s, route: "motion", motion: MOVING_WIDE } : s,
    ),
  };
}

export function plannedJob(
  models: JobModels = AUTO_MODELS,
  given: ShotListAnswer = withMovingWide(),
): VideoJob {
  const { list, errors } = readShotList(given, CTX, { motion: true, sound: false });
  if (errors.length) throw new Error(errors.join(" "));
  const live = buildDirection({
    list,
    recipe: builtinRecipe(models),
    cast: CAST,
    placePhotos: 3,
    pace: PACE_OF_VIDEOS_MADE_BEFORE_PACES,
  });
  const job = newJob({
    sessionId: "s",
    seriesId: "r",
    scriptId: "x",
    title: "t",
    lines: LINES,
    useEnvironment: true,
    models,
    now: NOW,
  });
  return withVoices(withSpeech(applyLivePlan({ ...job, status: "idle" }, live)));
}

export const withVoices = (job: VideoJob, ready = true): VideoJob => ({
  ...job,
  voices: voicesNeeded(job).map((characterId) => ({
    characterId,
    text: `Giọng của ${characterId}`,
    file: `${characterId}.mp3`,
    ready,
    ...(ready ? {} : { toMake: true as const }),
    retried: false,
  })),
  voicesKept: true,
});

export const running = (job: VideoJob): VideoJob => ({ ...job, status: "running", reviewed: true });

export const withStills = (job: VideoJob): VideoJob => ({
  ...job,
  frames: job.frames.map((f) => ({ ...f, file: `${f.id}.png`, costUsd: 0.1 })),
});

export const spoken = (job: VideoJob): VideoJob => ({
  ...job,
  segments: job.segments?.map((s) => ({
    ...s,
    state: "done" as const,
    model: "wan-3",
    seconds: 4,
    clip: `speech-${s.id}.mp4`,
    clipSec: 4,
    speech: { start: 0.4, end: 2.4 },
    costUsd: 0.18,
  })),
});

export const placed = (job: VideoJob): VideoJob =>
  withShotTimes({ ...job, dialogue: "dialogue.mp3", dialogueSec: 8 }, [
    { start: 0, end: 2, cutFrom: 0.25 },
    { start: 2, end: 3 },
    { start: 3, end: 5, cutFrom: 1.2 },
    { start: 5, end: 6 },
    { start: 6, end: 8, cutFrom: 0.25 },
  ]);

export const finished = (job: VideoJob = plannedJob()): VideoJob => {
  const made = placed(spoken(withStills(job)));
  return {
    ...made,
    status: "done",
    final: "final.mp4",
    shots: made.shots.map((s) => ({ ...s, state: "done" as const, clip: `shot-${s.index}.mp4` })),
  };
};
