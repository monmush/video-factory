import { boardOrder } from "./board";
import type { Script } from "./ipc";
import { finalSecAtTempo } from "./tempo";
import type { VideoJob } from "./video-job";

export interface ExportVersion {
  version: string;
  label: string;
  inUse: boolean;
  final: string;
  seconds: number | null;
}

export interface ExportVideo {
  scriptId: string;
  number: number;
  title: string;
  seconds: number | null;
  versions: ExportVersion[];
}

export interface ExportPick {
  scriptId: string;
  version: string;
}

export interface ExportFile extends ExportPick {
  number: number;
  final: string;
  inUse: boolean;
  base: string;
}

export const pickKey = (pick: ExportPick) => `${pick.scriptId}|${pick.version}`;

const VERSION_IN_USE = "in-use";

const finishedVersions = (job: VideoJob): ExportVersion[] =>
  job.status === "done" && job.final
    ? [
        {
          version: VERSION_IN_USE,
          label: "Bản đang dùng",
          inUse: true,
          final: job.final,
          seconds: finalSecAtTempo(job),
        },
      ]
    : [];

const firstChoice = (video: ExportVideo) =>
  (video.versions.find((v) => v.inUse) ?? video.versions[0]) as ExportVersion;

export function exportableVideos(
  scripts: Script[],
  jobs: ReadonlyMap<string, VideoJob>,
): ExportVideo[] {
  return boardOrder(scripts).flatMap((script, i) => {
    const job = jobs.get(script.id);
    if (script.status !== "ready" || !job) return [];
    const finished = finishedVersions(job);
    if (!finished.length) return [];
    const video: ExportVideo = {
      scriptId: script.id,
      number: i + 1,
      title: script.title || job.title,
      seconds: null,
      versions: finished,
    };
    return [{ ...video, seconds: firstChoice(video).seconds }];
  });
}

export const offeredFiles = (videos: ExportVideo[]) =>
  videos.reduce((n, v) => n + v.versions.length, 0);

export const defaultPicks = (videos: ExportVideo[]): ExportPick[] =>
  videos.map((v) => ({ scriptId: v.scriptId, version: firstChoice(v).version }));

export const allPicks = (videos: ExportVideo[]): ExportPick[] =>
  videos.flatMap((v) => v.versions.map((x) => ({ scriptId: v.scriptId, version: x.version })));

export const safeFileTitle = (title: string) =>
  title
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "video";

export function exportPlan(
  videos: ExportVideo[],
  picks: ExportPick[],
): { files: ExportFile[]; unknown: ExportPick[] } {
  const wanted = new Set(picks.map(pickKey));
  const files = videos.flatMap((video) => {
    const chosen = video.versions.filter((v) =>
      wanted.has(pickKey({ scriptId: video.scriptId, version: v.version })),
    );
    const base = `${String(video.number).padStart(2, "0")} ${safeFileTitle(video.title)}`;
    return chosen.map(
      (v): ExportFile => ({
        scriptId: video.scriptId,
        version: v.version,
        number: video.number,
        final: v.final,
        inUse: v.inUse,
        base: chosen.length > 1 ? `${base} (${safeFileTitle(v.label)})` : base,
      }),
    );
  });
  const found = new Set(files.map(pickKey));
  const unknown = [...new Map(picks.map((p) => [pickKey(p), p])).values()].filter(
    (p) => !found.has(pickKey(p)),
  );
  return { files, unknown };
}

export const sameFileName = (name: string) => name.normalize("NFC").toLowerCase();

export function freeFileName(base: string, taken: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${base}.mp4` : `${base} ${n}.mp4`;
    if (!taken.has(sameFileName(name))) return name;
  }
}

export function formatClock(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
