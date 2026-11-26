import { frameUsd, inFlightUsd, shotEstimateUsd } from "./cost/estimate";
import { VOICE_SAMPLE_USD } from "./cost/rates";
import { formatCost } from "./credits";
import { asksUsd, soundInFlight } from "./sound";
import { segmentEstimateUsd } from "./speech";
import { actionKey, type JobStep, jobSoundSource, type VideoJob, videoModelOf } from "./video-job";
import { voiceInFlight } from "./voice-step";

export interface PaidWork {
  videos: number;
  requests: number;
  usd: number;
}

export interface SentRequest {
  step: JobStep;
  requestId: string;
  usd: number | null;
}

export const makingVideo = (job: Pick<VideoJob, "status">) =>
  job.status === "running" || job.status === "waiting";

const awaitedRequest = (s: { requestId?: string; resultUrl?: string }) =>
  s.resultUrl ? undefined : s.requestId;

function sent<T extends { requestId?: string; resultUrl?: string }>(
  items: readonly T[],
  step: (item: T) => JobStep,
  usd: (item: T) => number | null,
): SentRequest[] {
  return items.flatMap((item) => {
    const requestId = awaitedRequest(item);
    return requestId ? [{ step: step(item), requestId, usd: usd(item) }] : [];
  });
}

export const sentRequests = (job: VideoJob): SentRequest[] => [
  ...sent(
    job.frames.filter((f) => !f.file),
    (f) => ({ frame: f.id }),
    () => frameUsd(job),
  ),
  ...sent(
    job.shots.filter((s) => s.state === "rendering"),
    (s) => ({ shot: s.index }),
    (s) => shotEstimateUsd(job, s),
  ),
  ...sent(
    (job.segments ?? []).filter((s) => s.state === "rendering"),
    (s) => ({ segment: s.id }),
    (s) => segmentEstimateUsd(videoModelOf(job), s),
  ),
  ...sent(
    (job.sounds ?? []).filter(soundInFlight),
    (s) => ({ sound: s.id }),
    (s) => asksUsd(jobSoundSource(job), [s]),
  ),
  ...sent(
    (job.voices ?? []).filter(voiceInFlight),
    (v) => ({ voice: v.characterId }),
    () => VOICE_SAMPLE_USD,
  ),
];

export const stepKey = (step: JobStep) =>
  actionKey(
    "frame" in step
      ? { kind: "poll-frame", frame: step.frame }
      : "shot" in step
        ? { kind: "poll-shot", index: step.shot }
        : "segment" in step
          ? { kind: "poll-segment", segment: step.segment }
          : "voice" in step
            ? { kind: "poll-voice", voice: step.voice }
            : { kind: "poll-sound", sound: step.sound },
  );

const beingSent = <T extends { sending?: string }>(
  items: readonly T[],
  step: (item: T) => JobStep,
) => items.filter((item) => item.sending).map(step);

export function stepsOut(job: VideoJob): JobStep[] {
  const steps = [
    ...sentRequests(job).map((r) => r.step),
    ...beingSent(job.frames, (f) => ({ frame: f.id })),
    ...beingSent(job.shots, (s) => ({ shot: s.index })),
    ...beingSent(job.segments ?? [], (s) => ({ segment: s.id })),
    ...beingSent(job.sounds ?? [], (s) => ({ sound: s.id })),
    ...beingSent(job.voices ?? [], (v) => ({ voice: v.characterId })),
  ];
  return [...new Map(steps.map((step) => [stepKey(step), step])).values()];
}

export const sentRequestOf = (job: VideoJob, step: JobStep) =>
  sentRequests(job).find((r) => stepKey(r.step) === stepKey(step)) ?? null;

export function paidWork(jobs: readonly VideoJob[]): PaidWork {
  return jobs.reduce(
    (work, job) => ({
      videos: work.videos + (makingVideo(job) ? 1 : 0),
      requests: work.requests + sentRequests(job).length,
      usd: work.usd + inFlightUsd(job),
    }),
    { videos: 0, requests: 0, usd: 0 },
  );
}

export function videosBeingMade(jobs: readonly VideoJob[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const job of jobs.filter(makingVideo)) {
    counts[job.sessionId] = (counts[job.sessionId] ?? 0) + 1;
  }
  return counts;
}

export interface Confirmation {
  message: string;
  detail: string;
}

const owed = (usd: number) => `~${formatCost(usd)}`;

export function quitConfirmation(work: PaidWork, blockingCalls: number): Confirmation | null {
  if (!work.videos && !work.requests && !blockingCalls) return null;
  const sentences = [
    work.requests
      ? `${work.requests} yêu cầu đã gửi vẫn chạy và vẫn tính tiền (${owed(work.usd)}).`
      : null,
    work.videos || work.requests
      ? "Mở lại ứng dụng để nhận kết quả và tạo tiếp phần còn lại."
      : null,
    blockingCalls ? `${blockingCalls} bước đang tạo sẽ mất nếu thoát bây giờ.` : null,
  ];
  return {
    message: work.videos ? `Đang tạo ${work.videos} video` : "Đang tạo dở",
    detail: sentences.filter(Boolean).join(" "),
  };
}

export function windowCloseConfirmation(blockingCalls: number): Confirmation | null {
  if (!blockingCalls) return null;
  return {
    message: "Đang tạo dở",
    detail: `${blockingCalls} bước đang tạo sẽ mất nếu đóng cửa sổ bây giờ.`,
  };
}

export const stillOwedHint = (usd: number) =>
  usd > 0 ? `· vẫn trả tối đa ${owed(usd)}` : undefined;

export function deleteWarning(work: PaidWork): string | null {
  if (!work.videos && !work.requests) return null;
  const making = `Đang tạo ${work.videos} video`;
  if (!work.requests) return `${making}, sẽ dừng lại.`;
  const lost = `${work.requests} yêu cầu đã gửi vẫn tính tiền (${owed(work.usd)}), kết quả sẽ mất.`;
  return work.videos ? `${making}. ${lost}` : lost;
}
