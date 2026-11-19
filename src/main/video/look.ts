import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Asset } from "../../shared/ipc";
import type { PlanSeat } from "../../shared/shot-plan";
import type { VideoJob } from "../../shared/video-job";
import { mediaDir, writeJsonAtomic } from "../paths";

interface LookStill {
  characterId: string;
  file: string;
  side: PlanSeat["side"];
  looks: PlanSeat["looks"];
  characterUpdatedAt: string;
  placeId: string;
  placeUpdatedAt: string;
}

export interface SeriesLook {
  savedAt: string;
  from: { sessionId: string; scriptId: string };
  stills: LookStill[];
}

const lookDir = (seriesId: string) => join(mediaDir(seriesId), "_look");
const lookFile = (seriesId: string) => join(lookDir(seriesId), "look.json");

export async function readLook(seriesId: string): Promise<SeriesLook | null> {
  try {
    return JSON.parse(await readFile(lookFile(seriesId), "utf8")) as SeriesLook;
  } catch {
    return null;
  }
}

export function lookStill(
  look: SeriesLook | null,
  seat: PlanSeat | undefined,
  character: Asset,
  place: Asset,
): string | null {
  const still = look?.stills.find((s) => s.characterId === character.id);
  if (!still || !seat) return null;
  const valid =
    still.side === seat.side &&
    still.looks === seat.looks &&
    still.characterUpdatedAt === character.updatedAt &&
    still.placeId === place.id &&
    still.placeUpdatedAt === place.updatedAt;
  return valid ? still.file : null;
}

export const lookPath = (seriesId: string, file: string) => join(lookDir(seriesId), file);

export async function saveLook(
  job: VideoJob,
  jobDir: string,
  assets: readonly Asset[],
  place: Asset | undefined,
): Promise<void> {
  const dir = lookDir(job.seriesId);
  await mkdir(dir, { recursive: true });
  const previous = await readLook(job.seriesId);
  const stills: LookStill[] = [];
  for (const frame of job.frames) {
    if (frame.kind !== "character" || !frame.file || !frame.characterId) continue;
    const character = assets.find((a) => a.id === frame.characterId);
    const seat = job.plan?.seats.find((s) => s.characterId === frame.characterId);
    if (!character || !seat || !place) continue;
    if (frame.source === "look") {
      const kept = previous?.stills.find((s) => s.characterId === character.id);
      if (kept) stills.push(kept);
      continue;
    }
    if (frame.source !== "generated" || frame.check) continue;
    const file = `character-${character.id}-${Date.now()}.png`;
    await copyFile(join(jobDir, frame.file), join(dir, file));
    stills.push({
      characterId: character.id,
      file,
      side: seat.side,
      looks: seat.looks,
      characterUpdatedAt: character.updatedAt,
      placeId: place.id,
      placeUpdatedAt: place.updatedAt,
    });
  }
  for (const old of previous?.stills ?? []) {
    if (!stills.some((s) => s.characterId === old.characterId)) stills.push(old);
  }
  const look: SeriesLook = {
    savedAt: new Date().toISOString(),
    from: { sessionId: job.sessionId, scriptId: job.scriptId },
    stills,
  };
  await writeJsonAtomic(lookFile(job.seriesId), look);
}
