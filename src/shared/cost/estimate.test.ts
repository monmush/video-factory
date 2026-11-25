import { describe, expect, it } from "vitest";
import { buildDirection } from "../build-direction";
import { rejectClip } from "../clip-check";
import { requestCost } from "../live-plan";
import { mediaLevel } from "../media-level";
import { builtinRecipe } from "../recipe";
import { readShotList, type ShotListAnswer } from "../shot-list";
import { answer, CTX, LINES } from "../shot-list.fixture";
import { applyLivePlan, newJob, type VideoJob, withShotAudio } from "../video-job";
import { STEP } from "./charges";
import { withInUsePaid } from "./charges.fixture";
import {
  batchToMake,
  costToFinishUsd,
  costToPreviewUsd,
  stepEstimates,
  withCurrentRates,
  withFirstPass,
} from "./estimate";
import { MOTION_RATE } from "./rates";
import { costPanel } from "./table";

const NOW = "2026-11-20T10:00:00.000Z";
const WAN_PRIME_UNIT_USD = 0.045;
const WIDE = 1;

function moving(): ShotListAnswer {
  const a = answer();
  const wide = (a.shots ?? [])[WIDE] as Record<string, unknown>;
  wide.route = "motion";
  wide.motion = "Bamboo leaves stir and the camera drifts toward the table.";
  return a;
}

const fresh = () =>
  newJob({
    sessionId: "s",
    seriesId: "r",
    scriptId: "x",
    title: "t",
    lines: LINES,
    useEnvironment: true,
    now: NOW,
  });

function staged(levelId = "balanced"): VideoJob {
  const level = mediaLevel(levelId);
  const { list, errors } = readShotList(moving(), CTX, { motion: level.motion, sound: false });
  expect(errors).toEqual([]);
  const live = buildDirection({
    list,
    recipe: builtinRecipe(level),
    lines: LINES,
    level,
    cast: [
      { id: "a", name: "An", photos: 3 },
      { id: "b", name: "Ba", photos: 2 },
    ],
    placePhotos: 3,
  });
  return { ...applyLivePlan({ ...fresh(), status: "idle" }, live), level: level.id };
}

describe("measured rates", () => {
  it("prices a moving shot at the 5.6 units a second billed for Wan 3.0 Prime at 1080p without sound", () => {
    const motion = builtinRecipe(mediaLevel("balanced")).motion;
    if (!motion) throw new Error("no motion role");
    const priced = (seconds: number) =>
      requestCost(motion.rate, motion.schema, motion.input, "motion", seconds).usd;
    expect(priced(7)).toBeCloseTo(39.2 * WAN_PRIME_UNIT_USD);
    expect(priced(3)).toBeCloseTo(16.8 * WAN_PRIME_UNIT_USD);
  });

  it("a staging saved with the old rates is priced at today's rates until it spends", () => {
    const job = staged();
    const live = job.live as NonNullable<VideoJob["live"]>;
    const endpoint = Object.keys(live.rates).find((e) => e.includes("wan-3.0-prime")) as string;
    const saved: VideoJob = {
      ...job,
      live: { ...live, rates: { ...live.rates, [endpoint]: { ...MOTION_RATE, usd: 0.045 } } },
    };
    const refreshed = withCurrentRates(saved);
    expect(refreshed.live?.rates[endpoint]).toEqual(MOTION_RATE);
    expect(costToFinishUsd(refreshed)).toBeCloseTo(costToFinishUsd(job) ?? Number.NaN);
    expect(costToFinishUsd(refreshed)).toBeGreaterThan(costToFinishUsd(saved) ?? Number.NaN);
    const spent = withInUsePaid({ ...saved, voiceCostUsd: 0.01, dialogue: "d.mp3" });
    expect(withCurrentRates(spent)).toBe(spent);
  });
});

describe("a price needs a staging", () => {
  it("a video without staging has no price, and a batch counts only staged videos", () => {
    const unstaged = fresh();
    expect(costToFinishUsd(unstaged)).toBeNull();
    expect(costToPreviewUsd(unstaged)).toBeNull();
    const ready = staged();
    const remade = { ...staged(), planning: true };
    expect(batchToMake([unstaged, ready, remade, undefined])).toEqual({
      count: 1,
      usd: costToFinishUsd(ready),
    });
  });
});

describe("the frozen estimate", () => {
  it("does not move when clip lengths become known or a clip is redone", () => {
    const started = withFirstPass({ ...staged(), status: "waiting" }, NOW);
    const frozen = costPanel(started)?.groups.map((g) => [g.label, g.estimateUsd]);
    const timed = withShotAudio(
      { ...started, dialogue: "d.mp3", voiceCostUsd: 0.01 },
      started.shots.map((_, i) => ({
        start: i * 9,
        end: i * 9 + 9,
        audio: `a${i}.mp3`,
        audioSec: 9,
      })),
    );
    expect(stepEstimates(timed)).not.toEqual(stepEstimates(started));
    expect(costPanel(timed)?.groups.map((g) => [g.label, g.estimateUsd])).toEqual(frozen);
    const sent = withInUsePaid({
      ...timed,
      status: "running" as const,
      shots: timed.shots.map((s) =>
        s.index === WIDE
          ? { ...s, state: "rendering" as const, requestId: "r1", resultUrl: "u", costUsd: 2.27 }
          : s,
      ),
    });
    const redone = rejectClip(sent, WIDE, "u");
    expect(redone.firstPass).toBe(started.firstPass);
    expect(costPanel(redone)?.groups.map((g) => [g.label, g.estimateUsd])).toEqual(frozen);
    expect(costPanel(redone)?.redone).toMatchObject({ count: 1, paid: { usd: 2.27 } });
  });
});

describe("material the series already has", () => {
  const MASTER = "kf:master";
  const AN = "kf:an";

  function reusing(fresh: string[] = []): VideoJob {
    const job = staged();
    return {
      ...job,
      frames: job.frames.map((f) =>
        f.id === MASTER || f.id === AN
          ? {
              ...f,
              material: f.id,
              materialFile: `${f.id}.png`,
              ...(fresh.includes(f.id) ? { fresh: true } : {}),
            }
          : f,
      ),
      shots: job.shots.map((s) =>
        s.index === WIDE ? { ...s, materialClip: { id: "c", file: "c.mp4", seconds: 9 } } : s,
      ),
    };
  }

  const usdOf = (job: VideoJob, key: string) =>
    stepEstimates(job).find((s) => s.key === key)?.usd ?? Number.NaN;

  it("prices a picture and a clip the store holds at nothing, in every total alike", () => {
    const made = staged();
    const reused = reusing();
    const stills = usdOf(made, STEP.frame(MASTER)) + usdOf(made, STEP.frame(AN));
    const clip = usdOf(made, STEP.shot(WIDE));
    expect(stills).toBeGreaterThan(0);
    expect(clip).toBeGreaterThan(0);
    expect(usdOf(reused, STEP.frame(AN))).toBe(0);
    expect(usdOf(reused, STEP.shot(WIDE))).toBe(0);
    expect(costToPreviewUsd(reused)).toBeCloseTo((costToPreviewUsd(made) ?? 0) - stills);
    expect(costToFinishUsd(reused)).toBeCloseTo((costToFinishUsd(made) ?? 0) - stills - clip);
    expect(withFirstPass(reused, NOW).firstPass?.usd).toBeCloseTo(
      (withFirstPass(made, NOW).firstPass?.usd ?? 0) - stills - clip,
    );
  });

  it("a fresh picture costs as before, and so does the clip that starts from it", () => {
    const made = staged();
    const fresh = reusing([MASTER, AN]);
    expect(costToFinishUsd(fresh)).toBeCloseTo(costToFinishUsd(made) ?? 0);
    expect(usdOf(fresh, STEP.shot(WIDE))).toBeCloseTo(usdOf(made, STEP.shot(WIDE)));
  });
});
