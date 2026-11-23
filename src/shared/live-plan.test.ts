import { describe, expect, it } from "vitest";
import {
  emptyRecord,
  type LiveAnswer,
  type LiveContext,
  placeholdersIn,
  priceLivePlan,
  readLivePlan,
  recordResult,
  type ToolRecord,
  unitsFor,
  unknownPriceWarnings,
} from "./live-plan";
import { mediaLevel } from "./media-level";

const level = mediaLevel("balanced");
const ctx: LiveContext = {
  lines: [
    { characterId: "a", speaker: "An", text: "Chào ông, hôm nay trời đẹp quá ạ." },
    { characterId: "b", speaker: "Ba", text: "Ừ, ngồi xuống uống chén trà đã cháu." },
  ],
  cast: [
    { id: "a", name: "An" },
    { id: "b", name: "Ba" },
  ],
  products: [{ id: "p", name: "Trà Sen Tây Hồ" }],
  hasPlace: true,
  refs: ["place-1", "cast1-1", "cast2-1"],
  level,
};

const IMAGE = "img/edit";
const LIPS = "lips/sync";
const MOTION = "move/i2v";

function session(): ToolRecord {
  const record = emptyRecord();
  const schema = (endpoint: string, name: string, params: unknown[], props = {}) =>
    recordResult(
      record,
      "mcp__fal__get_model_schema",
      [
        JSON.stringify({
          endpoint_id: endpoint,
          display_name: name,
          category: "x",
          input_params: params,
          input_schema: { properties: props },
          output_fields: [{ name: "video" }],
        }),
      ],
      false,
    );
  schema(IMAGE, "Image Edit by fal", [
    { name: "prompt", type: "string", required: true },
    { name: "image_urls", type: "array<string>", required: true },
    { name: "num_images", type: "integer", required: false, default: 1 },
  ]);
  schema(LIPS, "Lip Sync", [
    { name: "image_url", type: "string", required: true },
    { name: "audio_url", type: "string", required: true },
    { name: "prompt", type: "string", required: false },
  ]);
  schema(
    MOTION,
    "Motion 4",
    [
      { name: "start_image_url", type: "string", required: true },
      { name: "prompt", type: "string", required: false },
      { name: "duration", type: "integer", required: false, default: 5 },
      { name: "resolution", type: "string", required: false, enum: ["720p", "1080p"] },
    ],
    { duration: { minimum: 3, maximum: 15 } },
  );
  recordResult(
    record,
    "mcp__fal__get_pricing",
    [
      JSON.stringify({
        prices: [
          { endpoint_id: IMAGE, unit_price: 0.04, unit: "images" },
          { endpoint_id: LIPS, unit_price: 0.1, unit: "seconds" },
          { endpoint_id: MOTION, unit_price: 0.05, unit: "seconds" },
        ],
      }),
    ],
    false,
  );
  return record;
}

const shot = (n: number, extra: Record<string, unknown>) => ({
  n,
  line: n,
  text: ctx.lines[n - 1]?.text,
  ...extra,
});

const masterInput = (answer: LiveAnswer) =>
  (answer.keyframes ?? [])[0]?.input as Record<string, unknown>;

function goodAnswer(): LiveAnswer {
  return {
    seats: [],
    props: [],
    keyframes: [
      {
        id: "master",
        kind: "master",
        endpoint: IMAGE,
        input: { prompt: "Wide scene", image_urls: ["{{place-1}}", "{{cast1-1}}", "{{cast2-1}}"] },
      },
      {
        id: "an",
        kind: "character",
        character: "An",
        endpoint: IMAGE,
        input: { prompt: "An, close", image_urls: ["{{cast1-1}}", "{{keyframe:master}}"] },
      },
      {
        id: "ba",
        kind: "character",
        character: "Ba",
        endpoint: IMAGE,
        input: { prompt: "Ba, close", image_urls: ["{{cast2-1}}", "{{keyframe:master}}"] },
      },
    ],
    shots: [
      shot(1, {
        type: "speaker",
        character: "An",
        keyframe: "an",
        route: "lip-sync",
        endpoint: LIPS,
        input: { image_url: "{{keyframe}}", audio_url: "{{audio}}" },
      }),
      shot(2, {
        type: "speaker",
        character: "Ba",
        keyframe: "ba",
        route: "lip-sync",
        endpoint: LIPS,
        input: { image_url: "{{keyframe}}", audio_url: "{{audio}}" },
      }),
    ],
    models: [
      { endpoint: IMAGE, role: "keyframes", why: "pick" },
      { endpoint: LIPS, role: "lip-sync", why: "pick" },
    ],
    guidance_note: "Routing was partial.",
  };
}

describe("recording tool results", () => {
  it("keeps schemas, prices, estimates, decisions and how guidance answered", () => {
    const record = session();
    recordResult(
      record,
      "mcp__fal__estimate_cost",
      [
        JSON.stringify({
          endpoint_id: "x/y",
          estimated_cost_usd: 0.3,
          quantity: 1,
          price: { unit_price: 0.3, unit: "units" },
        }),
      ],
      false,
    );
    recordResult(
      record,
      "mcp__fal__recommend_model",
      [
        JSON.stringify({
          decision_id: "d1",
          results: [{ next_call: { endpoint_id: LIPS }, fit_candidates: [{ endpoint_id: "z" }] }],
        }),
      ],
      false,
    );
    recordResult(
      record,
      "mcp__fal__search_guidance",
      [JSON.stringify({ status: "partial", data: { retrieval: { status: "partial" } } })],
      false,
    );
    recordResult(record, "mcp__fal__search_guidance", ["denied"], true);
    expect(Object.keys(record.schemas)).toEqual([IMAGE, LIPS, MOTION]);
    expect(record.schemas[MOTION]?.params.find((p) => p.name === "duration")).toMatchObject({
      min: 3,
      max: 15,
      default: 5,
    });
    expect(record.prices[LIPS]).toEqual({ usd: 0.1, unit: "seconds" });
    expect(record.estimates).toEqual([{ endpoint: "x/y", usd: 0.3, quantity: 1, unit: "units" }]);
    expect(record.decisions.d1).toEqual([LIPS, "z"]);
    expect(record.guidance).toBe("partial");
    expect(record.calls.at(-1)).toEqual({ tool: "search_guidance", ok: false });
  });

  it("finds placeholders anywhere in an input", () => {
    expect(
      placeholdersIn({ a: "{{audio}}", b: ["{{ keyframe:m }}", "text"], c: { d: 1 } }),
    ).toEqual(["audio", "keyframe:m"]);
  });
});

describe("checking a live plan", () => {
  it("accepts a plan that keeps every rule, naming models without the middleman", () => {
    const { plan, errors } = readLivePlan(goodAnswer(), ctx, session());
    expect(errors).toEqual([]);
    expect(plan.keyframes.map((k) => k.id)).toEqual(["master", "an", "ba"]);
    expect(plan.routes.map((r) => r.route)).toEqual(["lip-sync", "lip-sync"]);
    expect(plan.models[0]?.name).toBe("Image Edit by");
  });

  it("refuses an endpoint whose schema was not read, and unknown or missing fields", () => {
    const answer = goodAnswer();
    const first = answer.shots?.[0] as Record<string, unknown>;
    first.endpoint = "never/read";
    const second = answer.shots?.[1] as Record<string, unknown>;
    second.input = { image_url: "{{keyframe}}", audio: "{{audio}}" };
    const { errors } = readLivePlan(answer, ctx, session());
    expect(errors.join("\n")).toMatch(/schema of "never\/read"/);
    expect(errors.join("\n")).toMatch(/no field "audio"/);
    expect(errors.join("\n")).toMatch(/requires "audio_url"/);
  });

  it("refuses unresolvable placeholders and keyframes that use later ones", () => {
    const answer = goodAnswer();
    masterInput(answer).image_urls = ["{{place-9}}", "{{keyframe:an}}"];
    const { errors } = readLivePlan(answer, ctx, session());
    expect(errors.join("\n")).toMatch(/"\{\{place-9\}\}" is not a file/);
    expect(errors.join("\n")).toMatch(/"\{\{keyframe:an\}\}" is not a file/);
  });

  it("keeps products out of keyframes and video routes", () => {
    const answer = goodAnswer();
    masterInput(answer).prompt = "Wide scene with a pouch of Trà Sen on the table";
    const { errors } = readLivePlan(answer, ctx, session());
    expect(errors.join("\n")).toMatch(/products are never generated/);
  });

  it("lets requests rule packaging out", () => {
    const answer = goodAnswer();
    masterInput(answer).prompt = "Wide scene. No text, signs, labels or packaging anywhere.";
    expect(readLivePlan(answer, ctx, session()).errors).toEqual([]);
  });

  it("asks for motion clips that last the whole shot, within the model's limits", () => {
    const answer = goodAnswer();
    const shots = answer.shots as Record<string, unknown>[];
    shots.splice(1, 1, {
      n: 2,
      line: 2,
      type: "listener",
      character: "An",
      text: "Ừ, ngồi xuống uống chén trà đã cháu.",
      keyframe: "an",
      route: "motion",
      endpoint: MOTION,
      input: { start_image_url: "{{keyframe}}", duration: 2 },
    });
    const { errors } = readLivePlan(answer, ctx, session());
    expect(errors.join("\n")).toMatch(/at least 3/);
    expect(errors.join("\n")).toMatch(/must last the whole shot/);
  });

  it("lip-syncs every speaker shot", () => {
    const answer = goodAnswer();
    const first = answer.shots?.[0] as Record<string, unknown>;
    first.route = "still-move";
    first.endpoint = null;
    first.input = null;
    const { errors } = readLivePlan(answer, ctx, session());
    expect(errors).toContain("Shot 1: a speaker shot is lip-synced.");
  });
});

describe("pricing a live plan", () => {
  it("prices every step from recorded prices and counts the unknown ones", () => {
    const record = session();
    const { plan } = readLivePlan(goodAnswer(), ctx, record);
    delete record.prices[IMAGE];
    const table = priceLivePlan(plan, record, ctx.lines);
    expect(table.rows.map((r) => r.step)).toEqual([
      "Giọng đọc",
      "Khung hình master",
      "Khung hình an",
      "Khung hình ba",
      "Cảnh 1 · Khẩu hình",
      "Cảnh 2 · Khẩu hình",
    ]);
    expect(table.unknownSteps).toBe(3);
    const lips = table.rows.slice(4);
    for (const row of lips) {
      const billed = (row.usd as number) / 0.1;
      expect(billed).toBeGreaterThanOrEqual(2);
      expect(Number.parseFloat(row.quantity)).toBeCloseTo(billed, 1);
    }
    expect(unknownPriceWarnings(table)).toContain("3 step(s) have no recorded price.");
  });

  it("falls back to a recorded estimate when the unit cannot be counted", () => {
    const record = session();
    record.prices[IMAGE] = { usd: 1, unit: "units" };
    record.estimates.push({ endpoint: IMAGE, usd: 0.15, unit: "units" });
    const { plan } = readLivePlan(goodAnswer(), ctx, record);
    const table = priceLivePlan(plan, record, ctx.lines);
    expect(table.rows[1]?.usd).toBe(0.15);
    expect(table.unknownSteps).toBe(0);
  });

  it("counts units by the price's unit", () => {
    expect(unitsFor("seconds", {}, undefined, 4.2)).toBe(4.2);
    expect(unitsFor("images", { num_images: 2 }, undefined, 0)).toBe(2);
    expect(
      unitsFor("megapixels", { image_size: { width: 1116, height: 2000 } }, undefined, 0),
    ).toBe(3);
    expect(unitsFor("units", {}, undefined, 0)).toBeNull();
  });
});

describe("billing rules from the tools", () => {
  const withGuide = (text: string) => {
    const record = session();
    recordResult(
      record,
      "mcp__fal__read_guidance",
      [JSON.stringify({ status: "complete", data: { body: text } })],
      false,
    );
    return record;
  };
  const billed = (billing: Record<string, unknown>) => {
    const answer = goodAnswer();
    (answer.models ?? [])[1] = { endpoint: LIPS, role: "lip-sync", why: "pick", billing };
    return answer;
  };

  it("raises the price and bills the minimum when the tools state them", () => {
    const record = withGuide("Lip Sync: $0.16/s at 1080P; clips bill a minimum of 5 s.");
    const { plan, errors } = readLivePlan(
      billed({ unit_price: 0.16, unit: "seconds", min_seconds: 5, source: "guide" }),
      ctx,
      record,
    );
    expect(errors).toEqual([]);
    const table = priceLivePlan(plan, record, ctx.lines);
    expect(table.rows[4]).toMatchObject({ quantity: "5 giây" });
    expect(table.rows[4]?.usd).toBeCloseTo(0.8);
  });

  it("refuses numbers no tool returned, and never lowers a recorded price", () => {
    const record = withGuide("Lip Sync: $0.02/s on a promotion.");
    const refused = readLivePlan(
      billed({ unit_price: 0.3, unit: "seconds", min_seconds: 4 }),
      ctx,
      record,
    );
    expect(refused.errors.join("\n")).toMatch(/0.3 per seconds is not in any guide/);
    expect(refused.errors.join("\n")).toMatch(/4-second minimum/);
    const { plan } = readLivePlan(billed({ unit_price: 0.02, unit: "seconds" }), ctx, record);
    const table = priceLivePlan(plan, record, ctx.lines);
    expect((table.rows[4]?.usd as number) / 0.1).toBeGreaterThanOrEqual(2);
  });
});
