import { randomUUID } from "node:crypto";
import type { Asset, Workspace } from "../../shared/ipc";
import { type MaterialItem, reuseOn, shortestClipFrom, usablePicture } from "../../shared/material";
import {
  materialOffer,
  type OfferJob,
  seatingKey,
  withMaterialAvailability,
} from "../../shared/material-offer";
import { OUTPUT_RESOLUTION } from "../../shared/output-size";
import { castOf, seatsFor } from "../../shared/shot-plan";
import type { VideoJob } from "../../shared/video-job";
import { listMaterial } from "../material";
import { getWorkspace } from "../store";
import type { DirectMaterial } from "./director";
import { StagingStopped } from "./staging";

const placeOf = (ws: Workspace, seriesId: string) =>
  ws.series
    .find((s) => s.id === seriesId)
    ?.environmentIds.map((id) => ws.assets.find((a) => a.id === id))
    .find((a): a is Asset => Boolean(a?.images.length));

const reuseInSeries = (ws: Workspace, seriesId: string) =>
  reuseOn(ws.series.find((s) => s.id === seriesId));

export async function reusing(seriesId: string): Promise<boolean> {
  return reuseInSeries(await getWorkspace(), seriesId);
}

const scenesBeingMade = new Map<string, Promise<void>>();

function claimScene(lock: string): () => void {
  let done: () => void = () => undefined;
  const making = new Promise<void>((resolve) => {
    done = resolve;
  });
  scenesBeingMade.set(lock, making);
  return () => {
    if (scenesBeingMade.get(lock) === making) scenesBeingMade.delete(lock);
    done();
  };
}

const settledOrAborted = (making: Promise<void>, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    signal.addEventListener("abort", () => resolve(), { once: true });
    void making.then(resolve);
  });

export interface StagingMaterial {
  material?: DirectMaterial;
  release: () => void;
}

const nothingToRelease = () => undefined;

export async function stagingMaterial(
  job: VideoJob,
  others: () => OfferJob[],
  signal: AbortSignal,
): Promise<StagingMaterial> {
  const first = await getWorkspace();
  const place = placeOf(first, job.seriesId);
  if (!reuseInSeries(first, job.seriesId) || !job.useEnvironment || !place) {
    return { release: nothingToRelease };
  }
  const seating = seatsFor(castOf(job.lines));
  const lock = `${job.seriesId}#${seatingKey(seating)}`;
  for (;;) {
    if (signal.aborted) throw new StagingStopped();
    const ws = await getWorkspace();
    const offer = materialOffer({
      job,
      seating,
      placeId: place.id,
      items: await listMaterial(job.seriesId),
      assets: ws.assets,
      others: others(),
      clipResolution: OUTPUT_RESOLUTION,
    });
    if (offer) return { material: { offer, newKey: randomUUID }, release: nothingToRelease };
    const making = scenesBeingMade.get(lock);
    if (!making) {
      return { material: { offer: null, newKey: randomUUID }, release: claimScene(lock) };
    }
    await settledOrAborted(making, signal);
  }
}

export async function availabilityIn(seriesId: string): Promise<(job: VideoJob) => VideoJob> {
  const ws = await getWorkspace();
  if (!reuseInSeries(ws, seriesId)) return (job) => job;
  const items = await listMaterial(seriesId);
  return (job) => withMaterialAvailability(job, { items, assets: ws.assets });
}

export async function storedPicture(
  seriesId: string,
  key: string,
): Promise<MaterialItem | undefined> {
  const ws = await getWorkspace();
  if (!reuseInSeries(ws, seriesId)) return undefined;
  return usablePicture(await listMaterial(seriesId), ws.assets, key);
}

export async function storedClip(
  job: Pick<VideoJob, "seriesId">,
  pictureKey: string,
  want: { seconds: number; motion: string },
): Promise<MaterialItem | undefined> {
  const ws = await getWorkspace();
  if (!reuseInSeries(ws, job.seriesId)) return undefined;
  const items = await listMaterial(job.seriesId);
  const picture = usablePicture(items, ws.assets, pictureKey);
  if (!picture) return undefined;
  return shortestClipFrom(items, ws.assets, {
    pictureId: picture.id,
    seconds: want.seconds,
    motion: want.motion,
    resolution: OUTPUT_RESOLUTION,
  });
}
