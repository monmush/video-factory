import { type DirectionEntry, directionAt } from "./direction";
import type { ScriptLine } from "./ipc";
import type { JobShot, VideoJob } from "./video-job";

export type MergeSide = "previous" | "next";

export const MERGE_WISH: Record<MergeSide, string> = {
  previous: "Không cắt cảnh riêng ở đây: phần lời này nghe tiếp trên cảnh liền trước.",
  next: "Không cắt cảnh riêng ở đây: phần lời này nghe tiếp trên cảnh liền sau.",
};

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLocaleLowerCase("vi");

export function mergeSideOf(want: string | undefined): MergeSide | null {
  if (!want) return null;
  const said = norm(want);
  if (said === norm(MERGE_WISH.previous)) return "previous";
  if (said === norm(MERGE_WISH.next)) return "next";
  return null;
}

export const mergeAt = (list: readonly DirectionEntry[] | undefined, shot: Pick<JobShot, "text">) =>
  mergeSideOf(directionAt(list, shot.text)?.want);

export function scriptLineOf(
  job: Pick<VideoJob, "lines">,
  scriptLines: readonly ScriptLine[],
  shot: Pick<JobShot, "lineIndex">,
): number | null {
  const spoken = job.lines[shot.lineIndex];
  if (!spoken?.characterId) return null;
  const matches = scriptLines.flatMap((line, i) =>
    line.characterId === spoken.characterId && line.text.trim() === spoken.text.trim() ? [i] : [],
  );
  return matches.length === 1 ? (matches[0] as number) : null;
}

export type SceneAction =
  | { kind: "merge"; into: MergeSide }
  | { kind: "remove"; index: number; was: string };

export function sceneAction(
  job: Pick<VideoJob, "lines" | "shots" | "direction">,
  scriptLines: readonly ScriptLine[],
  shot: JobShot,
): SceneAction | null {
  if (mergeAt(job.direction, shot)) return null;
  const sameLine = job.shots.filter((s) => s.lineIndex === shot.lineIndex);
  if (sameLine.length > 1) {
    const sameWords = job.shots.filter((s) => norm(s.text) === norm(shot.text));
    if (sameWords.length > 1) return null;
    return { kind: "merge", into: job.shots[0]?.index === shot.index ? "next" : "previous" };
  }
  if (job.lines.length <= 1 || scriptLines.length <= 1) return null;
  const index = scriptLineOf(job, scriptLines, shot);
  if (index === null) return null;
  return { kind: "remove", index, was: (scriptLines[index] as ScriptLine).text };
}
