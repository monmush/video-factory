import { describe, expect, it } from "vitest";
import { editsInPlace } from "./edit-in-place";
import type { ShotPlan } from "./shot-plan";
import type { VideoJob } from "./video-job";

type Job = Parameters<typeof editsInPlace>[1] & object;

const job = (fields: Partial<Job> = {}): Job => ({ status: "idle", ...fields });
const paid: VideoJob["charges"] = [
  { at: "t", kind: "voice", step: "voice", usd: 0.2, billed: true },
];
const plan: ShotPlan = { source: "ai", seats: [], props: [], stateChanges: [], shots: [] };

describe("editing a script in place or as a new version", () => {
  it("edits in place while the script is not sent or has no video job", () => {
    expect(editsInPlace(false, job({ status: "done" }))).toBe(true);
    expect(editsInPlace(true, null)).toBe(true);
    expect(editsInPlace(true, undefined)).toBe(true);
  });

  it("edits in place while the video is untouched, including during staging", () => {
    expect(editsInPlace(true, job())).toBe(true);
    expect(editsInPlace(true, job({ plan }))).toBe(true);
    expect(editsInPlace(true, job({ planning: true }))).toBe(true);
    expect(editsInPlace(true, job({ status: "failed" }))).toBe(true);
  });

  it("makes a new version once anything is paid, made or running", () => {
    expect(editsInPlace(true, job({ charges: paid }))).toBe(false);
    expect(editsInPlace(true, job({ dialogue: "dialogue.mp3" }))).toBe(false);
    for (const status of ["waiting", "running", "review", "stopped", "done"] as const) {
      expect(editsInPlace(true, job({ status }))).toBe(false);
    }
  });

  it("makes a new version when the video failed after planning or spending", () => {
    expect(editsInPlace(true, job({ status: "failed", plan }))).toBe(false);
    expect(editsInPlace(true, job({ status: "failed", charges: paid }))).toBe(false);
  });
});
