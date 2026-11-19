import type { JobFrame } from "../../shared/video-job";

// The people count of a character still (checks.ts), pure so it is tested.

/** What is wrong with the number of people seen in a character still, or null. */
export function characterPeopleProblem(
  frame: Pick<JobFrame, "people" | "framing">,
  seen: number | undefined,
): string | null {
  if (seen === undefined) return null;
  if (frame.people) {
    // A planned picture says how many people share its frame. Someone only at
    // the edge (a shoulder, a back) may not be counted, so fewer is fine as
    // long as the main person is there; more is not.
    return seen < 1 || seen > frame.people ? `${seen} people, should be ${frame.people}` : null;
  }
  // Unknown (older plans): one person, unless over the shoulder.
  return !/shoulder/i.test(frame.framing ?? "") && seen !== 1 ? `${seen} people` : null;
}
