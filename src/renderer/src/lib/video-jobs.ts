import type { StepAverages, VideoJob } from "@shared/video-job";
import { useEffect, useState, useSyncExternalStore } from "react";
import { api } from "./api";
import { errorMessage } from "./errors";

type SessionJobs = { jobs: Map<string, VideoJob>; averages: StepAverages };
const sessions = new Map<string, SessionJobs>();
const loading = new Set<string>();
const failures = new Map<string, string>();
const pushedWhileLoading = new Map<string, Map<string, VideoJob>>();
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
  if (!current) {
    if (loading.has(job.sessionId)) {
      const newerThanLoad = pushedWhileLoading.get(job.sessionId) ?? new Map<string, VideoJob>();
      newerThanLoad.set(job.scriptId, job);
      pushedWhileLoading.set(job.sessionId, newerThanLoad);
    }
    return;
  }
  const jobs = new Map(current.jobs);
  jobs.set(job.scriptId, job);
  sessions.set(job.sessionId, { jobs, averages });
  emit();
});

api.on("video:job-removed", ({ sessionId, scriptId }) => {
  pushedWhileLoading.get(sessionId)?.delete(scriptId);
  const current = sessions.get(sessionId);
  if (!current?.jobs.has(scriptId)) return;
  const jobs = new Map(current.jobs);
  jobs.delete(scriptId);
  sessions.set(sessionId, { ...current, jobs });
  emit();
});

function load(sessionId: string) {
  if (sessions.has(sessionId) || loading.has(sessionId)) return;
  loading.add(sessionId);
  if (failures.delete(sessionId)) emit();
  api
    .invoke("video:jobs", sessionId)
    .then(({ jobs, averages }) => {
      const map = new Map(jobs.map((j) => [j.scriptId, j]));
      for (const [id, job] of pushedWhileLoading.get(sessionId) ?? []) map.set(id, job);
      pushedWhileLoading.delete(sessionId);
      sessions.set(sessionId, { jobs: map, averages });
      emit();
    })
    .catch((error) => {
      failures.set(sessionId, errorMessage(error));
      emit();
    })
    .finally(() => loading.delete(sessionId));
}

export const reloadVideoJobs = (sessionId: string) => load(sessionId);

export const useVideoJobsError = (sessionId: string) =>
  useSyncExternalStore(subscribe, () => failures.get(sessionId) ?? null);

export function useVideoJobs(sessionId: string): SessionJobs | null {
  const value = useSyncExternalStore(subscribe, () => sessions.get(sessionId) ?? null);
  useEffect(() => load(sessionId), [sessionId]);
  return value;
}

export function useNow(active: boolean, everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs]);
  return now;
}

const dialoguesPlayedOnce = new Set<string>();
export const markHeard = (key: string) => {
  dialoguesPlayedOnce.add(key);
  emit();
};
export const useHeard = (key: string) =>
  useSyncExternalStore(subscribe, () => dialoguesPlayedOnce.has(key));
