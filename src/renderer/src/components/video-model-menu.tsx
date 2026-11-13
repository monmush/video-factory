import { type OutputResolution, RESOLUTIONS } from "@shared/batch-settings";
import { formatSeconds, perVideo } from "@shared/board";
import { formatCost } from "@shared/credits";
import {
  fitResolution,
  minutesFor45,
  modelGroups,
  modelOutput,
  type VideoModel,
  videoModel,
} from "@shared/video-models";
import { ChevronDown } from "lucide-react";
import { type ReactElement, type ReactNode, useState } from "react";
import { useWorkspace } from "@/lib/workspace";
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

const files = import.meta.glob<string>("../assets/model-samples/*.{mp4,jpg}", {
  eager: true,
  query: "?url",
  import: "default",
});
const asset = (file?: string) =>
  file ? Object.entries(files).find(([path]) => path.endsWith(`/${file}`))?.[1] : undefined;

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
  const [shown, setShown] = useState<VideoModel | null>(null);
  return (
    <Menu onOpenChange={(open) => !open && setShown(null)}>
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
                  onPointerEnter={() => setShown(model)}
                  onFocus={() => setShown(model)}
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
          // Beside the menu, the same surface as a hover card.
          <div className="absolute top-0 left-full ml-2 w-64 rounded-lg border bg-popover text-popover-foreground shadow-lg">
            <ModelCard model={shown} resolution={resolution} />
          </div>
        )}
      </MenuPopup>
    </Menu>
  );
}

/** Sample, name and maker, what to expect, and the facts. */
function ModelCard({ model, resolution }: { model: VideoModel; resolution: OutputResolution }) {
  const sample = asset(model.sample);
  const poster = asset(model.poster);
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
      {sample && (
        <video
          key={sample}
          src={sample}
          poster={poster}
          autoPlay
          muted
          loop
          playsInline
          className="aspect-video w-full rounded-md bg-muted object-cover"
        />
      )}
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

/**
 * Output size of the final video: 720p or 1080p. 1080p is unavailable with a
 * model that cannot make it, and 720p shows as chosen.
 */
export function ResolutionPicker({
  value,
  model,
  onChange,
}: {
  value: OutputResolution;
  /** The chosen model; absent means the default. */
  model?: string;
  onChange: (value: OutputResolution) => void;
}) {
  const shown = fitResolution(model, value);
  return (
    <fieldset className="flex rounded-[var(--control-radius)] border p-0.5">
      <legend className="sr-only">Độ phân giải</legend>
      {(Object.keys(RESOLUTIONS) as OutputResolution[]).map((r) => (
        <Button
          key={r}
          size="xs"
          variant={shown === r ? "default" : "ghost-muted"}
          aria-pressed={shown === r}
          disabled={fitResolution(model, r) !== r}
          onClick={() => onChange(r)}
        >
          {r}
        </Button>
      ))}
    </fieldset>
  );
}

/**
 * A series' output settings, the defaults for its batches; laid out like the
 * asset rows. Prices are for a typical 45-second video.
 */
export function SeriesOutputFields({
  environmentIds,
  videoModel: model,
  resolution,
  onVideoModel,
  onResolution,
}: {
  /** Generated stills (and their price) need a place with photos. */
  environmentIds: string[];
  videoModel?: string;
  resolution: OutputResolution;
  onVideoModel: (id: string) => void;
  onResolution: (value: OutputResolution) => void;
}) {
  const { assets } = useWorkspace();
  const frames = environmentIds.some((id) => assets.find((a) => a.id === id)?.images.length);
  return (
    <div className="grid w-full grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
      <span className="text-xs leading-tight text-muted-foreground">Mô hình AI</span>
      <div className="flex min-w-0">
        <VideoModelMenu
          label="Mô hình AI"
          value={model}
          onChange={onVideoModel}
          resolution={resolution}
          price={(m) =>
            perVideo([], { frames, model: m.id, resolution: fitResolution(m.id, resolution) })
          }
        />
      </div>
      <span className="text-xs leading-tight text-muted-foreground">Độ phân giải</span>
      <div className="flex">
        <ResolutionPicker value={resolution} model={model} onChange={onResolution} />
      </div>
    </div>
  );
}
