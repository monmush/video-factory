import type { DirectionEntry } from "./direction";
import type { JobShot } from "./video-job";

export type RewordedScene = Pick<
  JobShot,
  "text" | "kind" | "framing" | "productId" | "brief" | "route" | "sound"
>;

export interface RewordedFrom {
  scenes: RewordedScene[];
  droppedWishes: number;
}

export interface Reworded {
  scenes: number[] | "all";
  droppedWishes: number;
}

const norm = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

const sceneOf = (shot: RewordedScene): RewordedScene => ({
  text: shot.text,
  kind: shot.kind,
  framing: shot.framing,
  productId: shot.productId,
  ...(shot.brief ? { brief: shot.brief } : {}),
  ...(shot.route ? { route: shot.route } : {}),
  ...(shot.sound ? { sound: shot.sound } : {}),
});

const looks = (shot: RewordedScene) =>
  JSON.stringify([
    norm(shot.text),
    shot.kind,
    shot.framing,
    shot.productId,
    norm(shot.brief),
    shot.route ?? null,
    norm(shot.sound),
  ]);

const wishes = (list: readonly DirectionEntry[] | undefined) =>
  (list ?? []).filter((d) => d.words).length;

export function rewordedFrom(
  job: {
    plan?: unknown;
    shots: readonly RewordedScene[];
    direction?: readonly DirectionEntry[];
    rewordedFrom?: RewordedFrom;
  },
  kept: readonly DirectionEntry[],
): RewordedFrom | undefined {
  const earlier = job.plan ? undefined : job.rewordedFrom;
  const scenes = job.plan ? job.shots.map(sceneOf) : earlier?.scenes;
  if (!scenes) return undefined;
  return {
    scenes,
    droppedWishes: (earlier?.droppedWishes ?? 0) + wishes(job.direction) - wishes(kept),
  };
}

export function reworded(from: RewordedFrom, shots: readonly RewordedScene[]): Reworded {
  const left = new Map<string, number>();
  for (const scene of from.scenes) left.set(looks(scene), (left.get(looks(scene)) ?? 0) + 1);
  const changed = shots.flatMap((shot, i) => {
    const key = looks(shot);
    const count = left.get(key) ?? 0;
    if (!count) return [i];
    left.set(key, count - 1);
    return [];
  });
  const whole = shots.length > 0 && changed.length === shots.length;
  return { scenes: whole ? "all" : changed, droppedWishes: from.droppedWishes };
}
