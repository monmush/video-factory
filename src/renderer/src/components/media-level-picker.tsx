import { type MediaLevelId, mediaLevel, OFFERED_LEVELS } from "@shared/media-level";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

export function MediaLevelPicker({
  value,
  onChange,
}: {
  value: MediaLevelId;
  onChange: (value: MediaLevelId) => void;
}) {
  const chosen = mediaLevel(value).id;
  return (
    <fieldset className="flex flex-wrap rounded-[var(--control-radius)] border p-0.5">
      <legend className="sr-only">Chất lượng</legend>
      {OFFERED_LEVELS.map((level) => (
        <Button
          key={level.id}
          size="xs"
          variant="ghost-muted"
          className={cn(chosen === level.id && "bg-accent text-foreground")}
          aria-pressed={chosen === level.id}
          onClick={() => onChange(level.id)}
        >
          {level.label}
        </Button>
      ))}
    </fieldset>
  );
}
