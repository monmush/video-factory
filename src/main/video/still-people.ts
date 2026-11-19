import type { JobFrame } from "../../shared/video-job";

export function characterPeopleProblem(
  frame: Pick<JobFrame, "people" | "framing">,
  seen: number | undefined,
): string | null {
  if (seen === undefined) return null;
  if (frame.people) {
    return seen < 1 || seen > frame.people ? `${seen} people, should be ${frame.people}` : null;
  }
  return !/shoulder/i.test(frame.framing ?? "") && seen !== 1 ? `${seen} people` : null;
}
