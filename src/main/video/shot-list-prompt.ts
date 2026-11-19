import type { MediaLevel } from "../../shared/media-level";
import ADDENDUM from "./shot-list-prompt.md?raw";

const MOTION_ON =
  "The `motion` route is available: use it for every `wide` shot, every `listener` shot and every `detail` that shows an action; use `still-move` only for a detail of a still object. In a `motion` shot people are alive and may act: one clear action per shot (a gesture, leaning in, pouring, handing something over, sitting down or standing up), with the background stirring and the camera moving as the moment needs (a slow push-in, a drift, a pan from one person to the other). Nobody is seen speaking in it.";
const MOTION_OFF =
  "The `motion` route is not available for this video: use `still-move` for every wide, detail and listener shot. Nothing moves inside such a shot, so describe a single moment, the most telling instant of the action (the cup brimming over, not the whole pour).";

export function shotListPrompt(
  base: string,
  v: { level: MediaLevel; motion: boolean; direction: string },
): string {
  const rules = base.split(/\n## Output\b/)[0]?.trimEnd() ?? base;
  const slots: Record<string, string> = {
    level_label: v.level.label,
    level_preference: v.level.preference,
    motion_rule: v.motion ? MOTION_ON : MOTION_OFF,
    direction: v.direction,
  };
  let addendum = ADDENDUM;
  for (const [key, value] of Object.entries(slots)) {
    addendum = addendum.replaceAll(`{{${key}}}`, value);
  }
  return `${rules}\n\n${addendum}`;
}
