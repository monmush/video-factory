import { MEDIA_LEVELS, type MediaLevelId } from "@shared/media-level";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

// Experiment branch (docs/LIVE_DIRECTOR_EXPERIMENT.md): "Chất lượng" (the Media
// level), one setting from fastest to most detailed, in place of the model and
// the resolution. The chosen segment is neutral, like the board's view toggle.

export function MediaLevelPicker({
  value,
  onChange,
}: {
  value: MediaLevelId;
  onChange: (value: MediaLevelId) => void;
}) {
  return (
    <fieldset className="flex flex-wrap rounded-[var(--control-radius)] border p-0.5">
      <legend className="sr-only">Chất lượng</legend>
      {MEDIA_LEVELS.map((level) => (
        <Button
          key={level.id}
          size="xs"
          variant="ghost-muted"
          className={cn(value === level.id && "bg-accent text-foreground")}
          aria-pressed={value === level.id}
          onClick={() => onChange(level.id)}
        >
          {level.label}
        </Button>
      ))}
    </fieldset>
  );
}
