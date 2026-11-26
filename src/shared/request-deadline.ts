export const STILL_DEADLINE_MS = 30 * 60_000;
export const CLIP_DEADLINE_MS = 90 * 60_000;
export const CUTOUT_DEADLINE_MS = 20 * 60_000;
export const SOUND_DEADLINE_MS = 10 * 60_000;
export const VOICE_DEADLINE_MS = 10 * 60_000;

export type RequestKind = "still" | "clip" | "cutout" | "sound" | "voice";

const DEADLINES: Record<RequestKind, number> = {
  still: STILL_DEADLINE_MS,
  clip: CLIP_DEADLINE_MS,
  cutout: CUTOUT_DEADLINE_MS,
  sound: SOUND_DEADLINE_MS,
  voice: VOICE_DEADLINE_MS,
};

export function requestOverdue(
  kind: RequestKind,
  submittedAt: string | undefined,
  nowMs: number,
): boolean {
  const sent = submittedAt ? Date.parse(submittedAt) : Number.NaN;
  return Number.isFinite(sent) && nowMs - sent > DEADLINES[kind];
}

export const timedOutMessage = (kind: RequestKind) =>
  `Quá ${Math.round(DEADLINES[kind] / 60_000)} phút không có kết quả, đã hủy yêu cầu`;

const GONE_STATUS = new Set([401, 403, 404, 410]);

export function downloadFailedMessage(status: number | undefined): string {
  if (status !== undefined && GONE_STATUS.has(status)) {
    return "Kết quả đã trả tiền nhưng liên kết tải đã hết hạn, không tải được nữa";
  }
  return status === undefined
    ? "Không tải được kết quả đã trả tiền"
    : `Không tải được kết quả đã trả tiền (lỗi ${status})`;
}

export const unreadableResultMessage = (reason: string) =>
  `Kết quả tải về không dùng được: ${reason}`;
