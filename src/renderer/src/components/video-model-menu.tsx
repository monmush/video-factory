import type { OutputResolution } from "@shared/batch-settings";
import { formatSeconds } from "@shared/board";
import { formatCost } from "@shared/credits";
import type { MediaLevelId } from "@shared/media-level";
import {
  minutesFor45,
  modelGroups,
  modelOutput,
  type VideoModel,
  videoModel,
} from "@shared/video-models";
import { ChevronDown } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { MediaLevelPicker } from "./media-level-picker";
import { MenuSideCard, SampleLoop, useShownRow } from "./menu-side-card";
import { Button } from "./ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

// "Mô hình AI": the speaking-shot model, by name, grouped by level, each with
// its all-in price per video and a hover card (sample, maker, what to expect,
// facts). Registry: src/shared/video-models.ts.

/** One video's all-in price and the length it is for. */
export type PerVideo = { usd: number; seconds: number };

/** "~$2.85/video 45 giây". */
const priceText = (p: PerVideo | null) =>
  p ? `~${formatCost(p.usd)}/video ${formatSeconds(p.seconds)}` : "";

export function VideoModelMenu({
  value,
  onChange,
  price,
  resolution,
  label,
  disabled,
  trigger,
  triggerContent,
}: {
  /** A model id; missing or unknown reads as the default. */
  value?: string;
  onChange: (id: string) => void;
  /** Null: no price for this model here (it is disabled). */
  price: (model: VideoModel) => PerVideo | null;
  /** The video's output size: some models follow it, and their price with it. */
  resolution: OutputResolution;
  label: string;
  /** Models offered but not pickable (a video's existing takes). */
  disabled?: (model: VideoModel) => boolean;
  /** Opens the menu from this element instead of the value button; nothing shows as chosen. */
  trigger?: ReactElement;
  triggerContent?: ReactNode;
}) {
  const current = videoModel(value);
  // The row under the pointer or keyboard; its card sits beside the menu.
  const { shown, clear, row } = useShownRow<VideoModel>();
  return (
    <Menu onOpenChange={(open) => !open && clear()}>
      {trigger ? (
        <MenuTrigger aria-label={label} render={trigger}>
          {triggerContent}
        </MenuTrigger>
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                aria-label={label}
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-w-0 max-w-full justify-start"
                  />
                }
              />
            }
          >
            <span className="min-w-0 truncate">
              {current.name}
              <span className="font-normal text-muted-foreground">
                {" "}
                · {priceText(price(current))}
              </span>
            </span>
            <ChevronDown />
          </TooltipTrigger>
          <TooltipPopup className="w-64 p-0">
            <ModelCard model={current} resolution={resolution} />
          </TooltipPopup>
        </Tooltip>
      )}
      <MenuPopup align="start" className="relative min-w-(--anchor-width)">
        <MenuRadioGroup
          value={trigger ? null : current.id}
          onValueChange={(id: string) => onChange(id)}
        >
          {modelGroups().map((group) => (
            <MenuGroup key={group.level}>
              <MenuGroupLabel>{group.label}</MenuGroupLabel>
              {group.models.map((model) => (
                <MenuRadioItem
                  key={model.id}
                  value={model.id}
                  disabled={disabled?.(model)}
                  className="data-disabled:cursor-default data-disabled:opacity-50"
                  closeOnClick
                  {...row(model)}
                >
                  <span className="flex items-baseline gap-3">
                    <span className="flex-1 whitespace-nowrap">
                      {model.name}
                      {model.pick && (
                        <span className="ml-1.5 text-2xs text-muted-foreground">Đề xuất</span>
                      )}
                    </span>
                    <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                      {priceText(price(model))}
                    </span>
                  </span>
                </MenuRadioItem>
              ))}
            </MenuGroup>
          ))}
        </MenuRadioGroup>
        {shown && (
          <MenuSideCard>
            <ModelCard model={shown} resolution={resolution} />
          </MenuSideCard>
        )}
      </MenuPopup>
    </Menu>
  );
}

/** Sample, name and maker, what to expect, and the facts. */
function ModelCard({ model, resolution }: { model: VideoModel; resolution: OutputResolution }) {
  const out = modelOutput(model, resolution);
  const minutes = minutesFor45(model);
  const facts: [string, string][] = [
    ["Độ phân giải", out.resolution],
    ...(minutes ? [["Thời gian", `~${minutes} phút / video 45 giây`] as [string, string]] : []),
    ["Giá", `$${out.usdPerSec}/giây`],
    ...(model.minSec ? [["Tối thiểu", `${model.minSec} giây / cảnh`] as [string, string]] : []),
  ];
  return (
    <div className="flex flex-col gap-2 p-2.5 text-xs">
      <SampleLoop file={model.sample} poster={model.poster} className="aspect-video" />
      <div>
        <div className="text-sm font-medium">{model.name}</div>
        <div className="text-muted-foreground">{model.maker}</div>
      </div>
      <p>{model.blurb}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {model.live && <span className="text-muted-foreground">Đã dùng thật</span>}
    </div>
  );
}

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
