import { estimateText } from "@shared/cost/table";
import {
  type MediaLevel,
  type MediaLevelId,
  mediaLevel,
  OFFERED_LEVELS,
} from "@shared/media-level";
import { ChevronDown } from "lucide-react";
import type { ComponentProps, ReactElement } from "react";
import { cn } from "@/lib/utils";
import { MenuSideCard, useShownRow } from "./menu-side-card";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./ui/menu";
import { SettingChip } from "./ui/setting-chip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

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
  return (
    <QualityMenu
      value={value}
      onChange={onChange}
      seriesDefault={seriesDefault}
      trigger={(props) => <SettingChip {...props} label="Chất lượng" value={current.label} />}
    />
  );
}

export function VideoQuality({
  value,
  onChange,
  price,
}: {
  value: MediaLevelId;
  onChange: (value: MediaLevelId) => void;
  price: (level: MediaLevel) => number | null;
}) {
  const current = mediaLevel(value);
  return (
    <QualityMenu
      value={value}
      onChange={onChange}
      price={price}
      trigger={(props) => (
        <button
          type="button"
          aria-label={`Chất lượng: ${current.label}`}
          {...props}
          className={cn(
            "-mx-1 inline-flex h-6 cursor-pointer items-center gap-0.5 rounded-md px-1 text-xs font-medium text-foreground outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-accent/60",
          )}
        >
          {current.label}
          <ChevronDown className="size-3 text-muted-foreground" aria-hidden />
        </button>
      )}
    />
  );
}

function QualityMenu({
  value,
  onChange,
  seriesDefault,
  price,
  trigger,
}: {
  value: MediaLevelId;
  onChange: (value: MediaLevelId) => void;
  seriesDefault?: MediaLevelId;
  price?: (level: MediaLevel) => number | null;
  trigger: (props: ComponentProps<"button">) => ReactElement;
}) {
  const current = mediaLevel(value);
  const series = seriesDefault ? mediaLevel(seriesDefault).id : undefined;
  const { shown, clear, row } = useShownRow<MediaLevel>();
  const priceOf = (level: MediaLevel) => {
    const usd = price?.(level);
    return usd === undefined || usd === null ? undefined : estimateText(usd);
  };
  return (
    <Menu onOpenChange={(open) => !open && clear()}>
      <Tooltip>
        <TooltipTrigger render={<MenuTrigger render={trigger} />} />
        <TooltipPopup className="w-64 p-0">
          <LevelCard level={current} price={priceOf(current)} />
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
                {priceOf(level) && (
                  <span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">
                    {priceOf(level)}
                  </span>
                )}
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        {shown && (
          <MenuSideCard>
            <LevelCard level={shown} price={priceOf(shown)} />
          </MenuSideCard>
        )}
      </MenuPopup>
    </Menu>
  );
}

export function LevelCard({ level, price }: { level: MediaLevel; price?: string }) {
  return (
    <div className="flex flex-col gap-2 p-2.5 text-xs">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{level.label}</span>
        {price && <span className="text-muted-foreground tabular-nums">{price}</span>}
      </div>
      <ul className="flex flex-col gap-0.5">
        {level.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
    </div>
  );
}
