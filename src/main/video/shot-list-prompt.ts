import type { MediaLevel } from "../../shared/media-level";
import { MAX_SOUND_WORDS } from "../../shared/sound";
import ADDENDUM from "./shot-list-prompt.md?raw";

const MOTION_ON =
  "The `motion` route is available: use it for every `wide` shot, every `listener` shot and every `detail` that shows an action; use `still-move` only for a detail of a still object. In a `motion` shot people are alive and may act: one clear action per shot (a gesture, leaning in, pouring, handing something over, sitting down or standing up), with the background stirring and the camera moving as the moment needs (a slow push-in, a drift, a pan from one person to the other). Nobody is seen speaking in it.";
const MOTION_OFF =
  "The `motion` route is not available for this video: use `still-move` for every wide, detail and listener shot. Nothing moves inside such a shot, so describe a single moment, the most telling instant of the action (the cup brimming over, not the whole pour).";

const SOUND_ON =
  'The video has quiet background sound under the dialogue. Write `ambience`: one short English description of the room tone of this place, steady and quiet, heard for the whole video (for example "quiet tea room, soft distant birdsong through an open window, faint fan hum"). On a shot that does not speak (`listener`, `wide`, `detail`) you may write `sound`: one short English description of a sound the action in it makes (for example "tea poured into a ceramic cup", "porcelain cup set down on a wooden table", "wooden chair scraping"); null when the shot makes no sound of its own. A few spot sounds are enough. Never a `sound` on a `speaker` shot. Never music, singing, voices, speech or laughter in `ambience` or `sound`. ' +
  ` Each of them is at most ${MAX_SOUND_WORDS} words.`;
const SOUND_OFF = "The video has no background sound: set `ambience` and every `sound` to null.";

export function shotListPrompt(
  base: string,
  v: { level: MediaLevel; motion: boolean; sound: boolean; direction: string },
): string {
  const rules = base.split(/\n## Output\b/)[0]?.trimEnd() ?? base;
  const slots: Record<string, string> = {
    level_label: v.level.label,
    level_preference: v.level.preference,
    motion_rule: v.motion ? MOTION_ON : MOTION_OFF,
    sound_rule: v.sound ? SOUND_ON : SOUND_OFF,
    direction: v.direction,
  };
  let addendum = ADDENDUM;
  for (const [key, value] of Object.entries(slots)) {
    addendum = addendum.replaceAll(`{{${key}}}`, value);
  }
  return `${rules}\n\n${addendum}`;
}
