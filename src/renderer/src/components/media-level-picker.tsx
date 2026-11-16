import { MEDIA_LEVELS, type MediaLevelId } from "@shared/media-level";
import { Button } from "./ui/button";

// Experiment branch (docs/LIVE_DIRECTOR_EXPERIMENT.md): "Media", one setting
// from fastest to most detailed, in place of the model and the resolution.

export function MediaLevelPicker({
  value,
  onChange,
}: {
  value: MediaLevelId;
  onChange: (value: MediaLevelId) => void;
}) {
  return (
    <fieldset className="flex flex-wrap rounded-[var(--control-radius)] border p-0.5">
      <legend className="sr-only">Media</legend>
      {MEDIA_LEVELS.map((level) => (
        <Button
          key={level.id}
          size="xs"
          variant={value === level.id ? "default" : "ghost-muted"}
          aria-pressed={value === level.id}
          onClick={() => onChange(level.id)}
        >
          {level.label}
        </Button>
      ))}
    </fieldset>
  );
}
