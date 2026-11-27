import {
  type CallOutcome,
  COST_KINDS,
  type CostKind,
  type CostReport,
  type Table,
} from "./cost-report";

export interface StatsCall {
  at: string;
  kind: CostKind;
  usd: number;
  outcome: CallOutcome;
  sessionId: string;
  scriptId: string;
  seriesId: string;
}

export interface StatsVideo {
  sessionId: string;
  scriptId: string;
  seriesId: string;
  title: string;
  doneAt: string | null;
  finalSec: number | null;
  makingSec: number | null;
}

export interface StatsSeries {
  seriesId: string;
  name: string;
}

export interface UsageData {
  calls: StatsCall[];
  videos: StatsVideo[];
  series: StatsSeries[];
}

export const PERIODS = ["7d", "30d", "all"] as const;
export type Period = (typeof PERIODS)[number];

const PERIOD_DAYS: Record<Exclude<Period, "all">, number> = { "7d": 7, "30d": 30 };

export const MAX_DAILY_BARS = 60;

export interface Bar {
  start: Date;
  days: number;
  usd: number;
}

export interface VideoStatsRow {
  key: string;
  title: string;
  seriesName: string;
  finalSec: number | null;
  makingSec: number | null;
  usd: number;
  share: number;
}

export interface SeriesStatsRow {
  seriesId: string;
  name: string;
  finished: number;
  perVideoUsd: number | null;
  usd: number;
  share: number;
}

export interface VideoPoint {
  key: string;
  title: string;
  doneAt: Date;
  usd: number;
  usdPerSec: number | null;
  averageUsd: number;
  averageUsdPerSec: number | null;
}

export const RUNNING_AVERAGE_OF = 5;
const CHANGE_GROUP = 3;

export interface UsageStats {
  totalUsd: number;
  finishedVideos: number;
  perVideoUsd: number | null;
  perVideoChange: number | null;
  points: VideoPoint[];
  perSecondUsd: number | null;
  makingSec: number | null;
  wastedUsd: number;
  wastedShare: number | null;
  bars: Bar[];
  byKind: { kind: CostKind; usd: number }[];
  videos: VideoStatsRow[];
  series: SeriesStatsRow[];
}

const WASTED: ReadonlySet<CallOutcome> = new Set(["redone", "unfinished", "abandoned"]);

function rowsOf(table: Table): Record<string, unknown>[] {
  return table.rows.map((row) =>
    Object.fromEntries(table.header.map((name, at) => [name, row[at]])),
  );
}

const text = (value: unknown) => (typeof value === "string" ? value : "");
const numberOrNull = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const measuredOrNull = (value: unknown) => {
  const seconds = numberOrNull(value);
  return seconds !== null && seconds > 0 ? seconds : null;
};

export function usageData(report: CostReport): UsageData {
  const calls = rowsOf(report.calls).flatMap((row): StatsCall[] => {
    const usd = numberOrNull(row.paid_usd) ?? 0;
    if (usd <= 0) return [];
    return [
      {
        at: text(row.time),
        kind: text(row.kind) as CostKind,
        usd,
        outcome: text(row.outcome) as CallOutcome,
        sessionId: text(row.session_id),
        scriptId: text(row.script_id),
        seriesId: text(row.series_id),
      },
    ];
  });
  const videos = rowsOf(report.videos).map(
    (row): StatsVideo => ({
      sessionId: text(row.session_id),
      scriptId: text(row.script_id),
      seriesId: text(row.series_id),
      title: text(row.title),
      doneAt: text(row.done_at) || null,
      finalSec: numberOrNull(row.final_sec),
      makingSec: measuredOrNull(row.total_making_sec),
    }),
  );
  const series = rowsOf(report.series).flatMap((row): StatsSeries[] => {
    const seriesId = text(row.series_id);
    return seriesId ? [{ seriesId, name: text(row.series_name) }] : [];
  });
  return { calls, videos, series };
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const addDays = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

const timeOf = (iso: string) => Date.parse(iso);

function periodStart(period: Period, calls: readonly StatsCall[], now: Date): Date | null {
  if (period !== "all") return addDays(startOfDay(now), 1 - PERIOD_DAYS[period]);
  const times = calls.map((c) => timeOf(c.at)).filter(Number.isFinite);
  return times.length ? startOfDay(new Date(Math.min(...times))) : null;
}

function bars(start: Date, now: Date, calls: readonly StatsCall[]): Bar[] {
  const end = addDays(startOfDay(now), 1);
  let dayCount = 0;
  while (addDays(start, dayCount) < end) dayCount += 1;
  const step = dayCount > MAX_DAILY_BARS ? 7 : 1;
  const result: Bar[] = [];
  for (let offset = 0; offset < dayCount; offset += step) {
    const barStart = addDays(start, offset);
    const barEnd = addDays(start, Math.min(offset + step, dayCount));
    const usd = calls
      .filter((c) => timeOf(c.at) >= barStart.getTime() && timeOf(c.at) < barEnd.getTime())
      .reduce((n, c) => n + c.usd, 0);
    result.push({ start: barStart, days: Math.min(step, dayCount - offset), usd });
  }
  return result;
}

const sum = (calls: readonly StatsCall[]) => calls.reduce((n, c) => n + c.usd, 0);

const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null);

const average = (values: readonly number[]) =>
  values.length ? values.reduce((n, v) => n + v, 0) / values.length : null;

function runningAverage(values: readonly (number | null)[], upTo: number) {
  const window = values
    .slice(0, upTo + 1)
    .filter((v): v is number => v !== null)
    .slice(-RUNNING_AVERAGE_OF);
  return average(window);
}

function videoPoints(finished: readonly StatsVideo[], costOf: (v: StatsVideo) => number) {
  const ordered = [...finished].sort(
    (a, b) => timeOf(a.doneAt as string) - timeOf(b.doneAt as string),
  );
  const usds = ordered.map(costOf);
  const perSec = ordered.map((v, at) => (v.finalSec ? (usds[at] as number) / v.finalSec : null));
  return ordered.map(
    (video, at): VideoPoint => ({
      key: keyOf(video),
      title: video.title,
      doneAt: new Date(video.doneAt as string),
      usd: usds[at] as number,
      usdPerSec: perSec[at] ?? null,
      averageUsd: runningAverage(usds, at) ?? 0,
      averageUsdPerSec: runningAverage(perSec, at),
    }),
  );
}

function recentChange(points: readonly VideoPoint[]) {
  if (points.length < CHANGE_GROUP * 2) return null;
  const usds = points.map((p) => p.usd);
  const recent = average(usds.slice(-CHANGE_GROUP)) as number;
  const before = average(usds.slice(-CHANGE_GROUP * 2, -CHANGE_GROUP)) as number;
  const change = ratio(recent, before);
  return change === null ? null : change - 1;
}

const keyOf = (item: { sessionId: string; scriptId: string }) =>
  `${item.sessionId}|${item.scriptId}`;

export function usageStats(data: UsageData, period: Period, now: Date): UsageStats {
  const start = periodStart(period, data.calls, now);
  const from = start?.getTime() ?? Number.POSITIVE_INFINITY;
  const inPeriod = (iso: string) => timeOf(iso) >= from && timeOf(iso) <= now.getTime();
  const calls = data.calls.filter((c) => inPeriod(c.at));
  const totalUsd = sum(calls);

  const allCallsOf = new Map<string, StatsCall[]>();
  for (const call of data.calls) {
    if (!call.sessionId || !call.scriptId) continue;
    allCallsOf.set(keyOf(call), [...(allCallsOf.get(keyOf(call)) ?? []), call]);
  }
  const finished = data.videos.filter((v) => v.doneAt !== null && inPeriod(v.doneAt));
  const costOfVideo = (video: StatsVideo) => sum(allCallsOf.get(keyOf(video)) ?? []);
  const finishedUsd = finished.reduce((n, v) => n + costOfVideo(v), 0);
  const finishedSec = finished.reduce((n, v) => n + (v.finalSec ?? 0), 0);
  const wastedUsd = sum(calls.filter((c) => WASTED.has(c.outcome)));

  const seriesName = new Map(data.series.map((s) => [s.seriesId, s.name]));
  const videoOf = new Map(data.videos.map((v) => [keyOf(v), v]));

  const periodCallsOf = new Map<string, StatsCall[]>();
  for (const call of calls) {
    if (!call.sessionId || !call.scriptId) continue;
    periodCallsOf.set(keyOf(call), [...(periodCallsOf.get(keyOf(call)) ?? []), call]);
  }
  const videos = [...periodCallsOf].map(([key, own]): VideoStatsRow => {
    const video = videoOf.get(key);
    const first = own[0] as StatsCall;
    const usd = sum(own);
    const isDone = Boolean(video?.doneAt);
    return {
      key,
      title: video?.title ?? "",
      seriesName: seriesName.get(video?.seriesId ?? first.seriesId) ?? "",
      finalSec: isDone ? (video?.finalSec ?? null) : null,
      makingSec: isDone ? (video?.makingSec ?? null) : null,
      usd,
      share: ratio(usd, totalUsd) ?? 0,
    };
  });

  const seriesIds = [...new Set(calls.filter((c) => c.sessionId).map((c) => c.seriesId))].filter(
    Boolean,
  );
  const series = seriesIds.map((seriesId): SeriesStatsRow => {
    const usd = sum(calls.filter((c) => c.sessionId && c.seriesId === seriesId));
    const own = finished.filter((v) => v.seriesId === seriesId);
    return {
      seriesId,
      name: seriesName.get(seriesId) ?? "",
      finished: own.length,
      perVideoUsd: ratio(
        own.reduce((n, v) => n + costOfVideo(v), 0),
        own.length,
      ),
      usd,
      share: ratio(usd, totalUsd) ?? 0,
    };
  });

  const points = videoPoints(finished, costOfVideo);

  const byCost = <T extends { usd: number }>(rows: T[]) => rows.sort((a, b) => b.usd - a.usd);

  return {
    totalUsd,
    finishedVideos: finished.length,
    perVideoUsd: ratio(finishedUsd, finished.length),
    perVideoChange: recentChange(points),
    points,
    perSecondUsd: ratio(finishedUsd, finishedSec),
    makingSec: average(finished.flatMap((v) => (v.makingSec === null ? [] : [v.makingSec]))),
    wastedUsd,
    wastedShare: ratio(wastedUsd, totalUsd),
    bars: start ? bars(start, now, calls) : [],
    byKind: COST_KINDS.map((kind) => ({
      kind,
      usd: sum(calls.filter((c) => c.kind === kind)),
    })).filter((k) => k.usd > 0),
    videos: byCost(videos),
    series: byCost(series),
  };
}
