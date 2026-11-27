import { type ActivityRecord, videoDoneEvent } from "./activity";
import type { ChargeKind } from "./cost/charges";
import type { Workspace } from "./ipc";
import { MISHAP_KINDS } from "./mishaps";
import type { TimedPhase, VideoJob } from "./video-job";

export type CostKind =
  | Exclude<ChargeKind, "cutout" | "motion">
  | "abandoned"
  | "library"
  | "text-ai";

export const COST_KINDS = [
  "still",
  "speech",
  "clip",
  "sound",
  "voice",
  "abandoned",
  "library",
  "text-ai",
] as const satisfies readonly CostKind[];

const PURPOSE_KIND: Partial<Record<string, CostKind>> = {
  "video-frame": "still",
  "video-speech": "speech",
  "video-shot": "clip",
  "video-sound": "sound",
  "character-voice": "voice",
  "video-voice": "voice",
  "video-abandoned": "abandoned",
  "generate-angle": "library",
  "product-cutout": "library",
  "clean-place-photo": "library",
};

const TIMED_PHASES = [
  "plan",
  "voice",
  "frames",
  "speech",
  "shots",
  "assemble",
] as const satisfies readonly TimedPhase[];

export const OUTCOMES = ["used", "redone", "unfinished", "abandoned"] as const;

export type CallOutcome = (typeof OUTCOMES)[number] | "";

export interface UsageLine {
  at?: string;
  provider?: string;
  purpose?: string;
  endpoint?: string;
  model?: string;
  cost?: number | null;
  costIsEstimate?: boolean;
  billedUnits?: unknown;
  notionalCostUsd?: number | null;
  durationMs?: number;
  requestId?: string;
  sessionId?: string;
  scriptId?: string;
  shot?: unknown;
  segment?: unknown;
  sound?: unknown;
  voice?: unknown;
}

export type Cell = string | number | boolean | null;

export interface Table {
  header: string[];
  rows: Cell[][];
}

export interface CallRow {
  at: string;
  provider: string;
  purpose: string;
  kind: CostKind;
  endpointOrModel: string;
  billedUnits: string;
  paidUsd: number;
  paid: boolean;
  estimate: boolean;
  notionalUsd: number;
  durationMs: number | null;
  requestId: string;
  seriesId: string;
  seriesName: string;
  sessionId: string;
  sessionName: string;
  scriptId: string;
  videoTitle: string;
  step: string;
  outcome: CallOutcome;
}

export const NO_BATCH_LABEL = "(no batch: library and setup)";

type Done = Extract<ActivityRecord, { name: "video-done" }>;

export interface CurrentVideos {
  jobs: readonly VideoJob[];
  scripts: readonly { sessionId: string; scriptId: string; title: string }[];
}

const asText = (value: unknown) => (typeof value === "string" ? value : "");
const asNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export function costKind(line: Pick<UsageLine, "provider" | "purpose">): CostKind {
  if (line.provider === "claude-code") return "text-ai";
  return PURPOSE_KIND[line.purpose ?? ""] ?? "text-ai";
}

const videoKey = (sessionId: string, scriptId: string) => `${sessionId}|${scriptId}`;

interface Names {
  seriesOfSession: Map<string, string>;
  sessionName: Map<string, string>;
  seriesName: Map<string, string>;
  videoTitle: Map<string, string>;
  latestDone: Map<string, Done>;
  finishedOfSession: Map<string, Set<string>>;
  rev: Map<string, number>;
}

function setIfText(map: Map<string, string>, key: string, value: unknown) {
  if (typeof value === "string" && value) map.set(key, value);
}

function finishFromJob(names: Names, job: VideoJob) {
  const key = videoKey(job.sessionId, job.scriptId);
  if (job.status !== "done" || names.latestDone.has(key)) return;
  names.latestDone.set(key, { at: job.updatedAt, run: "", ...videoDoneEvent(job) });
  const finished = names.finishedOfSession.get(job.sessionId) ?? new Set<string>();
  finished.add(job.scriptId);
  names.finishedOfSession.set(job.sessionId, finished);
  if (!names.rev.has(key)) names.rev.set(key, job.rev ?? 0);
}

function namesFrom(
  events: readonly ActivityRecord[],
  workspace: Pick<Workspace, "series" | "sessions">,
  current: CurrentVideos,
) {
  const names: Names = {
    seriesOfSession: new Map(),
    sessionName: new Map(),
    seriesName: new Map(),
    videoTitle: new Map(),
    latestDone: new Map(),
    finishedOfSession: new Map(),
    rev: new Map(),
  };
  const scriptTitle = new Map<string, string>();
  for (const event of events) {
    const fields = event as Partial<Record<string, unknown>>;
    const sessionId = asText(fields.sessionId);
    const seriesId = asText(fields.seriesId);
    const scriptId = asText(fields.scriptId);
    if (event.name === "series-saved") setIfText(names.seriesName, seriesId, fields.seriesName);
    if (event.name === "session-created")
      setIfText(names.sessionName, sessionId, fields.sessionName);
    if (sessionId && seriesId && !names.seriesOfSession.has(sessionId)) {
      names.seriesOfSession.set(sessionId, seriesId);
    }
    if (event.name === "session-created" && seriesId)
      names.seriesOfSession.set(sessionId, seriesId);
    if (!sessionId || !scriptId) continue;
    const key = videoKey(sessionId, scriptId);
    if (event.name.startsWith("script-")) setIfText(scriptTitle, key, fields.title);
    if (event.name.startsWith("video-")) {
      setIfText(names.videoTitle, key, fields.title);
      if (typeof fields.rev === "number") names.rev.set(key, fields.rev);
    }
    if (event.name === "video-done") {
      names.latestDone.set(key, event);
      const finished = names.finishedOfSession.get(sessionId) ?? new Set<string>();
      finished.add(scriptId);
      names.finishedOfSession.set(sessionId, finished);
    }
  }
  const titleFallbacks = [
    ...scriptTitle,
    ...current.jobs.map((job) => [videoKey(job.sessionId, job.scriptId), job.title] as const),
    ...current.scripts.map((s) => [videoKey(s.sessionId, s.scriptId), s.title] as const),
  ];
  for (const [key, title] of titleFallbacks) {
    if (!names.videoTitle.has(key)) setIfText(names.videoTitle, key, title);
  }
  for (const job of current.jobs) finishFromJob(names, job);
  for (const session of workspace.sessions) {
    if (!names.seriesOfSession.has(session.id)) {
      names.seriesOfSession.set(session.id, session.seriesId);
    }
    if (!names.sessionName.has(session.id)) setIfText(names.sessionName, session.id, session.name);
  }
  for (const series of workspace.series) {
    if (!names.seriesName.has(series.id)) setIfText(names.seriesName, series.id, series.name);
  }
  return names;
}

function stepOf(line: UsageLine): string {
  for (const field of ["shot", "segment", "sound", "voice"] as const) {
    const value = line[field];
    if (typeof value === "string" || typeof value === "number") return `${field}:${value}`;
  }
  return "";
}

function outcomeOf(line: UsageLine, kind: CostKind, names: Names): CallOutcome {
  if (kind === "abandoned") return "abandoned";
  if (kind === "text-ai" || !line.sessionId || !line.scriptId) return "";
  const done = names.latestDone.get(videoKey(line.sessionId, line.scriptId));
  if (!done) return "unfinished";
  return line.requestId && done.usedRequestIds.includes(line.requestId) ? "used" : "redone";
}

const unitsText = (units: unknown) =>
  units === undefined || units === null
    ? ""
    : typeof units === "object"
      ? JSON.stringify(units)
      : String(units);

function callRow(line: UsageLine, names: Names): CallRow {
  const kind = costKind(line);
  const sessionId = asText(line.sessionId);
  const scriptId = asText(line.scriptId);
  const seriesId = names.seriesOfSession.get(sessionId) ?? "";
  return {
    at: asText(line.at),
    provider: asText(line.provider),
    purpose: asText(line.purpose),
    kind,
    endpointOrModel: asText(line.endpoint) || asText(line.model),
    billedUnits: unitsText(line.billedUnits),
    paidUsd: asNumber(line.cost),
    paid: typeof line.cost === "number",
    estimate: line.costIsEstimate === true,
    notionalUsd: asNumber(line.notionalCostUsd),
    durationMs: typeof line.durationMs === "number" ? line.durationMs : null,
    requestId: asText(line.requestId),
    seriesId,
    seriesName: names.seriesName.get(seriesId) ?? "",
    sessionId,
    sessionName: names.sessionName.get(sessionId) ?? "",
    scriptId,
    videoTitle:
      sessionId && scriptId ? (names.videoTitle.get(videoKey(sessionId, scriptId)) ?? "") : "",
    step: stepOf(line),
    outcome: outcomeOf(line, kind, names),
  };
}

interface Sums {
  paidUsd: number;
  byKind: Record<CostKind, number>;
  byOutcome: Record<(typeof OUTCOMES)[number], number>;
  paidCalls: number;
  notionalUsd: number;
}

const emptySums = (): Sums => ({
  paidUsd: 0,
  byKind: Object.fromEntries(COST_KINDS.map((k) => [k, 0])) as Record<CostKind, number>,
  byOutcome: Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Sums["byOutcome"],
  paidCalls: 0,
  notionalUsd: 0,
});

function add(sums: Sums, call: CallRow) {
  sums.paidUsd += call.paidUsd;
  sums.byKind[call.kind] += call.paidUsd;
  if (call.outcome) sums.byOutcome[call.outcome] += call.paidUsd;
  if (call.paid) sums.paidCalls += 1;
  sums.notionalUsd += call.notionalUsd;
}

const sumColumns = [
  "paid_usd",
  ...COST_KINDS.map((k) => `paid_${k}_usd`),
  ...OUTCOMES.map((o) => `${o}_usd`),
  "paid_calls",
];

const sumCells = (s: Sums): Cell[] => [
  s.paidUsd,
  ...COST_KINDS.map((k) => s.byKind[k]),
  ...OUTCOMES.map((o) => s.byOutcome[o]),
  s.paidCalls,
];

function grouped<T>(calls: readonly CallRow[], keyOf: (call: CallRow) => T): Map<T, CallRow[]> {
  const groups = new Map<T, CallRow[]>();
  for (const call of calls) {
    const key = keyOf(call);
    groups.set(key, [...(groups.get(key) ?? []), call]);
  }
  return groups;
}

const summed = (calls: readonly CallRow[]) => {
  const sums = emptySums();
  for (const call of calls) add(sums, call);
  return sums;
};

const perUnit = (usd: number, units: number) => (units > 0 ? usd / units : null);

const yes = (value: boolean) => (value ? "yes" : "no");

function callsTable(calls: readonly CallRow[]): Table {
  return {
    header: [
      "time",
      "provider",
      "purpose",
      "kind",
      "endpoint_or_model",
      "billed_units",
      "paid_usd",
      "estimate",
      "notional_usd",
      "duration_ms",
      "request_id",
      "series_id",
      "series_name",
      "session_id",
      "session_name",
      "script_id",
      "video_title",
      "step",
      "outcome",
    ],
    rows: calls.map((c) => [
      c.at,
      c.provider,
      c.purpose,
      c.kind,
      c.endpointOrModel,
      c.billedUnits,
      c.paidUsd,
      c.paid ? yes(c.estimate) : "",
      c.notionalUsd || null,
      c.durationMs,
      c.requestId,
      c.seriesId,
      c.seriesName,
      c.sessionId,
      c.sessionName,
      c.scriptId,
      c.videoTitle,
      c.step,
      c.outcome,
    ]),
  };
}

function videosTable(calls: readonly CallRow[], names: Names): Table {
  const videoCalls = grouped(
    calls.filter((c) => c.sessionId && c.scriptId),
    (c) => videoKey(c.sessionId, c.scriptId),
  );
  const rows = [...videoCalls].map(([key, own]): Cell[] => {
    const first = own[0] as CallRow;
    const done = names.latestDone.get(key);
    const sums = summed(own);
    const finalSec = done?.finalSec ?? null;
    return [
      first.seriesId,
      first.seriesName,
      first.sessionId,
      first.sessionName,
      first.scriptId,
      first.videoTitle,
      yes(Boolean(done)),
      done?.at ?? null,
      finalSec,
      done?.estimatedSec ?? null,
      names.rev.get(key) ?? null,
      ...sumCells(sums),
      done && finalSec ? perUnit(sums.paidUsd, finalSec) : null,
      ...TIMED_PHASES.map((p) => done?.phaseSec[p] ?? null),
      done?.totalSec ?? null,
      ...MISHAP_KINDS.map((k) => (done ? (done.mishaps[k] ?? 0) : null)),
      sums.notionalUsd,
    ];
  });
  return {
    header: [
      "series_id",
      "series_name",
      "session_id",
      "session_name",
      "script_id",
      "title",
      "finished",
      "done_at",
      "final_sec",
      "estimated_sec",
      "revision",
      ...sumColumns,
      "usd_per_finished_sec",
      ...TIMED_PHASES.map((p) => `${p}_sec`),
      "total_making_sec",
      ...MISHAP_KINDS.map((k) => `mishap_${k}`),
      "notional_text_ai_usd",
    ],
    rows,
  };
}

const scriptsWithSpend = (calls: readonly CallRow[]) =>
  new Set(
    calls.filter((c) => c.scriptId && c.paidUsd > 0).map((c) => `${c.sessionId}|${c.scriptId}`),
  ).size;

function finishedIn(sessionIds: readonly string[], names: Names) {
  return sessionIds.reduce((n, id) => n + (names.finishedOfSession.get(id)?.size ?? 0), 0);
}

const groupColumns = [
  "scripts_with_spend",
  "videos_finished",
  ...sumColumns,
  "usd_per_finished_video",
  "notional_text_ai_usd",
];

function groupCells(own: readonly CallRow[], finished: number): Cell[] {
  const sums = summed(own);
  return [
    scriptsWithSpend(own),
    finished,
    ...sumCells(sums),
    perUnit(sums.paidUsd, finished),
    sums.notionalUsd,
  ];
}

function batchesTable(calls: readonly CallRow[], names: Names): Table {
  const bySession = grouped(calls, (c) => c.sessionId);
  const rows = [...bySession]
    .sort(([a], [b]) => Number(a === "") - Number(b === ""))
    .map(([sessionId, own]): Cell[] => {
      const first = own[0] as CallRow;
      return sessionId
        ? [
            first.seriesId,
            first.seriesName,
            sessionId,
            first.sessionName,
            ...groupCells(own, finishedIn([sessionId], names)),
          ]
        : ["", "", "", NO_BATCH_LABEL, ...groupCells(own, 0)];
    });
  return {
    header: ["series_id", "series_name", "session_id", "session_name", ...groupColumns],
    rows,
  };
}

function seriesTable(calls: readonly CallRow[], names: Names): Table {
  const bySeries = grouped(calls, (c) => (c.sessionId ? `series|${c.seriesId}` : "none"));
  const rows = [...bySeries]
    .sort(([a], [b]) => Number(a === "none") - Number(b === "none"))
    .map(([key, own]): Cell[] => {
      const first = own[0] as CallRow;
      const sessions = [...new Set(own.map((c) => c.sessionId))];
      return key === "none"
        ? ["", NO_BATCH_LABEL, 0, ...groupCells(own, 0)]
        : [
            first.seriesId,
            first.seriesName,
            sessions.length,
            ...groupCells(own, finishedIn(sessions, names)),
          ];
    });
  return {
    header: ["series_id", "series_name", "batches_with_calls", ...groupColumns],
    rows,
  };
}

export interface CostReport {
  calls: Table;
  videos: Table;
  batches: Table;
  series: Table;
}

export function costReport(
  usage: readonly UsageLine[],
  events: readonly ActivityRecord[],
  workspace: Pick<Workspace, "series" | "sessions">,
  current: CurrentVideos,
): CostReport {
  const names = namesFrom(events, workspace, current);
  const calls = usage.map((line) => callRow(line, names));
  return {
    calls: callsTable(calls),
    videos: videosTable(calls, names),
    batches: batchesTable(calls, names),
    series: seriesTable(calls, names),
  };
}

const MONEY_DIGITS = 6;

function csvCell(cell: Cell): string {
  if (cell === null) return "";
  const text = typeof cell === "number" ? String(Number(cell.toFixed(MONEY_DIGITS))) : String(cell);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const BYTE_ORDER_MARK = "﻿";

export const toCsv = (table: Table) =>
  BYTE_ORDER_MARK +
  [table.header, ...table.rows].map((row) => row.map(csvCell).join(",")).join("\r\n") +
  "\r\n";
