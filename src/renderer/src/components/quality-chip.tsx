import { formatSeconds, levelEstimateUsd } from "@shared/board";
import { formatCost } from "@shared/credits";
import {
  type MediaLevel,
  type MediaLevelId,
  mediaLevel,
  OFFERED_LEVELS,
} from "@shared/media-level";
import { MenuSideCard, SampleLoop, sampleAsset, useShownRow } from "./menu-side-card";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "./ui/menu";
import { SettingChip } from "./ui/setting-chip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/**
 * "Chất lượng": the Media level as a setting chip. Each level shows its price
 * for a typical 45-second video (levelEstimateUsd, the recipe's own rates) and
 * a card with what it buys; the series' own level is tagged when given.
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
  const current = mediaLevel(value);
  const series = seriesDefault ? mediaLevel(seriesDefault).id : undefined;
  // The row under the pointer or keyboard; its card sits beside the menu.
  const { shown, clear, row } = useShownRow<MediaLevel>();
  return (
    <Menu onOpenChange={(open) => !open && clear()}>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={(props) => (
                <SettingChip {...props} label="Chất lượng" value={current.label} />
              )}
            />
          }
        />
        <TooltipPopup className="w-64 p-0">
          <LevelCard level={current} />
        </TooltipPopup>
      </Tooltip>
      <MenuPopup align="start" className="relative min-w-56">
        <MenuRadioGroup value={current.id} onValueChange={(next) => onChange(next as MediaLevelId)}>
          {OFFERED_LEVELS.map((level) => (
            <MenuRadioItem key={level.id} value={level.id} {...row(level)}>
              <span className="flex items-center gap-2">
                <span className="truncate">{level.label}</span>
                {series === level.id && (
                  <span className="rounded border px-1 text-2xs leading-4 text-muted-foreground">
                    Series
                  </span>
                )}
                <span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">
                  ~{formatCost(levelEstimateUsd(level))}
                </span>
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <p className="px-2.5 py-1 text-2xs text-muted-foreground">Ước tính cho một video 45 giây</p>
        {shown && (
          <MenuSideCard>
            <LevelCard level={shown} />
          </MenuSideCard>
        )}
      </MenuPopup>
    </Menu>
  );
}

/**
 * The same picture for every level, so the only difference is what the level
 * changes: wide and detail scenes that really move, or a still with a slow zoom.
 */
const SAMPLE = { loop: "motion-wan.mp4", still: "motion-wan.jpg" };

/** What a level buys: the picture, its name and price, and two short lines. */
function LevelCard({ level }: { level: MediaLevel }) {
  return (
    <div className="flex flex-col gap-2 p-2.5 text-xs">
      <div className="aspect-4/5 w-full overflow-hidden rounded-md bg-muted">
        {level.motion ? (
          <SampleLoop file={SAMPLE.loop} poster={SAMPLE.still} className="h-full" />
        ) : (
          <img
            src={sampleAsset(SAMPLE.still)}
            alt=""
            className="slow-zoom h-full w-full object-cover"
          />
        )}
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{level.label}</span>
        <span className="text-muted-foreground tabular-nums">
          ~{formatCost(levelEstimateUsd(level))}/video {formatSeconds(45)}
        </span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {level.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
    </div>
  );
}
