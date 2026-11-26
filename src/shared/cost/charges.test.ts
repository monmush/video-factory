import { describe, expect, it } from "vitest";
import { buildDirection } from "../build-direction";
import { AUTO_MODELS } from "../models";
import { PACE_OF_VIDEOS_MADE_BEFORE_PACES } from "../pace";
import { builtinRecipe } from "../recipe";
import { readShotList } from "../shot-list";
import { answer, CTX, LINES } from "../shot-list.fixture";
import { applyLivePlan, newJob, stillToDrawAgain, type VideoJob } from "../video-job";
import { redoneCharges, spentUsd, withRecordedCharges } from "./charges";
import { withInUsePaid } from "./charges.fixture";
import { resultCost } from "./rates";
import { costPanel, moneyText, paidSoFar } from "./table";

const NOW = "2026-11-20T10:00:00.000Z";

function staged(): VideoJob {
  const { list, errors } = readShotList(answer(), CTX, { motion: false, sound: false });
  expect(errors).toEqual([]);
  const live = buildDirection({
    list,
    recipe: builtinRecipe(AUTO_MODELS),
    cast: [
      { id: "a", name: "An", photos: 3 },
      { id: "b", name: "Ba", photos: 2 },
    ],
    placePhotos: 3,
    pace: PACE_OF_VIDEOS_MADE_BEFORE_PACES,
  });
  const job = newJob({
    sessionId: "s",
    seriesId: "r",
    scriptId: "x",
    title: "t",
    lines: LINES,
    useEnvironment: true,
    models: AUTO_MODELS,
    now: NOW,
  });
  return { ...applyLivePlan({ ...job, status: "running" }, live) };
}

describe("what a finished request cost", () => {
  it("is the billed units at the unit price when fal reports them, else the app's own figure", () => {
    expect(resultCost(0.07, 0.0855, 1)).toEqual({ usd: 0.0855, billed: true, billedUnits: 0.0855 });
    expect(resultCost(0.32, 39.2, 0.045)).toMatchObject({ billed: true });
    expect(resultCost(0.32, 39.2, 0.045).usd).toBeCloseTo(1.764);
    expect(resultCost(0.07, null, 1)).toEqual({ usd: 0.07, billed: false });
    expect(resultCost(0.07, 0.0855, null)).toEqual({ usd: 0.07, billed: false });
  });

  it("shows a paid total as the app's figure as soon as one charge in it was calculated", () => {
    const billed = { at: NOW, kind: "still" as const, step: "frame:a", usd: 0.0855, billed: true };
    const job = { charges: [billed] };
    expect(moneyText(paidSoFar(job))).toBe("$0.09");
    const mixed = { charges: [billed, { ...billed, step: "voice", usd: 0.01, billed: false }] };
    expect(moneyText(paidSoFar(mixed))).toBe("~$0.10");
  });
});

describe("a still drawn again after a failed check", () => {
  it("shows the still in use on its row and the earlier one as redone", () => {
    const job = staged();
    const master = job.frames[0]?.id as string;
    const paint = (j: VideoJob, requestId: string, usd: number): VideoJob =>
      withInUsePaid({
        ...j,
        frames: j.frames.map((f) =>
          f.id === master
            ? { ...f, requestId, resultUrl: `u-${requestId}`, costUsd: usd, costBilled: true }
            : f,
        ),
      });
    const first = paint(job, "r1", 0.0855);
    const again = {
      ...first,
      frames: first.frames.map((f) => (f.id === master ? stillToDrawAgain(f, "text") : f)),
    };
    const second = paint(again, "r2", 0.065);
    expect(spentUsd(second)).toBeCloseTo(0.0855 + 0.065);
    const panel = costPanel(second);
    expect(panel?.groups.find((g) => g.label === "Khung hình")?.paid).toEqual({
      usd: 0.065,
      billed: true,
    });
    expect(panel?.redone).toMatchObject({ count: 1, paid: { usd: 0.0855, billed: true } });
    expect(panel?.paid?.usd).toBeCloseTo(spentUsd(second));
    expect(panel?.redoneSteps.map((s) => s.label)).toEqual(["Khung hình master"]);
  });
});

describe("a job saved before charges were kept", () => {
  it("loads with the total it showed, its earlier redos as one redone charge", () => {
    const job = staged();
    const legacy: VideoJob = {
      ...job,
      dialogue: "d.mp3",
      voiceCostUsd: 0.05,
      frames: job.frames.map((f, i) => (i === 0 ? { ...f, file: "m.png", costUsd: 0.12 } : f)),
      shots: job.shots.map((s, i) =>
        i === 0 ? { ...s, state: "done", clip: "c.mp4", requestId: "r0", costUsd: 0.4 } : s,
      ),
      pastCostUsd: 1.2,
    };
    const shownVoiceStillClipAndEarlierRedos = 0.05 + 0.12 + 0.4 + 1.2;
    const loaded = withRecordedCharges(legacy);
    expect(spentUsd(loaded)).toBeCloseTo(shownVoiceStillClipAndEarlierRedos);
    expect(loaded.pastCostUsd).toBeUndefined();
    expect(loaded.charges?.every((c) => !c.billed)).toBe(true);
    expect(redoneCharges(loaded).map((c) => c.usd)).toEqual([1.2]);
    expect(withRecordedCharges(loaded)).toBe(loaded);
  });
});
