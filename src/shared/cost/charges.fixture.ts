import type { VideoJob } from "../video-job";
import { matchCharges, redoneCharges, withCharge } from "./charges";

const AT = "2026-11-20T10:00:00.000Z";

export const withInUsePaid = <J extends VideoJob>(job: J): J =>
  matchCharges(job).unpaid.reduce(
    (j, item) =>
      withCharge(j, {
        at: AT,
        kind: item.kind,
        step: item.step,
        usd: item.usd as number,
        billed: item.billed,
        ...(item.requestId ? { requestId: item.requestId } : {}),
      }),
    job,
  );

export const redoneUsd = (job: VideoJob) => redoneCharges(job).reduce((n, c) => n + c.usd, 0);
