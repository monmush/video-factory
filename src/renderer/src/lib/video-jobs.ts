import type { StepAverages, VideoJob } from "@shared/video-job";
import { useEffect, useState, useSyncExternalStore } from "react";
import { api } from "./api";

// Video jobs as last pushed by the main process ("video:job"). Jobs run in
// the main process; this is only a view of them, so leaving the screen
// changes nothing.

type SessionJobs = { jobs: Map<string, VideoJob>; averages: StepAverages };
const sessions = new Map<string, SessionJobs>();
const loading = new Set<string>();
const pending = new Map<string, Map<string, VideoJob>>();
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

api.on("video:job", ({ job, averages }) => {
  const current = sessions.get(job.sessionId);
  // Not loaded yet: the first load fetches every job. Keeping only this push
  // would make the session look loaded with one job; while loading, it is
  // kept aside and wins over the fetched copy (it is newer).
  if (!current) {
    if (loading.has(job.sessionId)) {
      const aside = pending.get(job.sessionId) ?? new Map<string, VideoJob>();
      aside.set(job.scriptId, job);
      pending.set(job.sessionId, aside);
    }
    return;
  }
  const jobs = new Map(current.jobs);
  jobs.set(job.scriptId, job);
  sessions.set(job.sessionId, { jobs, averages });
  emit();
});

function load(sessionId: string) {
  if (sessions.has(sessionId) || loading.has(sessionId)) return;
  loading.add(sessionId);
  api
    .invoke("video:jobs", sessionId)
    .then(({ jobs, averages }) => {
      const map = new Map(jobs.map((j) => [j.scriptId, j]));
      for (const [id, job] of pending.get(sessionId) ?? []) map.set(id, job);
      pending.delete(sessionId);
      sessions.set(sessionId, { jobs: map, averages });
      emit();
    })
    .catch(console.error)
    .finally(() => loading.delete(sessionId));
}

/** The session's video jobs by script id; null until loaded. */
export function useVideoJobs(sessionId: string): SessionJobs | null {
  const value = useSyncExternalStore(subscribe, () => sessions.get(sessionId) ?? null);
  useEffect(() => load(sessionId), [sessionId]);
  return value;
}

/** Current time, ticking while `active`, for "còn ~N phút". */
export function useNow(active: boolean, everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs]);
  return now;
}

// Dialogues the operator has played, so the play button stops pulsing.
const heard = new Set<string>();
export const markHeard = (key: string) => {
  heard.add(key);
  emit();
};
export const useHeard = (key: string) => useSyncExternalStore(subscribe, () => heard.has(key));
