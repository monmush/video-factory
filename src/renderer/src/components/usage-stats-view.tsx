import { SPEAKING_SCENES } from "@shared/cost/group-names";
import type { CostKind } from "@shared/cost-report";
import { formatCost } from "@shared/credits";
import { type CurvePoint, monotonePath } from "@shared/monotone-curve";
import {
  type Bar,
  PERIODS,
  type Period,
  type SeriesStatsRow,
  type UsageData,
  type UsageStats,
  usageStats,
  type VideoPoint,
  type VideoStatsRow,
} from "@shared/usage-stats";
import { type MouseEvent, type ReactNode, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsPanel, TabsTab } from "./ui/tabs";

const PERIOD_LABEL: Record<Period, string> = {
  "7d": "7 ngày",
  "30d": "30 ngày",
  all: "Tất cả",
};

const KIND_STYLE: Record<CostKind, { name: string; color: string }> = {
  still: { name: "Hình ảnh", color: "bg-chart-1" },
  speech: { name: SPEAKING_SCENES, color: "bg-chart-2" },
  clip: { name: "Cảnh quay", color: "bg-chart-3" },
  sound: { name: "Âm thanh", color: "bg-chart-4" },
  voice: { name: "Giọng nhân vật", color: "bg-chart-5" },
  library: { name: "Thư viện", color: "bg-chart-6" },
  abandoned: { name: "Đã hủy", color: "bg-chart-8" },
  "text-ai": { name: "Văn bản", color: "bg-chart-7" },
};

const PERIOD_KEY = "hyan.usage.period";
const CHART_KEY = "hyan.usage.chart";
const MEASURE_KEY = "hyan.usage.measure";

const CHARTS = ["days", "videos"] as const;
type ChartView = (typeof CHARTS)[number];
const MEASURES = ["video", "second"] as const;
type Measure = (typeof MEASURES)[number];

function useStoredChoice<T extends string>(key: string, choices: readonly T[], fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return choices.find((c) => c === stored) ?? fallback;
    } catch {
      return fallback;
    }
  });
  const choose = (next: unknown) => {
    const found = choices.find((c) => c === next);
    if (!found) return;
    setValue(found);
    try {
      localStorage.setItem(key, found);
    } catch {}
  };
  return [value, choose] as const;
}

const NO_VALUE = "—";

const orNone = <T,>(value: T | null, format: (value: T) => string) =>
  value === null ? NO_VALUE : format(value);

function clock(seconds: number) {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

const signedPercent = (change: number) => {
  const rounded = Math.round(change * 100);
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded)}%`;
};

const dayLabel = (date: Date) => `${date.getDate()}/${date.getMonth() + 1}`;

function barLabel(bar: Bar) {
  if (bar.days === 1) return dayLabel(bar.start);
  const last = new Date(bar.start);
  last.setDate(last.getDate() + bar.days - 1);
  return `${dayLabel(bar.start)}–${dayLabel(last)}`;
}

export function UsageStatsView({ data }: { data: UsageData }) {
  const [period, choose] = useStoredChoice<Period>(PERIOD_KEY, PERIODS, "30d");
  const stats = useMemo(() => usageStats(data, period, new Date()), [data, period]);

  return (
    <Tabs value={period} onValueChange={choose} className="flex flex-col gap-6">
      <TabsList className="self-end" aria-label="Khoảng thời gian">
        {PERIODS.map((p) => (
          <TabsTab key={p} value={p}>
            {PERIOD_LABEL[p]}
          </TabsTab>
        ))}
      </TabsList>
      <TabsPanel value={period}>
        {stats.totalUsd > 0 ? (
          <StatsBody stats={stats} />
        ) : (
          <p className="py-10 text-center text-muted-foreground">
            Chưa có chi phí trong khoảng này.
          </p>
        )}
      </TabsPanel>
    </Tabs>
  );
}

function StatsBody({ stats }: { stats: UsageStats }) {
  return (
    <div className="flex flex-col gap-10">
      <div className="grid grid-cols-[minmax(10rem,16rem)_1fr] gap-8 lg:gap-12">
        <div className="flex flex-col justify-center gap-1">
          <div className="text-5xl font-semibold tabular-nums">{formatCost(stats.totalUsd)}</div>
          <div className="text-muted-foreground tabular-nums">
            {stats.finishedVideos} video hoàn thành
          </div>
        </div>
        <SpendCharts stats={stats} />
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Figure
          label="Mỗi video"
          value={
            <>
              {orNone(stats.perVideoUsd, formatCost)}
              {stats.perVideoChange !== null && <Change value={stats.perVideoChange} />}
            </>
          }
        />
        <Figure label="Mỗi giây video" value={orNone(stats.perSecondUsd, formatCost)} />
        <Figure label="Thời gian tạo" value={orNone(stats.makingSec, clock)} />
        <Figure
          label="Làm lại và bỏ dở"
          value={
            <>
              {formatCost(stats.wastedUsd)}
              <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                {orNone(stats.wastedShare, percent)}
              </span>
            </>
          }
        />
      </div>

      <KindSplit byKind={stats.byKind} total={stats.totalUsd} />

      <Breakdown videos={stats.videos} series={stats.series} />
    </div>
  );
}

function Change({ value }: { value: number }) {
  return (
    <span
      className={cn(
        "ml-1.5 text-sm font-medium",
        value < 0 && "text-success-foreground",
        value > 0 && "text-warning-foreground",
        value === 0 && "text-muted-foreground",
      )}
    >
      {signedPercent(value)}
    </span>
  );
}

function Figure({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function niceMax(max: number) {
  if (max <= 0) return 1;
  const unit = 10 ** Math.floor(Math.log10(max));
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => s * unit >= max) ?? 10;
  return step * unit;
}

const scaleLabel = (usd: number) => `$${Number(usd.toPrecision(2))}`;

const PLOT_HEIGHT = "h-44 lg:h-64";

function SpendCharts({ stats }: { stats: UsageStats }) {
  const [chart, chooseChart] = useStoredChoice<ChartView>(CHART_KEY, CHARTS, "days");
  const [measure, chooseMeasure] = useStoredChoice<Measure>(MEASURE_KEY, MEASURES, "video");
  const [readout, setReadout] = useState<ReactNode>(null);
  const first = stats.bars[0];
  const last = stats.bars.at(-1);
  if (!first || !last) return null;
  const end = new Date(last.start);
  end.setDate(end.getDate() + last.days);
  const range = { from: first.start, to: end, last };

  return (
    <figure className="flex min-w-0 flex-col gap-3">
      <div className="flex min-h-9 items-start justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          <Tabs value={chart} onValueChange={(v) => chooseChart(v)}>
            <TabsList aria-label="Biểu đồ">
              <TabsTab value="days">Theo ngày</TabsTab>
              <TabsTab value="videos">Mỗi video</TabsTab>
            </TabsList>
          </Tabs>
          {chart === "videos" && (
            <Tabs value={measure} onValueChange={(v) => chooseMeasure(v)}>
              <TabsList aria-label="Đơn vị">
                <TabsTab value="video">Mỗi video</TabsTab>
                <TabsTab value="second">Mỗi giây</TabsTab>
              </TabsList>
            </Tabs>
          )}
        </div>
        <div className="min-w-0 text-right text-xs tabular-nums">{readout}</div>
      </div>
      {chart === "days" ? (
        <DayLine bars={stats.bars} range={range} onReadout={setReadout} />
      ) : (
        <VideoTrend points={stats.points} measure={measure} range={range} onReadout={setReadout} />
      )}
    </figure>
  );
}

interface Range {
  from: Date;
  to: Date;
  last: Bar;
}

function Plot({ top, range, children }: { top: number; range: Range; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <div className={cn("relative min-w-0 flex-1 border-b", PLOT_HEIGHT)}>
          {[1, 0.5].map((at) => (
            <div
              key={at}
              aria-hidden="true"
              className="absolute inset-x-0 border-t border-dashed"
              style={{ bottom: `${at * 100}%` }}
            />
          ))}
          {children}
        </div>
        <div
          aria-hidden="true"
          className={cn(
            "relative w-10 shrink-0 text-2xs text-muted-foreground tabular-nums",
            PLOT_HEIGHT,
          )}
        >
          <span className="absolute top-0 -translate-y-1/2">{scaleLabel(top)}</span>
          <span className="absolute top-1/2 -translate-y-1/2">{scaleLabel(top / 2)}</span>
        </div>
      </div>
      <div className="flex justify-between pr-12 text-2xs text-muted-foreground tabular-nums">
        <span>{dayLabel(range.from)}</span>
        <span>{barLabel(range.last)}</span>
      </div>
    </div>
  );
}

function Curve({ points, area = false }: { points: CurvePoint[]; area?: boolean }) {
  const line = monotonePath(points);
  const first = points[0];
  const last = points.at(-1);
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      {area && first && last && (
        <path d={`${line} L${last.x},100 L${first.x},100 Z`} className="fill-foreground/8" />
      )}
      <path
        d={line}
        fill="none"
        className="stroke-foreground"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

const dayX = (at: number, count: number) => (count > 1 ? (at / (count - 1)) * 100 : 50);

function DayLine({
  bars,
  range,
  onReadout,
}: {
  bars: Bar[];
  range: Range;
  onReadout: (readout: ReactNode) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const top = niceMax(Math.max(...bars.map((b) => b.usd)));
  const y = (usd: number) => 100 - (usd / top) * 100;
  const points = bars.map((bar, at) => ({ x: dayX(at, bars.length), y: y(bar.usd) }));
  const curve = bars.length > 1 ? points : [{ x: 0, y: 100 }, ...points, { x: 100, y: 100 }];
  const title = bars.some((b) => b.days > 1) ? "Chi phí theo tuần" : "Chi phí theo ngày";
  const nearest = (event: MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const share = (event.clientX - box.left) / box.width;
    const at =
      bars.length > 1 ? Math.round(Math.min(1, Math.max(0, share)) * (bars.length - 1)) : 0;
    const bar = bars[at];
    if (!bar) return;
    setHovered(at);
    onReadout(`${barLabel(bar)} · ${formatCost(bar.usd)}`);
  };
  const shown = hovered === null ? null : bars[hovered];

  return (
    <Plot top={top} range={range}>
      <Curve points={curve} area />
      {shown && hovered !== null && (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 border-l border-dashed border-muted-foreground/40"
            style={{ left: `${dayX(hovered, bars.length)}%` }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-popover"
            style={{ left: `${dayX(hovered, bars.length)}%`, top: `${y(shown.usd)}%` }}
          />
        </>
      )}
      <div
        role="img"
        aria-label={title}
        className="absolute inset-0"
        onMouseMove={nearest}
        onMouseLeave={() => {
          setHovered(null);
          onReadout(null);
        }}
      />
      <ul className="sr-only">
        {bars.map((bar) => (
          <li key={bar.start.getTime()}>{`${barLabel(bar)}: ${formatCost(bar.usd)}`}</li>
        ))}
      </ul>
    </Plot>
  );
}

const MEASURE_VALUE: Record<
  Measure,
  { value: (p: VideoPoint) => number | null; average: (p: VideoPoint) => number | null }
> = {
  video: { value: (p) => p.usd, average: (p) => p.averageUsd },
  second: { value: (p) => p.usdPerSec, average: (p) => p.averageUsdPerSec },
};

const costText = (usd: number, measure: Measure) =>
  measure === "second" ? `${formatCost(usd)}/giây` : formatCost(usd);

function VideoTrend({
  points,
  measure,
  range,
  onReadout,
}: {
  points: VideoPoint[];
  measure: Measure;
  range: Range;
  onReadout: (readout: ReactNode) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const { value, average } = MEASURE_VALUE[measure];
  const marks = points.flatMap((p) => {
    const y = value(p);
    return y === null ? [] : [{ point: p, y, average: average(p) }];
  });
  if (!marks.length) {
    return (
      <div className={cn("flex items-center justify-center text-muted-foreground", PLOT_HEIGHT)}>
        Chưa có video hoàn thành trong khoảng này.
      </div>
    );
  }
  const top = niceMax(Math.max(...marks.flatMap((m) => [m.y, m.average ?? 0])));
  const span = range.to.getTime() - range.from.getTime();
  const x = (date: Date) => ((date.getTime() - range.from.getTime()) / span) * 100;
  const y = (usd: number) => 100 - (usd / top) * 100;
  const line = marks.flatMap((m) =>
    m.average === null ? [] : [{ x: x(m.point.doneAt), y: y(m.average) }],
  );
  const show = (m: (typeof marks)[number]) => {
    setHovered(m.point.key);
    onReadout(
      <>
        <div className="max-w-64 truncate font-medium">{m.point.title || "Video không tên"}</div>
        <div className="text-muted-foreground">
          {dayLabel(m.point.doneAt)} · {costText(m.y, measure)}
          {m.average !== null && ` · trung bình ${costText(m.average, measure)}`}
        </div>
      </>,
    );
  };
  const hide = () => {
    setHovered(null);
    onReadout(null);
  };

  return (
    <Plot top={top} range={range}>
      {marks.length >= 2 && <Curve points={line} />}
      {marks.map((m) => (
        <div
          key={m.point.key}
          role="img"
          aria-label={`${m.point.title || "Video không tên"}, ${dayLabel(m.point.doneAt)}: ${costText(m.y, measure)}`}
          className="absolute flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
          style={{ left: `${x(m.point.doneAt)}%`, top: `${y(m.y)}%` }}
          onMouseEnter={() => show(m)}
          onMouseLeave={hide}
        >
          <div
            className={cn(
              "rounded-full",
              hovered === m.point.key ? "size-2.5 bg-foreground" : "size-2 bg-muted-foreground/45",
            )}
          />
        </div>
      ))}
    </Plot>
  );
}

function KindSplit({ byKind, total }: { byKind: UsageStats["byKind"]; total: number }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-semibold">Chi phí theo loại</h3>
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
        {byKind.map(({ kind, usd }) => (
          <div
            key={kind}
            role="img"
            aria-label={`${KIND_STYLE[kind].name}: ${formatCost(usd)}`}
            className={cn("h-full", KIND_STYLE[kind].color)}
            style={{ width: `${(usd / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
        {byKind.map(({ kind, usd }) => (
          <li key={kind} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn("size-2 rounded-full", KIND_STYLE[kind].color)}
            />
            <span className="text-muted-foreground">{KIND_STYLE[kind].name}</span>
            <span className="tabular-nums">{formatCost(usd)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

type BreakdownView = "videos" | "series";

function Breakdown({ videos, series }: { videos: VideoStatsRow[]; series: SeriesStatsRow[] }) {
  const [view, setView] = useState<BreakdownView>("videos");
  return (
    <Tabs
      value={view}
      onValueChange={(value) => setView(value === "series" ? "series" : "videos")}
      className="flex flex-col gap-3"
    >
      <TabsList className="self-end" aria-label="Xem theo">
        <TabsTab value="videos">Video</TabsTab>
        <TabsTab value="series">Series</TabsTab>
      </TabsList>
      <TabsPanel value="videos">
        <StatsTable
          header={["Video", "Độ dài", "Thời gian tạo", "Chi phí"]}
          rows={videos.map((v) => ({
            key: v.key,
            name: v.title || "Video không tên",
            under: v.seriesName,
            cells: [orNone(v.finalSec, clock), orNone(v.makingSec, clock), formatCost(v.usd)],
            share: v.share,
          }))}
        />
      </TabsPanel>
      <TabsPanel value="series">
        <StatsTable
          header={["Series", "Hoàn thành", "Mỗi video", "Chi phí"]}
          rows={series.map((s) => ({
            key: s.seriesId,
            name: s.name || "Series không tên",
            under: "",
            cells: [String(s.finished), orNone(s.perVideoUsd, formatCost), formatCost(s.usd)],
            share: s.share,
          }))}
        />
      </TabsPanel>
    </Tabs>
  );
}

interface TableRow {
  key: string;
  name: string;
  under: string;
  cells: string[];
  share: number;
}

function StatsTable({ header, rows }: { header: string[]; rows: TableRow[] }) {
  const [nameHeader, ...valueHeaders] = header;
  return (
    <table className="w-full table-fixed text-sm">
      <thead className="sticky top-0 bg-popover">
        <tr className="border-b text-left text-xs text-muted-foreground">
          <th className="py-2 pr-3 font-normal">{nameHeader}</th>
          {valueHeaders.map((h) => (
            <th key={h} className="w-24 py-2 pr-3 text-right font-normal">
              {h}
            </th>
          ))}
          <th className="w-24 py-2 font-normal">
            <span className="sr-only">Tỷ lệ</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-b last:border-b-0">
            <td className="py-2 pr-3">
              <div className="truncate">{row.name}</div>
              {row.under && (
                <div className="truncate text-xs text-muted-foreground">{row.under}</div>
              )}
            </td>
            {row.cells.map((cell, at) => (
              <td key={valueHeaders[at]} className="py-2 pr-3 text-right tabular-nums">
                {cell}
              </td>
            ))}
            <td className="py-2">
              <div
                role="img"
                aria-label={percent(row.share)}
                className="h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-foreground/60"
                  style={{ width: `${row.share * 100}%` }}
                />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
