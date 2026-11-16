import { formatCost } from "@shared/credits";
import { MEDIA_LEVELS, type MediaLevelId, mediaLevel } from "@shared/media-level";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "./ui/menu";
import { SettingChip } from "./ui/setting-chip";

/**
 * "Chất lượng": the Media level as a setting chip. Each level shows its guide
 * price for a 45-second video; the series' own level is tagged when given.
 */
export function QualityChip({
  value,
  onChange,
  seriesDefault,
}: {
  value: MediaLevelId;
  onChange: (value: MediaLevelId) => void;
  seriesDefault?: MediaLevelId;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={(props) => (
          <SettingChip {...props} label="Chất lượng" value={mediaLevel(value).label} />
        )}
      />
      <MenuPopup align="start" className="min-w-56">
        <MenuRadioGroup value={value} onValueChange={(next) => onChange(next as MediaLevelId)}>
          {MEDIA_LEVELS.map((level) => (
            <MenuRadioItem key={level.id} value={level.id}>
              <span className="flex items-center gap-2">
                <span className="truncate">{level.label}</span>
                {seriesDefault === level.id && (
                  <span className="rounded border px-1 text-2xs leading-4 text-muted-foreground">
                    Series
                  </span>
                )}
                <span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">
                  ~{formatCost(level.budgetPer45Usd)}
                </span>
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <p className="px-2.5 py-1 text-2xs text-muted-foreground">Ước tính cho một video 45 giây</p>
      </MenuPopup>
    </Menu>
  );
}
