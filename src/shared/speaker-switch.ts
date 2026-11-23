import { roleModels, type ShotAtLevel, speakingRoute } from "./build-direction";
import type { LiveDirection, PlannedRoute } from "./live-plan";
import { speakRate } from "./media-level";
import { type RoleModel, speakRole } from "./recipe";
import {
  DEFAULT_VIDEO_MODEL,
  VIDEO_MODELS,
  type VideoModel,
  type VideoModelId,
  videoModel,
} from "./video-models";

export const SPEAKERS_TO_TRY_WHEN_ONE_ADDS_LETTERING: readonly VideoModelId[] = [
  DEFAULT_VIDEO_MODEL,
  "omnihuman-v2",
];

export interface SpeakingShot extends Pick<ShotAtLevel, "kind" | "ambient"> {
  rejectedSpeakers?: readonly string[];
  seconds: number;
}

const speakerAt = (endpoint: string): VideoModel | undefined =>
  (VIDEO_MODELS as readonly VideoModel[]).find((m) => m.endpoint === endpoint);

const takesLength = (model: VideoModel, seconds: number) =>
  model.maxSec === undefined || seconds <= model.maxSec;

export function speakerToTry(
  planned: string,
  rejected: readonly string[],
  seconds: number,
): string | null {
  if (!rejected.includes(planned)) return planned;
  const next = SPEAKERS_TO_TRY_WHEN_ONE_ADDS_LETTERING.map((id) => videoModel(id)).find(
    (m) => !rejected.includes(m.endpoint) && takesLength(m, seconds),
  );
  return next?.endpoint ?? null;
}

export function speakerInsteadOf(
  planned: VideoModel,
  rejected: readonly string[],
  seconds: number,
): VideoModel {
  const endpoint = speakerToTry(planned.endpoint, rejected, seconds);
  return (endpoint && speakerAt(endpoint)) || planned;
}

export function routeAvoidingRejectedSpeakers(
  route: PlannedRoute,
  shot: SpeakingShot,
): { route: PlannedRoute; speaker: RoleModel } | null {
  if (route.route !== "lip-sync" || !route.endpoint) return null;
  const endpoint = speakerToTry(route.endpoint, shot.rejectedSpeakers ?? [], shot.seconds);
  const speaker = endpoint && endpoint !== route.endpoint ? speakerAt(endpoint) : undefined;
  if (!speaker) return null;
  const role = speakRole(speaker, speakRate(speaker));
  return { route: speakingRoute(role, route, shot), speaker: role };
}

export const withSpeakers = (live: LiveDirection, speakers: readonly RoleModel[]) => {
  const models = roleModels(speakers);
  return {
    ...live,
    rates: { ...models.rates, ...live.rates },
    schemas: { ...models.schemas, ...live.schemas },
  };
};

export function liveAvoidingRejectedSpeakers(
  live: LiveDirection,
  index: number,
  shot: SpeakingShot,
): LiveDirection {
  const route = live.plan.routes[index];
  const avoided = route && routeAvoidingRejectedSpeakers(route, shot);
  if (!avoided) return live;
  return {
    ...withSpeakers(live, [avoided.speaker]),
    plan: {
      ...live.plan,
      routes: live.plan.routes.map((r, i) => (i === index ? avoided.route : r)),
    },
  };
}
