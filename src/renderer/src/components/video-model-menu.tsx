import type { MediaLevelId } from "@shared/media-level";
import { MediaLevelPicker } from "./media-level-picker";

export function SeriesOutputFields({
  mediaLevel,
  onMediaLevel,
}: {
  mediaLevel: MediaLevelId;
  onMediaLevel: (value: MediaLevelId) => void;
}) {
  return (
    <div className="grid w-full grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
      <span className="text-xs leading-tight text-muted-foreground">Chất lượng</span>
      <div className="flex min-w-0">
        <MediaLevelPicker value={mediaLevel} onChange={onMediaLevel} />
      </div>
    </div>
  );
}
