import { MASTER_PLACE_PHOTOS, PHOTOS_OFFERED_PER_PERSON } from "./build-direction";
import type { Series } from "./ipc";
import type { Picture } from "./shot-list";
import { type FrameKind, frameFor, type JobFrame, type JobShot, type VideoJob } from "./video-job";

export type MaterialKind = "picture" | "clip";

export type MaterialRole = "scene" | "character" | "detail";

export interface MadeFrom {
  assetId: string;
  imageIds: string[];
}

export interface MaterialUse {
  sessionId: string;
  scriptId: string;
  at: string;
}

export interface MaterialSource {
  sessionId: string;
  scriptId: string;
  file: string;
  title: string;
  at: string;
}

export interface SceneSeat {
  characterId: string;
  side: string;
  looks: string;
  behind: string;
  ambient?: string;
}

export interface SceneSetup {
  seats: SceneSeat[];
  props: { name: string; where: string }[];
}

export interface MaterialItem {
  id: string;
  kind: MaterialKind;
  role: MaterialRole;
  file: string;
  pictureId?: string;
  seconds?: number;
  motion?: string;
  resolution?: string;
  framing: string;
  description: string;
  caption: string;
  people: string[];
  sceneId?: string;
  scene?: SceneSetup;
  madeFrom: MadeFrom[];
  level: string;
  costUsd: number | null;
  source: MaterialSource;
  kept: boolean;
  reusable: boolean;
  uses: MaterialUse[];
}

export interface SeriesMaterial {
  version: 1;
  items: MaterialItem[];
}

export type MaterialState = "current" | "outdated" | "off";

export interface AssetPhotos {
  id: string;
  images: readonly { id: string }[];
}

export function materialState(item: MaterialItem, assets: readonly AssetPhotos[]): MaterialState {
  const everyPhotoItWasMadeFromIsStillThere = item.madeFrom.every((from) => {
    const asset = assets.find((a) => a.id === from.assetId);
    return (
      asset !== undefined && from.imageIds.every((id) => asset.images.some((i) => i.id === id))
    );
  });
  if (!everyPhotoItWasMadeFromIsStillThere) return "outdated";
  return item.reusable ? "current" : "off";
}

export const canBeReused = (item: MaterialItem, assets: readonly AssetPhotos[]) =>
  materialState(item, assets) === "current";

type DraftOf<T> = Omit<T, "id" | "file" | "kept" | "reusable" | "uses" | "pictureId">;

export type PictureDraft = DraftOf<MaterialItem> & { kind: "picture"; key?: string };

export type ClipDraft = DraftOf<MaterialItem> & { kind: "clip"; picture: PictureDraft };

export type MaterialDraft = PictureDraft | ClipDraft;

const ROLE_OF_FRAME: Partial<Record<FrameKind, MaterialRole>> = {
  wide: "scene",
  character: "character",
  detail: "detail",
};

export const reuseOn = (series: Pick<Series, "reuseMaterial"> | undefined) =>
  series?.reuseMaterial !== false;

export const finishedVideo = (job: Pick<VideoJob, "status" | "final">) =>
  job.status === "done" && Boolean(job.final);

const firstImageIds = (asset: AssetPhotos, count: number) =>
  asset.images.slice(0, count).map((i) => i.id);

function madeFromOf(
  people: readonly string[],
  place: AssetPhotos | undefined,
  assets: readonly AssetPhotos[],
): MadeFrom[] {
  const cast = people
    .map((id) => assets.find((a) => a.id === id))
    .filter((a): a is AssetPhotos => a !== undefined)
    .map((a) => ({ assetId: a.id, imageIds: firstImageIds(a, PHOTOS_OFFERED_PER_PERSON) }));
  const setting = place
    ? [{ assetId: place.id, imageIds: firstImageIds(place, MASTER_PLACE_PHOTOS) }]
    : [];
  return [...cast, ...setting];
}

const capturedFrame = (frame: JobFrame) =>
  Boolean(frame.file) &&
  frame.source === "generated" &&
  !frame.check &&
  Boolean(frame.keyframe) &&
  !frame.fallback &&
  ROLE_OF_FRAME[frame.kind] !== undefined;

const sourceOf = (job: VideoJob, file: string): MaterialSource => ({
  sessionId: job.sessionId,
  scriptId: job.scriptId,
  file,
  title: job.title,
  at: job.updatedAt,
});

const sceneSetupOf = (job: VideoJob): SceneSetup | undefined =>
  job.plan
    ? {
        seats: job.plan.seats.map((s) => ({
          characterId: s.characterId,
          side: s.side,
          looks: s.looks,
          behind: s.behind,
          ...(s.ambient ? { ambient: s.ambient } : {}),
        })),
        props: job.plan.props.map((p) => ({ name: p.name, where: p.where })),
      }
    : undefined;

function pictureDraft(
  job: VideoJob,
  frame: JobFrame,
  pictures: readonly Picture[],
  place: AssetPhotos | undefined,
  assets: readonly AssetPhotos[],
): PictureDraft {
  const picture = pictures.find((p) => p.id === frame.keyframe);
  const people = picture?.people ?? (frame.characterId ? [frame.characterId] : []);
  const role = ROLE_OF_FRAME[frame.kind] as MaterialRole;
  const scene = role === "scene" ? sceneSetupOf(job) : undefined;
  return {
    kind: "picture",
    ...(frame.material ? { key: frame.material } : {}),
    ...(scene ? { scene } : {}),
    role,
    framing: picture?.framing ?? frame.framing ?? "",
    description: picture?.description ?? "",
    caption: job.shots.find((s) => s.keyframe === frame.keyframe)?.brief ?? "",
    people,
    madeFrom: madeFromOf(people, place, assets),
    level: job.level ?? "",
    costUsd: frame.costUsd ?? null,
    source: sourceOf(job, frame.file as string),
  };
}

export const plannedMotion = (job: Pick<VideoJob, "live">, shot: Pick<JobShot, "index">) => {
  const prompt = job.live?.plan.routes[shot.index]?.input?.prompt;
  return typeof prompt === "string" ? prompt : "";
};

const capturedShot = (shot: JobShot) =>
  shot.route === "motion" &&
  !shot.fallback &&
  !shot.speech &&
  shot.state === "done" &&
  !shot.reused &&
  Boolean(shot.clip);

function clipDraft(job: VideoJob, shot: JobShot, picture: PictureDraft): ClipDraft {
  const { key: _key, scene: _scene, ...fields } = picture;
  return {
    ...fields,
    kind: "clip",
    picture,
    seconds: shot.clipSec,
    motion: plannedMotion(job, shot),
    resolution: job.resolution,
    caption: shot.brief ?? "",
    costUsd: shot.costUsd ?? null,
    source: sourceOf(job, shot.clip as string),
  };
}

export function materialOfVideo(
  job: VideoJob,
  pictures: readonly Picture[],
  place: AssetPhotos | undefined,
  assets: readonly AssetPhotos[],
): MaterialDraft[] {
  if (!finishedVideo(job) || !job.live) return [];
  const captured = job.frames.filter(capturedFrame);
  const pictureByFile = new Map<string, PictureDraft>();
  for (const frame of captured) {
    if (!pictureByFile.has(frame.file as string)) {
      pictureByFile.set(frame.file as string, pictureDraft(job, frame, pictures, place, assets));
    }
  }
  const pictureOfShot = (shot: JobShot) => {
    const frame = frameFor(job, shot);
    return frame?.file ? pictureByFile.get(frame.file) : undefined;
  };
  const clips = new Map<string, ClipDraft>();
  for (const shot of job.shots.filter(capturedShot)) {
    const picture = pictureOfShot(shot);
    const file = shot.clip as string;
    if (picture && !clips.has(file)) clips.set(file, clipDraft(job, shot, picture));
  }
  return [...pictureByFile.values(), ...clips.values()];
}

const SCENE_KEYFRAME = "master";

const masterFrameOf = (job: VideoJob) => {
  const master = job.live?.plan.keyframes.find((k) => k.kind === SCENE_KEYFRAME);
  return master ? job.frames.find((f) => f.keyframe === master.id) : undefined;
};

export function sceneIdOfVideo(job: VideoJob, items: readonly MaterialItem[]): string | undefined {
  const master = masterFrameOf(job);
  if (!master?.file) return undefined;
  if (master.source === "material") return master.material;
  return items.find(
    (i) =>
      i.kind === "picture" &&
      i.source.sessionId === job.sessionId &&
      i.source.scriptId === job.scriptId &&
      i.source.file === master.file,
  )?.id;
}

export const usedBy = (item: MaterialItem, job: Pick<VideoJob, "sessionId" | "scriptId">) =>
  item.uses.some((u) => u.sessionId === job.sessionId && u.scriptId === job.scriptId);

export const usablePicture = (
  items: readonly MaterialItem[],
  assets: readonly AssetPhotos[],
  key: string,
) => items.find((i) => i.id === key && i.kind === "picture" && canBeReused(i, assets));

export function shortestClipFrom(
  items: readonly MaterialItem[],
  assets: readonly AssetPhotos[],
  want: { pictureId: string; seconds: number; resolution: string | undefined; motion: string },
): MaterialItem | undefined {
  return items
    .filter(
      (i) =>
        i.kind === "clip" &&
        i.pictureId === want.pictureId &&
        i.resolution === want.resolution &&
        Boolean(want.motion) &&
        i.motion === want.motion &&
        (i.seconds ?? 0) >= want.seconds &&
        canBeReused(i, assets),
    )
    .sort((a, b) => (a.seconds ?? 0) - (b.seconds ?? 0))[0];
}
