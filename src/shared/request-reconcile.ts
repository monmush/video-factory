import {
  type JobFrame,
  type JobShot,
  type JobStep,
  plannedFrame,
  type VideoJob,
} from "./video-job";

export interface RequestRecord {
  at: string;
  requestId: string;
  provider?: string;
  endpoint?: string;
  purpose?: string;
  sessionId?: string;
  scriptId?: string;
  frame?: string;
  shot?: number;
  attempt?: string;
  model?: string;
  productId?: string;
  photoId?: string;
  photoFile?: string;
  failed?: boolean;
}

function parseLineCutOffByACrashAsNothing<T>(line: string): T[] {
  try {
    return [JSON.parse(line) as T];
  } catch {
    return [];
  }
}

export const parseLines = <T>(text: string): T[] =>
  text
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => parseLineCutOffByACrashAsNothing<T>(line));

export function openRequests(
  requests: readonly RequestRecord[],
  usage: readonly { requestId?: string }[],
): RequestRecord[] {
  const settled = new Set<string>();
  for (const u of usage) if (u.requestId) settled.add(u.requestId);
  for (const r of requests) if (r.failed) settled.add(r.requestId);
  return requests.filter((r) => !r.failed && r.requestId && !settled.has(r.requestId));
}

const latest = (records: RequestRecord[]) =>
  records.reduce<RequestRecord | undefined>(
    (best, r) => (!best || r.at.localeCompare(best.at) > 0 ? r : best),
    undefined,
  );

export function withSending(job: VideoJob, step: JobStep, attempt: string): VideoJob {
  if ("frame" in step) {
    return {
      ...job,
      frames: job.frames.map((f) => (f.id === step.frame ? { ...f, sending: attempt } : f)),
    };
  }
  return {
    ...job,
    shots: job.shots.map((s) => (s.index === step.shot ? { ...s, sending: attempt } : s)),
  };
}

const frameWouldBeSentAgain = (f: JobFrame) => !f.file && !f.requestId && !f.resultUrl;
const shotWouldBeSentAgain = (s: JobShot) =>
  (s.state === "queued" || s.state === "stopped") && !s.requestId && !s.clip && !s.resultUrl;

export interface Reconciled {
  job: VideoJob;
  attached: string[];
}

export function reconcileJob(job: VideoJob, open: readonly RequestRecord[]): Reconciled {
  const known = new Set<string>();
  for (const f of job.frames) if (f.requestId) known.add(f.requestId);
  for (const s of job.shots) if (s.requestId) known.add(s.requestId);
  const carriesAnAttemptMark = (r: RequestRecord) => Boolean(r.attempt);
  const mine = open.filter(
    (r) =>
      r.sessionId === job.sessionId &&
      r.scriptId === job.scriptId &&
      carriesAnAttemptMark(r) &&
      !known.has(r.requestId),
  );
  const attached: string[] = [];
  let changed = false;

  const frames = job.frames.map((f): JobFrame => {
    if (!f.sending) return f;
    changed = true;
    const { sending, ...rest } = f;
    if (!frameWouldBeSentAgain(f)) return rest;
    const record = latest(
      mine.filter((r) => r.purpose === "video-frame" && r.frame === f.id && r.attempt === sending),
    );
    if (!record) return rest;
    const planned = plannedFrame(job, f);
    const pollEndpointUnknown = planned && !record.endpoint;
    if (pollEndpointUnknown) return rest;
    attached.push(`${f.id} ← ${record.requestId}`);
    return {
      ...rest,
      requestId: record.requestId,
      submittedAt: record.at,
      ...(planned ? { endpoint: record.endpoint } : {}),
    };
  });

  const shots = job.shots.map((s): JobShot => {
    if (!s.sending) return s;
    changed = true;
    const { sending, ...rest } = s;
    if (!shotWouldBeSentAgain(s)) return rest;
    const record = latest(
      mine.filter((r) => r.purpose === "video-shot" && r.shot === s.index && r.attempt === sending),
    );
    if (!record) return rest;
    const planned = Boolean(job.live && s.route && !s.fallback);
    const pollEndpointUnknown = planned ? !record.endpoint : !record.model;
    if (pollEndpointUnknown) return rest;
    attached.push(`shot ${s.index} ← ${record.requestId}`);
    return {
      ...rest,
      state: "rendering",
      requestId: record.requestId,
      submittedAt: record.at,
      ...(planned ? { endpoint: record.endpoint } : { model: record.model }),
    };
  });

  return changed ? { job: { ...job, frames, shots }, attached } : { job, attached };
}

export function openCutout(
  open: readonly RequestRecord[],
  productId: string,
  photoId: string,
  photoFile: string,
): RequestRecord | undefined {
  return latest(
    open.filter(
      (r) =>
        r.purpose === "product-cutout" &&
        r.productId === productId &&
        r.photoId === photoId &&
        r.photoFile === photoFile,
    ),
  );
}
