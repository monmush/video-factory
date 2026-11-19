import {
  type JobFrame,
  type JobShot,
  type JobStep,
  plannedFrame,
  type VideoJob,
} from "./video-job";

// Closing or restarting the app during a paid step never pays twice
// (src/main/fal.ts). fal writes nothing back to job.json; the app does, a few
// milliseconds after fal accepts a request, and requests.jsonl gets the
// request first. A restart in between used to send the step again.
//
// So each still or shot is marked in job.json before anything is sent (a
// fresh `sending` mark per attempt), and the request's record in
// requests.jsonl carries the same mark (`attempt`). On start, a request with
// that mark, no result logged and no place in job.json is attached to its
// still or shot, which is then polled instead of sent again. A mark only
// ever stands for one attempt with one input: anything that changes the
// input (a remade still, a new plan, a fix, a failed attempt) drops it, and a
// record without a mark (written before 19 Nov 2026) is never attached.
// Pure, so tests and the runner share it.

/** One line of requests.jsonl (a paid request fal accepted), or a failure marker. */
export interface RequestRecord {
  at: string;
  requestId: string;
  provider?: string;
  endpoint?: string;
  purpose?: string;
  sessionId?: string;
  scriptId?: string;
  /** Stills: the job frame id ("kf:master", "wide", ...). */
  frame?: string;
  /** Shots: the shot index. */
  shot?: number;
  /** The `sending` mark saved in job.json for this attempt. */
  attempt?: string;
  /** Fixed-pipeline shots: the speaking model it was sent to. */
  model?: string;
  /** Product cut-outs: the product, its photo and that photo's file when sent. */
  productId?: string;
  photoId?: string;
  photoFile?: string;
  /** The provider reported that this request failed (nothing charged). */
  failed?: boolean;
}

/** JSON lines, one object per line; lines that do not parse (a write cut off) are skipped. */
export function parseLines<T>(text: string): T[] {
  const out: T[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // A line cut off by a crash: nothing to read from it.
    }
  }
  return out;
}

/**
 * Requests fal accepted whose outcome the app never read: no result in
 * usage.jsonl and no failure marker in requests.jsonl.
 */
export function openRequests(
  requests: readonly RequestRecord[],
  usage: readonly { requestId?: string }[],
): RequestRecord[] {
  const settled = new Set<string>();
  for (const u of usage) if (u.requestId) settled.add(u.requestId);
  for (const r of requests) if (r.failed) settled.add(r.requestId);
  return requests.filter((r) => !r.failed && r.requestId && !settled.has(r.requestId));
}

/** The latest of several records (by `at`), or undefined. */
const latest = (records: RequestRecord[]) =>
  records.reduce<RequestRecord | undefined>(
    (best, r) => (!best || r.at.localeCompare(best.at) > 0 ? r : best),
    undefined,
  );

/** Marks a still or shot as being sent with `attempt` (saved before anything is paid). */
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

/** A still that would be sent again on start: nothing on disk, no request saved. */
const frameOpen = (f: JobFrame) => !f.file && !f.requestId && !f.resultUrl;
/** A shot that would be sent again on start. */
const shotOpen = (s: JobShot) =>
  (s.state === "queued" || s.state === "stopped") && !s.requestId && !s.clip && !s.resultUrl;

export interface Reconciled {
  job: VideoJob;
  /** What was attached, for the log: "kf:master ← <request id>". */
  attached: string[];
}

/**
 * The job with every request it lost attached. Only a record whose `attempt`
 * equals the still's or shot's saved `sending` mark counts, from this job's
 * session and script, for that same still or shot, and only while that still
 * or shot would otherwise be sent again. Several fitting records: the latest.
 * Marks with no record (the app closed before fal accepted) are dropped, so
 * the step is simply sent.
 */
export function reconcileJob(job: VideoJob, open: readonly RequestRecord[]): Reconciled {
  const known = new Set<string>();
  for (const f of job.frames) if (f.requestId) known.add(f.requestId);
  for (const s of job.shots) if (s.requestId) known.add(s.requestId);
  const mine = open.filter(
    (r) =>
      r.sessionId === job.sessionId &&
      r.scriptId === job.scriptId &&
      r.attempt &&
      !known.has(r.requestId),
  );
  const attached: string[] = [];
  let changed = false;

  const frames = job.frames.map((f): JobFrame => {
    if (!f.sending) return f;
    changed = true;
    const { sending, ...rest } = f;
    if (!frameOpen(f)) return rest;
    const record = latest(
      mine.filter((r) => r.purpose === "video-frame" && r.frame === f.id && r.attempt === sending),
    );
    if (!record) return rest;
    // A planned keyframe is polled at the endpoint it went to; without it, unknown.
    const planned = plannedFrame(job, f);
    if (planned && !record.endpoint) return rest;
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
    if (!shotOpen(s)) return rest;
    const record = latest(
      mine.filter((r) => r.purpose === "video-shot" && r.shot === s.index && r.attempt === sending),
    );
    if (!record) return rest;
    // Planned shots are polled at their endpoint; fixed ones at their model's.
    const planned = Boolean(job.live && s.route && !s.fallback);
    if (planned ? !record.endpoint : !record.model) return rest;
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

/**
 * A product cut-out fal accepted that was never read: the latest open record
 * for this product's photo, sent from the same photo file. Records without a
 * photo id (the product dialog, and before 19 Nov 2026) never match.
 */
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
