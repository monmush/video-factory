import type { OutputResolution } from "./batch-settings";

// The "Media" level (experiment branch, docs/LIVE_DIRECTOR_EXPERIMENT.md):
// one setting from fastest to most detailed replaces the model and resolution
// choice. It gives the director a speed/quality preference, a target size and
// a guide budget. The budgets are the owner's tunable constants, here and
// nowhere else; they are guidance for the director, never a customer
// threshold, and going over one is a warning with the number, not a block.

export type MediaLevelId = "fastest" | "fast" | "balanced" | "detailed" | "most-detailed";

export interface MediaLevel {
  id: MediaLevelId;
  label: string;
  /** What the director is told to favour (English, for the prompt). */
  preference: string;
  /** Size of the final video. */
  output: OutputResolution;
  /** Target keyframe size (9:16), or the model's nearest. */
  keyframe: { width: number; height: number };
  /** Guide budget in USD for a 45-second video, every paid step included. */
  budgetPer45Usd: number;
}

export const MEDIA_LEVELS: readonly MediaLevel[] = [
  {
    id: "fastest",
    label: "Nhanh nhất",
    preference:
      "Fastest and cheapest. Fewest paid steps: still-move for every shot that does not speak, the quickest lip-sync model that keeps the face, small keyframes.",
    output: "720p",
    keyframe: { width: 720, height: 1280 },
    budgetPer45Usd: 1.5,
  },
  {
    id: "fast",
    label: "Nhanh",
    preference:
      "Fast and economical. Motion only where it clearly matters, otherwise still-move; a fast lip-sync model.",
    output: "720p",
    keyframe: { width: 864, height: 1536 },
    budgetPer45Usd: 2.5,
  },
  {
    id: "balanced",
    label: "Cân bằng",
    preference:
      "Balanced. Sharp keyframes with varied framing, real motion for wide and detail shots where the words call for it, a lip-sync model with good faces; avoid the most expensive tier unless it is clearly better.",
    output: "1080p",
    keyframe: { width: 1116, height: 2000 },
    budgetPer45Usd: 4,
  },
  {
    id: "detailed",
    label: "Chi tiết",
    preference:
      "Detailed. Quality first within reason: the best keyframe model for faces and consistency, motion for every shot that does not speak, a high-quality lip-sync model.",
    output: "1080p",
    keyframe: { width: 1116, height: 2000 },
    budgetPer45Usd: 7,
  },
  {
    id: "most-detailed",
    label: "Chi tiết nhất",
    preference:
      "Most detailed. Best available model for every step regardless of speed; cost matters only to break a tie.",
    output: "1080p",
    keyframe: { width: 1440, height: 2560 },
    budgetPer45Usd: 12,
  },
];

export const DEFAULT_MEDIA_LEVEL: MediaLevelId = "balanced";

/** The level with this id; missing or unknown ids read as the default. */
export const mediaLevel = (id?: string | null): MediaLevel =>
  MEDIA_LEVELS.find((l) => l.id === id) ??
  (MEDIA_LEVELS.find((l) => l.id === DEFAULT_MEDIA_LEVEL) as MediaLevel);

/** The guide budget for a video of this length (seconds). */
export const guideBudgetUsd = (level: MediaLevel, seconds: number) =>
  (level.budgetPer45Usd * Math.max(1, seconds)) / 45;
