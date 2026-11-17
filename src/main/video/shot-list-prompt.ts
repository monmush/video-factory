import type { MediaLevel } from "../../shared/media-level";
import ADDENDUM from "./shot-list-prompt.md?raw";

// The shot list's prompt: the director's rules (filled, without their Output
// section) followed by the pictures-and-routes part. Electron-free.

const MOTION_ON =
  "The `motion` route is available. Every `wide` shot uses it: the people stay seated and alive (breathing, a small turn of the head, a hand on the cup), leaves and light move, the camera drifts slowly; nobody speaks. Use it for a `detail` shot that shows an action (pouring, steam rising). Use `still-move` only for a detail of a still object.";
const MOTION_OFF =
  "The `motion` route is not available for this video: use `still-move` for every wide, detail and listener shot.";

export function shotListPrompt(
  base: string,
  /** `direction`: the operator's wishes, filled by directionSlot (src/shared/direction.ts). */
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
