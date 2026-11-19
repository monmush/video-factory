import { describe, expect, it } from "vitest";
import { buildDirection } from "./build-direction";
import type { ScriptLine } from "./ipc";
import { mediaLevel } from "./media-level";
import { followProduct, type NamedProduct, swapName } from "./product-follow";
import { builtinRecipe } from "./recipe";
import { readShotList } from "./shot-list";
import { answer, CTX, LINES } from "./shot-list.fixture";
import { applyLivePlan, applyPlan, liveCostTable, newJob, type VideoJob } from "./video-job";

const level = mediaLevel("balanced");
const OLD: NamedProduct = { id: "p", name: "Bạch Trà Shan Tuyết" };
const NEW: NamedProduct = { id: "q", name: "Trà Ô Long" };
const products = new Map([OLD, NEW].map((p) => [p.id, p]));
const product = (id: string) => products.get(id) ?? null;

/** The fixture's video, planned from its shot list, its product the old one; `named` puts the name in line 3. */
function plannedJob(named = false): VideoJob {
  const lines: ScriptLine[] = structuredClone(LINES);
  const a = answer();
  if (named) {
    (lines[2] as ScriptLine).text = "Dạ cháu cảm ơn, Bạch Trà Shan Tuyết ngon lắm ạ.";
    (a.shots?.[4] as { text: string }).text = "Bạch Trà Shan Tuyết ngon lắm ạ.";
  }
  const { list, errors } = readShotList(a, { ...CTX, lines }, { motion: false });
  expect(errors).toEqual([]);
  const live = buildDirection({
    list,
    recipe: builtinRecipe(level),
    lines,
    level,
    cast: [
      { id: "a", name: "An", photos: 3 },
      { id: "b", name: "Ba", photos: 2 },
    ],
    placePhotos: 3,
  });
  const job = newJob({
    sessionId: "s",
    seriesId: "r",
    scriptId: "x",
    title: "T",
    lines,
    useEnvironment: true,
    now: "2026-11-19T10:00:00.000Z",
  });
  return {
    ...applyLivePlan({ ...job, status: "idle", productIds: ["p"], level: level.id }, live),
    frames: applyLivePlan(job, live).frames.map((f) =>
      f.kind === "product" ? { ...f, cutouts: 2 } : f,
    ),
  };
}

const productShots = (job: VideoJob) => job.shots.filter((s) => s.productId);

describe("swapName", () => {
  it("swaps every occurrence, any case, any spacing", () => {
    expect(swapName("Uống bạch trà  shan tuyết đi, Bạch Trà Shan Tuyết!", OLD.name, NEW.name)).toBe(
      "Uống Trà Ô Long đi, Trà Ô Long!",
    );
  });
});

describe("followProduct", () => {
  it("points product shots to the new product, keeps the plate picture, and follows its cut-outs", () => {
    const job = plannedJob();
    const result = followProduct(job, { lines: LINES, productIds: ["q"] }, product, (id) =>
      id === "q" ? 1 : 2,
    );
    expect(result.kind).toBe("patched");
    if (result.kind !== "patched") return;
    const next = result.job;
    expect(next.productIds).toEqual(["q"]);
    expect(productShots(next).map((s) => s.productId)).toEqual(["q"]);
    expect(next.plan?.shots.filter((s) => s.productId).map((s) => s.productId)).toEqual(["q"]);
    expect(next.live?.plan.shots.shots.filter((s) => s.productId)[0]?.productId).toBe("q");
    // Same pictures and routes: nothing is directed again.
    expect(next.live?.plan.keyframes).toEqual(job.live?.plan.keyframes);
    expect(next.live?.plan.routes).toEqual(job.live?.plan.routes);
    const plate = next.frames.find((f) => f.kind === "product");
    expect(plate).toMatchObject({ productId: "q", cutouts: 1, keyframe: "plate" });
    expect(next.frames.map((f) => f.id)).toEqual(job.frames.map((f) => f.id));
    // The price follows the cut-outs the new product needs.
    expect(liveCostTable(next)?.knownUsd).toBeLessThan(liveCostTable(job)?.knownUsd ?? 0);
    expect(next.status).toBe("idle");
  });

  it("keeps the shots when a line only swapped the product's name", () => {
    const job = plannedJob(true);
    const lines = structuredClone(job.lines);
    (lines[2] as ScriptLine).text = "Dạ cháu cảm ơn, Trà Ô Long ngon lắm ạ.";
    const result = followProduct(job, { lines, productIds: ["q"] }, product, () => 0);
    expect(result.kind).toBe("patched");
    if (result.kind !== "patched") return;
    expect(result.job.lines[2]?.text).toBe("Dạ cháu cảm ơn, Trà Ô Long ngon lắm ạ.");
    expect(result.job.shots.map((s) => s.text)).toContain("Trà Ô Long ngon lắm ạ.");
    expect(result.job.shots).toHaveLength(job.shots.length);
  });

  it("names the new product in wishes written on the old name", () => {
    const job = {
      ...plannedJob(true),
      direction: [{ words: "Bạch Trà Shan Tuyết ngon lắm ạ.", want: "cười", at: "t" }],
    };
    const lines = structuredClone(job.lines);
    (lines[2] as ScriptLine).text = "Dạ cháu cảm ơn, Trà Ô Long ngon lắm ạ.";
    const result = followProduct(job, { lines, productIds: ["q"] }, product, () => 0);
    expect(result.kind === "patched" && result.job.direction?.[0]?.words).toBe(
      "Trà Ô Long ngon lắm ạ.",
    );
  });

  it("stages again when other words changed", () => {
    const job = plannedJob(true);
    const lines = structuredClone(job.lines);
    (lines[2] as ScriptLine).text = "Dạ cháu cảm ơn, trà Ô Long thơm quá ạ.";
    expect(followProduct(job, { lines, productIds: ["q"] }, product, () => 0)).toEqual({
      kind: "replan",
      why: "lines",
    });
  });

  it("stages again when the product is removed", () => {
    expect(followProduct(plannedJob(), { lines: LINES, productIds: [] }, product, () => 0)).toEqual(
      { kind: "replan", why: "no-product" },
    );
  });

  it("stages again when the plan has no product shot to carry the new product", () => {
    const job = newJob({
      sessionId: "s",
      seriesId: "r",
      scriptId: "x",
      title: "T",
      lines: LINES,
      useEnvironment: false,
      now: "2026-11-19T10:00:00.000Z",
    });
    const planned = applyPlan(job, {
      source: "rules",
      seats: [],
      props: [],
      stateChanges: [],
      shots: LINES.map((l, i) => ({
        kind: "speaker" as const,
        characterId: l.characterId,
        framing: "medium_close" as const,
        line: i,
        text: l.text,
        visual: "",
        productId: null,
        why: "",
      })),
    });
    expect(followProduct(planned, { lines: LINES, productIds: ["q"] }, product, () => 0)).toEqual({
      kind: "replan",
      why: "no-product-shot",
    });
  });

  it("follows a plan made without recorded products (older jobs) from its product shots", () => {
    const { productIds: _, ...job } = plannedJob();
    const result = followProduct(job, { lines: LINES, productIds: ["q"] }, product, () => 0);
    expect(result.kind).toBe("patched");
  });
});
