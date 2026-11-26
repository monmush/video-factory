import type { PlannedKeyframe } from "./live-plan";
import {
  type AssetPhotos,
  canBeReused,
  type MaterialItem,
  plannedMotion,
  type SceneSeat,
  type SceneSetup,
  shortestClipFrom,
  usablePicture,
} from "./material";
import { OUTPUT_RESOLUTION } from "./output-size";
import type { Picture, ShotList } from "./shot-list";
import type { PlanSeat } from "./shot-plan";
import { frameIdFor, type JobFrame, type JobShot, liveSeconds, type VideoJob } from "./video-job";

export const REST_VIDEOS = 1;
export const MAX_OFFERED_PICTURES = 16;

export interface SeatPosition {
  characterId: string;
  side: string;
  looks: string;
}

export interface OfferedScene {
  key: string;
  framing: string;
  description: string;
  people: string[];
  seats: SceneSeat[];
  props: SceneSetup["props"];
  clip?: { seconds: number; motion: string };
}

export interface OfferedPicture {
  alias: string;
  key: string;
  kind: "character" | "action";
  characterId: string | null;
  people: string[];
  framing: string;
  description: string;
  clip?: { seconds: number; motion: string };
}

export interface MaterialOffer {
  scene: OfferedScene | null;
  pictures: OfferedPicture[];
}

export type OfferJob = Pick<
  VideoJob,
  "sessionId" | "scriptId" | "createdAt" | "plan" | "live" | "frames" | "shots"
>;

export interface OfferInput {
  job: Pick<VideoJob, "sessionId" | "scriptId">;
  seating: readonly SeatPosition[];
  placeId: string | null;
  items: readonly MaterialItem[];
  assets: readonly AssetPhotos[];
  others: readonly OfferJob[];
  clipResolution: string | null;
}

export const seatingKey = (seating: readonly SeatPosition[]) =>
  seating
    .map((s) => `${s.characterId}:${s.side}:${s.looks}`)
    .sort()
    .join("|");

const sameSeating = (a: readonly SeatPosition[], b: readonly SeatPosition[]) =>
  seatingKey(a) === seatingKey(b);

const sameVideo = (a: Pick<VideoJob, "sessionId" | "scriptId">) => (b: typeof a) =>
  a.sessionId === b.sessionId && a.scriptId === b.scriptId;

const MASTER = "master";

const masterKeyframe = (job: OfferJob) => job.live?.plan.keyframes.find((k) => k.kind === MASTER);

const seatsOf = (seats: readonly PlanSeat[]): SceneSeat[] =>
  seats.map((s) => ({
    characterId: s.characterId,
    side: s.side,
    looks: s.looks,
    behind: s.behind,
    ...(s.ambient ? { ambient: s.ambient } : {}),
  }));

function filedSceneOf(input: OfferInput, item: MaterialItem): OfferedScene {
  const clip = clipOf(input, item, (c) => !clipResting(input, c));
  return {
    key: item.id,
    framing: item.framing,
    description: item.description,
    people: item.people,
    seats: item.scene?.seats ?? [],
    props: item.scene?.props ?? [],
    ...(clip ? { clip } : {}),
  };
}

const plannedSceneOf = (job: OfferJob, master: PlannedKeyframe): OfferedScene => ({
  key: master.material as string,
  framing: master.framing,
  description: master.description ?? "",
  people: master.peopleIds ?? [],
  seats: seatsOf(job.plan?.seats ?? []),
  props: (job.plan?.props ?? []).map((p) => ({ name: p.name, where: p.where })),
});

const newestFirst = (a: string, b: string) => b.localeCompare(a);

function filedScene(input: OfferInput): OfferedScene | null {
  const fits = (item: MaterialItem) =>
    item.kind === "picture" &&
    item.role === "scene" &&
    item.scene !== undefined &&
    canBeReused(item, input.assets) &&
    sameSeating(item.scene.seats, input.seating) &&
    (input.placeId === null || item.madeFrom.some((m) => m.assetId === input.placeId));
  const best = input.items
    .filter(fits)
    .sort((a, b) => Number(b.kept) - Number(a.kept) || newestFirst(a.source.at, b.source.at))[0];
  return best ? filedSceneOf(input, best) : null;
}

const inStore = (items: readonly MaterialItem[], key: string) => items.some((i) => i.id === key);

function plannedScene(input: OfferInput): OfferedScene | null {
  const found = input.others
    .filter((j) => !sameVideo(input.job)(j) && j.plan && sameSeating(j.plan.seats, input.seating))
    .map((j) => ({ job: j, master: masterKeyframe(j) }))
    .filter(
      (c): c is { job: OfferJob; master: PlannedKeyframe } =>
        Boolean(c.master?.material) && !inStore(input.items, c.master?.material as string),
    )
    .sort((a, b) => a.job.createdAt.localeCompare(b.job.createdAt))[0];
  return found ? plannedSceneOf(found.job, found.master) : null;
}

export const sceneFor = (input: OfferInput) => filedScene(input) ?? plannedScene(input);

interface Candidate {
  picture: Omit<OfferedPicture, "alias">;
  madeBy: Pick<VideoJob, "sessionId" | "scriptId">;
  kept: boolean;
  uses: number;
  at: string;
}

function clipOf(
  input: OfferInput,
  item: MaterialItem,
  allowed: (clip: MaterialItem) => boolean = () => true,
): OfferedPicture["clip"] {
  if (!input.clipResolution) return undefined;
  const longest = input.items
    .filter(
      (i) =>
        i.kind === "clip" &&
        i.pictureId === item.id &&
        i.resolution === input.clipResolution &&
        Boolean(i.motion) &&
        canBeReused(i, input.assets) &&
        allowed(i),
    )
    .sort((a, b) => (b.seconds ?? 0) - (a.seconds ?? 0))[0];
  return longest ? { seconds: longest.seconds ?? 0, motion: longest.motion as string } : undefined;
}

function filedPictures(input: OfferInput, scene: OfferedScene): Candidate[] {
  return input.items
    .filter(
      (i) =>
        i.kind === "picture" &&
        i.role !== "scene" &&
        i.sceneId === scene.key &&
        canBeReused(i, input.assets),
    )
    .map((i) => {
      const clip = clipOf(input, i);
      return {
        picture: {
          key: i.id,
          kind: i.role === "character" ? "character" : "action",
          characterId: i.role === "character" ? (i.people[0] ?? null) : null,
          people: i.people,
          framing: i.framing,
          description: i.description,
          ...(clip ? { clip } : {}),
        },
        madeBy: { sessionId: i.source.sessionId, scriptId: i.source.scriptId },
        kept: i.kept,
        uses: i.uses.length,
        at: i.source.at,
      };
    });
}

const OFFERED_KINDS: Record<string, OfferedPicture["kind"]> = {
  character: "character",
  action: "action",
};

function plannedPictures(input: OfferInput, scene: OfferedScene): Candidate[] {
  return input.others
    .filter((j) => !sameVideo(input.job)(j) && masterKeyframe(j)?.material === scene.key)
    .flatMap((j) =>
      (j.live?.plan.keyframes ?? []).flatMap((k): Candidate[] => {
        const kind = OFFERED_KINDS[k.kind];
        if (!kind || !k.material || inStore(input.items, k.material)) return [];
        return [
          {
            picture: {
              key: k.material,
              kind,
              characterId: kind === "character" ? k.characterId : null,
              people: k.peopleIds ?? [],
              framing: k.framing,
              description: k.description ?? "",
            },
            madeBy: { sessionId: j.sessionId, scriptId: j.scriptId },
            kept: false,
            uses: 0,
            at: j.createdAt,
          },
        ];
      }),
    );
}

const recentVideos = (input: OfferInput) =>
  input.others
    .filter((j) => j.plan && !sameVideo(input.job)(j))
    .sort((a, b) => newestFirst(a.createdAt, b.createdAt))
    .slice(0, REST_VIDEOS);

function replaysClip(job: OfferJob, clip: MaterialItem): boolean {
  if (job.shots.some((s) => s.reused === clip.id || s.materialClip?.id === clip.id)) return true;
  const master = masterKeyframe(job);
  return job.shots.some(
    (s) =>
      s.route === "motion" &&
      Boolean(master) &&
      s.keyframe === master?.id &&
      plannedMotion(job, s) === clip.motion,
  );
}

const clipResting = (input: OfferInput, clip: MaterialItem) =>
  recentVideos(input).some((j) => sameVideo(j)(clip.source) || replaysClip(j, clip));

function restingKeys(input: OfferInput) {
  const recent = recentVideos(input);
  return (c: Candidate) =>
    recent.some(
      (j) => sameVideo(j)(c.madeBy) || j.frames.some((f) => f.material === c.picture.key),
    );
}

const offerOrder = (a: Candidate, b: Candidate) =>
  Number(b.kept) - Number(a.kept) || a.uses - b.uses || newestFirst(a.at, b.at);

export function materialOffer(input: OfferInput): MaterialOffer | null {
  const scene = sceneFor(input);
  if (!scene) return null;
  const resting = restingKeys(input);
  const seen = new Set<string>([scene.key]);
  const pictures = [...filedPictures(input, scene), ...plannedPictures(input, scene)]
    .filter((c) => {
      if (seen.has(c.picture.key)) return false;
      seen.add(c.picture.key);
      return true;
    })
    .filter((c) => !resting(c))
    .sort(offerOrder)
    .slice(0, MAX_OFFERED_PICTURES)
    .map((c, i) => ({ alias: `k${i + 1}`, ...c.picture }));
  return { scene, pictures };
}

const NEVER_KEYED = new Set(["plate"]);

const samePicture = (a: Picture, b: Picture) =>
  a.id === b.id && a.kind === b.kind && a.framing === b.framing && a.description === b.description;

export function withMaterialKeys(
  list: ShotList,
  newKey: () => string,
  basis?: Pick<ShotList, "pictures">,
): ShotList {
  return {
    ...list,
    pictures: list.pictures.map((p) => {
      if (p.material || NEVER_KEYED.has(p.kind)) return p;
      const carried = basis?.pictures.find((b) => b.material && samePicture(b, p))?.material;
      return { ...p, material: carried ?? newKey() };
    }),
  };
}

type Store = { items: readonly MaterialItem[]; assets: readonly AssetPhotos[] };

function frameAvailability(frame: JobFrame, store: Store): JobFrame {
  if (!frame.material || frame.file || frame.requestId || frame.sending) return frame;
  const item = usablePicture(store.items, store.assets, frame.material);
  if (item?.file === frame.materialFile) return frame;
  if (item) return { ...frame, materialFile: item.file };
  const { materialFile: _, ...rest } = frame;
  return rest;
}

const storePictureOf = (frame: JobFrame | undefined) =>
  frame?.material && (!frame.file || frame.source === "material") ? frame.material : undefined;

const shotNotMade = (shot: JobShot) =>
  (shot.state === "planned" || shot.state === "queued") && !shot.clip && !shot.requestId;

const sameClip = (a: JobShot["materialClip"], b: JobShot["materialClip"]) =>
  a?.id === b?.id && a?.file === b?.file && a?.seconds === b?.seconds;

function shotAvailability(
  job: VideoJob,
  shot: JobShot,
  frames: readonly JobFrame[],
  store: Store,
): JobShot {
  if (shot.route !== "motion" || shot.fallback || !shotNotMade(shot)) return shot;
  const frame = frames.find((f) => f.id === frameIdFor(shot));
  const pictureId = storePictureOf(frame);
  const picture = pictureId ? usablePicture(store.items, store.assets, pictureId) : undefined;
  const clip = picture
    ? shortestClipFrom(store.items, store.assets, {
        pictureId: picture.id,
        seconds: liveSeconds(job, shot),
        motion: plannedMotion(job, shot),
        resolution: OUTPUT_RESOLUTION,
      })
    : undefined;
  const found = clip ? { id: clip.id, file: clip.file, seconds: clip.seconds ?? 0 } : undefined;
  if (sameClip(found, shot.materialClip)) return shot;
  if (found) return { ...shot, materialClip: found };
  const { materialClip: _, ...rest } = shot;
  return rest;
}

export function withMaterialAvailability(job: VideoJob, store: Store): VideoJob {
  const frames = job.frames.map((f) => frameAvailability(f, store));
  const shots = job.shots.map((s) => shotAvailability(job, s, frames, store));
  const framesChanged = frames.some((f, i) => f !== job.frames[i]);
  const shotsChanged = shots.some((s, i) => s !== job.shots[i]);
  if (!framesChanged && !shotsChanged) return job;
  return { ...job, frames, shots };
}
