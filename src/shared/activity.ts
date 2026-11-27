import { type ChargeKind, cutCostUsd, matchCharges, spentUsd } from "./cost/charges";
import type { Script, ScriptLine } from "./ipc";
import type { Mishap, MishapKind } from "./mishaps";
import type { JobModels, SeriesModels } from "./models";
import { promisedSec, scriptSeconds } from "./pace";
import { totalSec } from "./phase-clock";
import { jobTempo } from "./tempo";
import {
  type JobPhase,
  type JobStatus,
  jobPhase,
  liveSeconds,
  modelsOf,
  type TimedPhase,
  type VideoJob,
} from "./video-job";

export type CrashKind =
  | "uncaught-exception"
  | "unhandled-rejection"
  | "renderer-gone"
  | "child-gone";

export type ChatTurnOutcome = "done" | "stopped" | "error";

export type MishapPlace = "frame" | "shot" | "segment";

interface VideoRef {
  sessionId: string;
  scriptId: string;
  seriesId: string;
  rev: number;
}

interface ScriptRef {
  sessionId: string;
  scriptId: string;
  title: string;
  lineCount: number;
  estimatedSec: number;
}

export type ActivityEvent =
  | {
      name: "app-start";
      install: string;
      version: string;
      platform: string;
      arch: string;
      os: string;
      packaged: boolean;
      mode: string;
      electron: string;
    }
  | { name: "app-quit" }
  | {
      name: "crash";
      kind: CrashKind;
      message: string;
      reason?: string;
      exitCode?: number;
      process?: string;
    }
  | { name: "renderer-error"; message: string }
  | { name: "window"; state: "focus" | "blur" }
  | { name: "screen"; route: string; params: Record<string, string> }
  | {
      name: "action";
      channel: string;
      ms: number;
      ok: boolean;
      error?: string;
      sessionId?: string;
      scriptId?: string;
      seriesId?: string;
    }
  | {
      name: "series-saved";
      created: boolean;
      seriesId: string;
      seriesName: string;
      guidance: string;
      direction: string;
      targetSec: number;
      models?: SeriesModels;
      characters: number;
      products: number;
      places: number;
    }
  | {
      name: "session-created";
      sessionId: string;
      seriesId: string;
      sessionName: string;
      request: string;
    }
  | { name: "chat-message"; sessionId: string; text: string; attachments: number }
  | { name: "chat-turn"; sessionId: string; ms: number; outcome: ChatTurnOutcome }
  | ({ name: "script-added" | "script-changed"; text: string } & ScriptRef)
  | ({ name: "script-removed" } & ScriptRef)
  | ({
      name: "video-staged";
      title: string;
      frames: number;
      shots: number;
      segments: number;
      reusedFrames: number;
      reusedShots: number;
      plannedSec: number;
    } & VideoRef)
  | ({
      name: "video-started";
      title: string;
      text: string;
      lineCount: number;
      estimatedSec: number | null;
      models: JobModels;
    } & VideoRef)
  | ({
      name: "video-phase";
      left: JobPhase;
      entered: JobPhase;
      leftSec: number | null;
      spentUsd: number;
    } & VideoRef)
  | ({
      name: "video-mishap";
      kind: MishapKind;
      model?: string;
      place: MishapPlace;
      index: number;
      id?: string;
    } & VideoRef)
  | ({
      name: "video-status";
      from: JobStatus;
      to: JobStatus;
      phase: JobPhase;
      offline?: boolean;
      error?: string;
    } & VideoRef)
  | ({ name: "video-revised"; fromRev: number } & VideoRef)
  | ({
      name: "video-done";
      title: string;
      finalSec: number | null;
      tempo: number;
      estimatedSec: number | null;
      phaseSec: Partial<Record<TimedPhase, number>>;
      totalSec: number;
      spentUsd: number;
      costByKind: Partial<Record<ChargeKind, number>>;
      cutCostUsd: number;
      usedRequestIds: string[];
      mishaps: Partial<Record<MishapKind, number>>;
      autoRedos: number;
      frames: number;
      shots: number;
      segments: number;
      models: JobModels;
    } & VideoRef)
  | ({ name: "video-removed" } & VideoRef);

export type ActivityName = ActivityEvent["name"];

export type ActivityRecord = { at: string; run: string } & ActivityEvent;

export const linesText = (lines: readonly ScriptLine[]) =>
  lines.map((l) => (l.speaker ? `${l.speaker}: ${l.text}` : l.text)).join("\n");

const videoRef = (job: VideoJob): VideoRef => ({
  sessionId: job.sessionId,
  scriptId: job.scriptId,
  seriesId: job.seriesId,
  rev: job.rev ?? 0,
});

const isActive = (status: JobStatus) => status === "running" || status === "waiting";

const stagingOf = (job: VideoJob) => job.live ?? job.plan;

function staged(job: VideoJob): ActivityEvent {
  return {
    name: "video-staged",
    ...videoRef(job),
    title: job.title,
    frames: job.frames.length,
    shots: job.shots.length,
    segments: job.segments?.length ?? 0,
    reusedFrames: job.frames.filter((f) => f.source === "material" || f.material).length,
    reusedShots: job.shots.filter((s) => s.materialClip || s.reused).length,
    plannedSec: job.shots.reduce((n, s) => n + liveSeconds(job, s), 0),
  };
}

function started(job: VideoJob): ActivityEvent {
  return {
    name: "video-started",
    ...videoRef(job),
    title: job.title,
    text: linesText(job.lines),
    lineCount: job.lines.length,
    estimatedSec: promisedSec(job),
    models: modelsOf(job),
  };
}

interface MishapHolder {
  place: MishapPlace;
  index: number;
  id?: string;
  mishaps: readonly Mishap[];
}

function holders(job: VideoJob): MishapHolder[] {
  return [
    ...job.frames.map((f, index) => ({
      place: "frame" as const,
      index,
      id: f.id,
      mishaps: f.mishaps ?? [],
    })),
    ...job.shots.map((s) => ({ place: "shot" as const, index: s.index, mishaps: s.mishaps ?? [] })),
    ...(job.segments ?? []).map((s, index) => ({
      place: "segment" as const,
      index,
      id: s.id,
      mishaps: s.mishaps ?? [],
    })),
  ];
}

const holderKey = (h: Pick<MishapHolder, "place" | "index" | "id">) =>
  `${h.place}|${h.id ?? h.index}`;
const mishapKey = (m: Mishap) => `${m.kind}|${m.at}|${m.model ?? ""}`;

function newMishaps(before: VideoJob | null, after: VideoJob): ActivityEvent[] {
  const seen = new Map<string, Map<string, number>>();
  for (const h of before ? holders(before) : []) {
    const counts = new Map<string, number>();
    for (const m of h.mishaps) counts.set(mishapKey(m), (counts.get(mishapKey(m)) ?? 0) + 1);
    seen.set(holderKey(h), counts);
  }
  const events: ActivityEvent[] = [];
  for (const h of holders(after)) {
    const counts = seen.get(holderKey(h)) ?? new Map<string, number>();
    for (const m of h.mishaps) {
      const left = counts.get(mishapKey(m)) ?? 0;
      if (left > 0) {
        counts.set(mishapKey(m), left - 1);
        continue;
      }
      events.push({
        name: "video-mishap",
        ...videoRef(after),
        kind: m.kind,
        ...(m.model ? { model: m.model } : {}),
        place: h.place,
        index: h.index,
        ...(h.id ? { id: h.id } : {}),
      });
    }
  }
  return events;
}

function countBy<K extends string>(keys: readonly K[]): Partial<Record<K, number>> {
  const counts: Partial<Record<K, number>> = {};
  for (const key of keys) counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}

function costByKind(job: VideoJob): Partial<Record<ChargeKind, number>> {
  const sums: Partial<Record<ChargeKind, number>> = {};
  for (const c of job.charges ?? []) sums[c.kind] = (sums[c.kind] ?? 0) + c.usd;
  return sums;
}

function usedRequestIds(job: VideoJob): string[] {
  const { redone } = matchCharges(job);
  return (job.charges ?? [])
    .filter((c) => !redone.includes(c))
    .flatMap((c) => (c.requestId ? [c.requestId] : []));
}

export type VideoDoneEvent = Extract<ActivityEvent, { name: "video-done" }>;

export function videoDoneEvent(job: VideoJob): VideoDoneEvent {
  const phaseSec = job.phaseSec ?? {};
  return {
    name: "video-done",
    ...videoRef(job),
    title: job.title,
    finalSec: job.finalSec ?? null,
    tempo: jobTempo(job),
    estimatedSec: promisedSec(job),
    phaseSec,
    totalSec: totalSec(phaseSec),
    spentUsd: spentUsd(job),
    costByKind: costByKind(job),
    cutCostUsd: cutCostUsd(job),
    usedRequestIds: usedRequestIds(job),
    mishaps: countBy(holders(job).flatMap((h) => h.mishaps.map((m) => m.kind))),
    autoRedos: job.autoRedos ?? 0,
    frames: job.frames.length,
    shots: job.shots.length,
    segments: job.segments?.length ?? 0,
    models: modelsOf(job),
  };
}

function statusChange(before: VideoJob, after: VideoJob): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  const startedNow = isActive(after.status) && before.status === "idle";
  if (before.status !== after.status && after.status !== "done" && !startedNow) {
    events.push({
      name: "video-status",
      ...videoRef(after),
      from: before.status,
      to: after.status,
      phase: jobPhase(after),
      ...(after.error ? { error: after.error } : {}),
    });
  }
  if (Boolean(before.offline) !== Boolean(after.offline)) {
    events.push({
      name: "video-status",
      ...videoRef(after),
      from: before.status,
      to: after.status,
      phase: jobPhase(after),
      offline: Boolean(after.offline),
      ...(after.offline ? { error: after.offline.error } : {}),
    });
  }
  return events;
}

export function jobEvents(before: VideoJob | null, after: VideoJob): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  const revised = before !== null && (before.rev ?? 0) !== (after.rev ?? 0);
  if (revised) events.push({ name: "video-revised", ...videoRef(after), fromRev: before.rev ?? 0 });
  if (stagingOf(after) && stagingOf(after) !== (before && stagingOf(before))) {
    events.push(staged(after));
  }
  const startedNow =
    isActive(after.status) && (before === null || before.status === "idle" || revised);
  if (startedNow) events.push(started(after));
  if (before && after.status !== "idle" && jobPhase(before) !== jobPhase(after)) {
    const left = jobPhase(before);
    events.push({
      name: "video-phase",
      ...videoRef(after),
      left,
      entered: jobPhase(after),
      leftSec: left === "done" ? null : (after.phaseSec?.[left] ?? null),
      spentUsd: spentUsd(after),
    });
  }
  events.push(...newMishaps(before, after));
  if (before) events.push(...statusChange(before, after));
  if (after.status === "done" && before?.status !== "done") events.push(videoDoneEvent(after));
  return events;
}

export const jobRemoved = (job: VideoJob): ActivityEvent => ({
  name: "video-removed",
  ...videoRef(job),
});

const onBoard = (script: Script) => !script.deletedAt && script.lines.length > 0;

const scriptShape = (script: Script) => JSON.stringify([script.title, script.lines]);

export function scriptEvents(
  sessionId: string,
  before: readonly Script[],
  after: readonly Script[],
  seriesTargetSec: number,
): ActivityEvent[] {
  const ref = (script: Script): ScriptRef => ({
    sessionId,
    scriptId: script.id,
    title: script.title,
    lineCount: script.lines.length,
    estimatedSec: scriptSeconds(script, seriesTargetSec),
  });
  const was = new Map(before.filter(onBoard).map((s) => [s.id, s]));
  const now = new Map(after.filter(onBoard).map((s) => [s.id, s]));
  const events: ActivityEvent[] = [];
  for (const script of now.values()) {
    const old = was.get(script.id);
    if (old && scriptShape(old) === scriptShape(script)) continue;
    events.push({
      name: old ? "script-changed" : "script-added",
      ...ref(script),
      text: linesText(script.lines),
    });
  }
  for (const script of was.values()) {
    if (!now.has(script.id)) events.push({ name: "script-removed", ...ref(script) });
  }
  return events;
}
