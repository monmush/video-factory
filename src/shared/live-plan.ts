import { estimateSeconds, estimateVoiceUsd, levelEstimateUsd } from "./board";
import type { ScriptLine } from "./ipc";
import type { MediaLevel, MediaLevelId } from "./media-level";
import {
  type DirectorAnswer,
  estimatePartSec,
  namedPackaging,
  namedProduct,
  type PlanContext,
  readDirectorAnswer,
  type ShotPlan,
} from "./shot-plan";

// The live director's plan (experiment branch, docs/LIVE_DIRECTOR_EXPERIMENT.md):
// the user's own AI picks a model for every paid step with the media
// provider's read-only planning tools, and returns keyframes and a production
// route per shot. The director plans, code spends: everything here is pure so
// the checks and the prices are tested. Prices come only from tool results
// recorded in the session (`ToolRecord`), never from the director's own sums.

export type Route = "lip-sync" | "motion" | "still-move" | "product";
export const ROUTES: Route[] = ["lip-sync", "motion", "still-move", "product"];
/** Routes that send a paid request. */
export const PAID_ROUTES: Route[] = ["lip-sync", "motion"];

export type KeyframeKind = "master" | "character" | "action" | "plate";
const KEYFRAME_KINDS: KeyframeKind[] = ["master", "character", "action", "plate"];

/** Shortest audio a speaking shot is given (as `MIN_SHOT_SEC` in video-job). */
const MIN_AUDIO_SEC = 2;

// ---------------------------------------------------------------------------
// What the session's tools returned
// ---------------------------------------------------------------------------

export interface SchemaParam {
  name: string;
  type: string;
  required: boolean;
  enum?: (string | number)[];
  min?: number;
  max?: number;
  default?: unknown;
}

export interface ModelSchema {
  endpoint: string;
  name: string;
  category: string;
  params: SchemaParam[];
  outputs: string[];
  /**
   * Shortest audio the model takes, when its schema says so ("at least 5 s"
   * on an audio field): shorter audio is padded with silence before sending.
   */
  minAudioSec?: number;
}

export interface UnitPrice {
  usd: number;
  unit: string;
}

export type Retrieval = "complete" | "partial" | "unavailable" | "not-asked";

export interface ToolRecord {
  /** Every call, in order: tool name without its server prefix. */
  calls: { tool: string; ok: boolean }[];
  /** By endpoint: schemas read with get_model_schema. */
  schemas: Record<string, ModelSchema>;
  /** By endpoint: unit prices from get_pricing or estimate_cost. */
  prices: Record<string, UnitPrice>;
  /** estimate_cost results that had a total. */
  estimates: { endpoint: string; usd: number; quantity?: number; unit?: string }[];
  /** recommend_model decisions: id → endpoints it selected or offered. */
  decisions: Record<string, string[]>;
  /**
   * Endpoints recommend_model found fit for an operation ("lip-sync"),
   * selected or passing its fit checks: the alternatives a plan is compared with.
   */
  candidates?: Record<string, string[]>;
  /** How the published routing and guides answered, at best. */
  guidance: Retrieval;
  /**
   * Text of the guides, schemas and catalogue answers read, so a billing rule
   * the director reports from them (a resolution tier, a minimum length) can
   * be checked against what the tools actually said.
   */
  evidence?: string;
}

/** Most evidence text kept per session. */
const EVIDENCE_MAX = 1_000_000;
const EVIDENCE_TOOLS = [
  "read_guidance",
  "search_guidance",
  "get_model_schema",
  "recommend_model",
  "search_models",
  "search_docs",
];

export const emptyRecord = (): ToolRecord => ({
  calls: [],
  schemas: {},
  prices: {},
  estimates: [],
  decisions: {},
  guidance: "not-asked",
});

/** "mcp__fal__get_pricing" → "get_pricing". */
export const bareToolName = (name: string) => name.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "");

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** "at least 5 s", "minimum 2 seconds", "min. 3s" → seconds. */
export function statedMinimumSec(text: string): number | undefined {
  const m =
    /(?:at least|minimum(?: of)?|min\.?)\s*(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds?)\b/i.exec(text);
  return m ? Number(m[1]) : undefined;
}

function readSchema(raw: Record<string, unknown>): ModelSchema | null {
  const endpoint = str(raw.endpoint_id);
  if (!endpoint || !Array.isArray(raw.input_params)) return null;
  const props = obj(obj(raw.input_schema).properties);
  const params: SchemaParam[] = (raw.input_params as unknown[]).map((p) => {
    const param = obj(p);
    const name = str(param.name);
    const exact = obj(props[name]);
    const values = Array.isArray(param.enum) ? param.enum : exact.enum;
    return {
      name,
      type: str(param.type),
      required: param.required === true,
      ...(Array.isArray(values) ? { enum: values as (string | number)[] } : {}),
      ...(num(exact.minimum) !== undefined ? { min: num(exact.minimum) } : {}),
      ...(num(exact.maximum) !== undefined ? { max: num(exact.maximum) } : {}),
      ...("default" in param ? { default: param.default } : {}),
    };
  });
  // An audio input's stated minimum, from its description.
  const minAudio = (raw.input_params as unknown[])
    .map(obj)
    .filter((p) => /audio/i.test(str(p.name)))
    .map((p) => statedMinimumSec(str(p.description) || str(obj(props[str(p.name)]).description)))
    .find((n): n is number => n !== undefined);
  return {
    endpoint,
    ...(minAudio !== undefined ? { minAudioSec: minAudio } : {}),
    name: str(raw.display_name) || endpoint,
    category: str(raw.category),
    params,
    outputs: Array.isArray(raw.output_fields)
      ? (raw.output_fields as unknown[]).map((f) => str(obj(f).name)).filter(Boolean)
      : [],
  };
}

const retrievalOf = (data: Record<string, unknown>): Retrieval => {
  const status = str(obj(obj(data.data).retrieval).status) || str(data.status);
  return status === "complete" ? "complete" : status === "partial" ? "partial" : "unavailable";
};
const RANK: Record<Retrieval, number> = { "not-asked": 0, unavailable: 1, partial: 2, complete: 3 };

/**
 * Adds one tool result to the record. Results that are errors, or not the
 * JSON the tool documents, only count as a failed call.
 */
export function recordResult(
  record: ToolRecord,
  name: string,
  texts: string[],
  isError: boolean,
): ToolRecord {
  const tool = bareToolName(name);
  const data = obj(parseJson(texts[0] ?? ""));
  const failed = isError || data.status === "error" || data.status === "not_found";
  record.calls.push({ tool, ok: !failed });
  if (tool === "search_guidance" || tool === "read_guidance") {
    const got = failed ? "unavailable" : retrievalOf(data);
    if (RANK[got] > RANK[record.guidance]) record.guidance = got;
  }
  if (failed) return record;
  if (EVIDENCE_TOOLS.includes(tool)) {
    record.evidence = `${record.evidence ?? ""}\n${texts.join("\n")}`.slice(0, EVIDENCE_MAX);
  }
  if (tool === "get_model_schema") {
    const list = Array.isArray(data.models) ? data.models : [data];
    for (const raw of list) {
      const schema = readSchema(obj(raw));
      if (schema) record.schemas[schema.endpoint] = schema;
    }
  } else if (tool === "get_pricing") {
    for (const raw of Array.isArray(data.prices) ? data.prices : []) {
      const p = obj(raw);
      const usd = num(p.unit_price);
      if (str(p.endpoint_id) && usd !== undefined) {
        record.prices[str(p.endpoint_id)] = { usd, unit: str(p.unit) };
      }
    }
  } else if (tool === "estimate_cost") {
    const endpoint = str(data.endpoint_id);
    const price = obj(data.price);
    const usd = num(price.unit_price);
    if (endpoint && usd !== undefined) record.prices[endpoint] = { usd, unit: str(price.unit) };
    const total = num(data.estimated_cost_usd);
    if (endpoint && total !== undefined) {
      record.estimates.push({
        endpoint,
        usd: total,
        ...(num(data.quantity) !== undefined ? { quantity: num(data.quantity) } : {}),
        ...(str(price.unit) ? { unit: str(price.unit) } : {}),
      });
    }
  } else if (tool === "recommend_model") {
    const id = str(data.decision_id);
    if (id) {
      const endpoints = new Set<string>();
      for (const r of Array.isArray(data.results) ? data.results : []) {
        const result = obj(r);
        const next = str(obj(result.next_call).endpoint_id);
        if (next) endpoints.add(next);
        for (const m of [
          ...(Array.isArray(result.models) ? result.models : []),
          ...(Array.isArray(result.fit_candidates) ? result.fit_candidates : []),
        ]) {
          const e = str(obj(m).endpoint_id);
          if (e) endpoints.add(e);
        }
      }
      record.decisions[id] = [...endpoints];
      // Fit candidates by operation, and the price recommend_model quoted.
      const operation = str(obj(data.interpreted_task).operation_id);
      const fit = new Set<string>();
      for (const r of Array.isArray(data.results) ? data.results : []) {
        const result = obj(r);
        const next = obj(result.next_call);
        if (str(next.endpoint_id)) fit.add(str(next.endpoint_id));
        const quoted = obj(next.price);
        if (str(quoted.endpoint_id) && num(quoted.unit_price) !== undefined) {
          record.prices[str(quoted.endpoint_id)] ??= {
            usd: num(quoted.unit_price) as number,
            unit: str(quoted.unit),
          };
        }
        for (const m of Array.isArray(result.fit_candidates) ? result.fit_candidates : []) {
          const c = obj(m);
          if (str(c.endpoint_id) && (!c.fit_status || c.fit_status === "pass")) {
            fit.add(str(c.endpoint_id));
          }
        }
      }
      if (operation && fit.size) {
        record.candidates ??= {};
        record.candidates[operation] = [
          ...new Set([...(record.candidates[operation] ?? []), ...fit]),
        ];
      }
    }
  }
  return record;
}

// ---------------------------------------------------------------------------
// The answer and the plan
// ---------------------------------------------------------------------------

type Input = Record<string, unknown>;

interface RawKeyframe {
  id?: string;
  kind?: string;
  character?: string | null;
  framing?: string;
  references?: string[];
  endpoint?: string;
  input?: Input;
  why?: string;
}

interface RawRoute {
  keyframe?: string | null;
  route?: string;
  endpoint?: string | null;
  input?: Input | null;
}

export interface LiveAnswer extends DirectorAnswer {
  keyframes?: RawKeyframe[];
  shots?: (NonNullable<DirectorAnswer["shots"]>[number] & RawRoute)[];
  models?: {
    endpoint?: string;
    role?: string;
    why?: string;
    decision_id?: string | null;
    billing?: RawBilling | null;
  }[];
  /** The director's own note, e.g. that routing guidance was unavailable. */
  guidance_note?: string;
}

interface RawBilling {
  unit_price?: number | null;
  unit?: string | null;
  min_seconds?: number | null;
  source?: string | null;
}

/**
 * A billing rule the director found in what the tools returned (the price of
 * the configuration it chose, a minimum billed length), accepted only when
 * its numbers appear in the session's recorded results.
 */
export interface Billing {
  usd?: number;
  unit?: string;
  minSeconds?: number;
  source: string;
}

export interface PlannedKeyframe {
  id: string;
  kind: KeyframeKind;
  characterId: string | null;
  framing: string;
  /** Placeholders of the files it is made from. */
  references: string[];
  endpoint: string;
  input: Input;
  why: string;
}

export interface PlannedRoute {
  route: Route;
  keyframe: string | null;
  endpoint: string | null;
  input: Input | null;
}

export interface LivePlan {
  /** What the viewer sees and hears: the same plan the fixed pipeline uses. */
  shots: ShotPlan;
  keyframes: PlannedKeyframe[];
  /** Production of each shot, in the order of `shots.shots`. */
  routes: PlannedRoute[];
  models: {
    endpoint: string;
    name: string;
    role: string;
    why: string;
    decisionId: string | null;
    billing?: Billing;
  }[];
  level: MediaLevelId;
  guidanceNote: string;
}

export interface LiveContext extends PlanContext {
  /** File placeholders the director may use as references ("place-1", "cast1-2"). */
  refs: string[];
  level: MediaLevel;
}

/** A whole value written as `{{name}}`. */
const PLACEHOLDER = /^\{\{\s*([^{}]+?)\s*\}\}$/;
export const placeholderOf = (v: unknown) =>
  typeof v === "string" ? (PLACEHOLDER.exec(v)?.[1] ?? null) : null;

/** Every placeholder in an input, top level and inside arrays and objects. */
export function placeholdersIn(value: unknown): string[] {
  const found: string[] = [];
  const walk = (v: unknown) => {
    const p = placeholderOf(v);
    if (p) found.push(p);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(value);
  return found;
}

/** Text written into an input (prompts and the like), placeholders left out. */
function textsIn(value: unknown): string[] {
  if (typeof value === "string") return placeholderOf(value) ? [] : [value];
  if (Array.isArray(value)) return value.flatMap(textsIn);
  if (value && typeof value === "object") return Object.values(value).flatMap(textsIn);
  return [];
}

/** Fields a model takes its clip length in. */
export const DURATION_FIELDS = ["duration", "duration_seconds", "seconds", "num_seconds"];

/** The input's requested length in seconds, else the schema's default; undefined when it has none. */
export function requestedSeconds(schema: ModelSchema, input: Input): number | undefined {
  for (const name of DURATION_FIELDS) {
    const param = schema.params.find((p) => p.name === name);
    if (!param) continue;
    const value = Number(input[name] ?? param.default);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

/** Problems with an input against the schema read in this session. */
export function inputErrors(
  where: string,
  endpoint: string,
  input: Input,
  record: ToolRecord,
  seconds?: number,
): string[] {
  const schema = record.schemas[endpoint];
  if (!schema) {
    return [
      `${where}: read the schema of "${endpoint}" with get_model_schema before using it (the endpoint must exist in the live catalogue).`,
    ];
  }
  const errors: string[] = [];
  const names = new Set(schema.params.map((p) => p.name));
  const unknown = Object.keys(input).filter((k) => !names.has(k));
  if (unknown.length) {
    errors.push(
      `${where}: "${endpoint}" has no field ${unknown.map((k) => `"${k}"`).join(", ")}; its fields are ${[...names].join(", ")}.`,
    );
  }
  for (const param of schema.params) {
    const value = input[param.name];
    if (param.required && (value === undefined || value === null || value === "")) {
      errors.push(`${where}: "${endpoint}" requires "${param.name}".`);
      continue;
    }
    if (value === undefined || placeholderOf(value)) continue;
    if (param.enum && !param.enum.map(String).includes(String(value))) {
      errors.push(
        `${where}: "${param.name}" must be one of ${param.enum.map((v) => JSON.stringify(v)).join(", ")}.`,
      );
    }
    const n = Number(value);
    if (typeof value !== "object" && Number.isFinite(n)) {
      if (param.min !== undefined && n < param.min)
        errors.push(`${where}: "${param.name}" is at least ${param.min}.`);
      if (param.max !== undefined && n > param.max)
        errors.push(`${where}: "${param.name}" is at most ${param.max}.`);
    }
  }
  if (seconds !== undefined) {
    const asked = requestedSeconds(schema, input);
    if (asked !== undefined && asked + 1e-9 < seconds) {
      errors.push(
        `${where}: the clip must last the whole shot (${round1(seconds)} s); "${endpoint}" is asked for ${asked} s.`,
      );
    }
  }
  return errors;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Sentences that ask for something, not the ones that rule something out. */
export const affirmed = (text: string) =>
  text.split(/(?<=[.!?;])\s+/).filter((s) => !/\b(no|not|never|without|nor|avoid)\b/i.test(s));
const norm = (s: unknown) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The product or packaging a request text asks for: a product's name
 * anywhere, packaging only where it is wanted ("no labels or packaging" is
 * what every request should say).
 */
export const namedInRequest = (text: string, productNames: readonly string[]): string | null =>
  namedProduct(text, productNames) ??
  affirmed(text)
    .map(namedPackaging)
    .find((w): w is string => Boolean(w)) ??
  null;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The number appears as such in what the tools returned ("0.08" in "$0.08/s", not in "0.085"). */
const numberCited = (evidence: string, n: number) =>
  new RegExp(`(^|[^0-9.])${escapeRe(String(n))}(?![0-9])`).test(evidence);

/** A minimum length stated as one ("minimum 5 s", "at least 5 seconds", "5s minimum"). */
function minimumCited(evidence: string, n: number): boolean {
  const sec = `${escapeRe(String(n))}\\s*(?:-\\s*)?(?:s|sec|secs|seconds?)\\b`;
  return new RegExp(
    `(?:min(?:imum)?|at least|shortest|bills?)[^.\\n]{0,60}?(?:^|[^0-9.])${sec}|${sec}[^.\\n]{0,20}?min`,
    "i",
  ).test(evidence);
}

function readBilling(
  raw: RawBilling | null | undefined,
  record: ToolRecord,
): { billing?: Billing; problems: string[] } {
  if (!raw) return { problems: [] };
  const evidence = record.evidence ?? "";
  const problems: string[] = [];
  const billing: Billing = { source: norm(raw.source) };
  if (raw.unit_price !== null && raw.unit_price !== undefined) {
    const usd = Number(raw.unit_price);
    if (!(usd > 0) || !raw.unit) problems.push("billing: give unit_price with its unit.");
    else if (!numberCited(evidence, usd)) {
      problems.push(
        `billing: ${usd} per ${raw.unit} is not in any guide, schema or catalogue answer you read; give only prices the tools returned.`,
      );
    } else {
      billing.usd = usd;
      billing.unit = norm(raw.unit);
    }
  }
  if (raw.min_seconds !== null && raw.min_seconds !== undefined) {
    const min = Number(raw.min_seconds);
    if (!(min > 0)) problems.push("billing: min_seconds is a number of seconds.");
    else if (!minimumCited(evidence, min)) {
      problems.push(
        `billing: no tool result you read states a ${min}-second minimum; give only minimums the tools returned.`,
      );
    } else {
      billing.minSeconds = min;
    }
  }
  return {
    ...(billing.usd !== undefined || billing.minSeconds !== undefined ? { billing } : {}),
    problems,
  };
}

/** Seconds a planned shot lasts on screen: its words, plus its hold. */
export const plannedShotSec = (shot: { text: string; hold?: number }) =>
  estimatePartSec(shot.text) + (shot.hold ?? 0);

/**
 * Turns the live director's JSON into a plan and lists every rule it breaks
 * that a machine can check: the dialogue rules of the fixed pipeline, then
 * keyframes, routes, schemas, durations, placeholders and products.
 */
export function readLivePlan(
  answer: LiveAnswer,
  ctx: LiveContext,
  record: ToolRecord,
): { plan: LivePlan; errors: string[] } {
  const { plan: shots, errors } = readDirectorAnswer(answer, ctx);
  const byName = new Map(ctx.cast.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const productNames = ctx.products.map((p) => p.name);
  const productText = (text: string) => namedInRequest(text, productNames);

  // Keyframes, in the order they are made: each may use earlier ones.
  const keyframes: PlannedKeyframe[] = [];
  const ids = new Set<string>();
  for (const [i, raw] of (Array.isArray(answer.keyframes) ? answer.keyframes : []).entries()) {
    const id = norm(raw.id) || `k${i + 1}`;
    const where = `Keyframe "${id}"`;
    if (ids.has(id)) errors.push(`${where}: ids must be unique.`);
    const kind = KEYFRAME_KINDS.includes(raw.kind as KeyframeKind)
      ? (raw.kind as KeyframeKind)
      : null;
    if (!kind) errors.push(`${where}: kind must be one of ${KEYFRAME_KINDS.join(", ")}.`);
    const characterId = raw.character
      ? (byName.get(norm(raw.character).toLowerCase()) ?? null)
      : null;
    if (raw.character && !characterId)
      errors.push(`${where}: "${raw.character}" is not in the cast.`);
    const input = obj(raw.input);
    const endpoint = norm(raw.endpoint);
    if (!endpoint) errors.push(`${where}: name the image model's endpoint.`);
    else errors.push(...inputErrors(where, endpoint, input, record));
    for (const p of placeholdersIn(input)) {
      const earlier = /^keyframe:(.+)$/.exec(p)?.[1];
      if (earlier ? !ids.has(earlier) : !ctx.refs.includes(p)) {
        errors.push(
          `${where}: "{{${p}}}" is not a file you were given${earlier ? " or an earlier keyframe" : ""}.`,
        );
      }
    }
    if (!placeholdersIn(input).length) {
      errors.push(`${where}: make it from references (place, cast or an earlier keyframe).`);
    }
    const named = [raw.framing, ...textsIn(input)].map((t) => productText(norm(t))).find(Boolean);
    if (named) {
      errors.push(`${where}: products are never generated; describe it without "${named}".`);
    }
    ids.add(id);
    keyframes.push({
      id,
      kind: kind ?? "action",
      characterId,
      framing: norm(raw.framing),
      references: placeholdersIn(input),
      endpoint,
      input,
      why: norm(raw.why),
    });
  }
  if (ctx.hasPlace && !keyframes.some((k) => k.kind === "master")) {
    errors.push("Make one master keyframe of the whole scene first; the others are drawn from it.");
  }

  const routes: PlannedRoute[] = (Array.isArray(answer.shots) ? answer.shots : []).map((raw, i) => {
    const where = `Shot ${i + 1}`;
    const shot = shots.shots[i];
    const route = ROUTES.includes(raw.route as Route) ? (raw.route as Route) : null;
    if (!route) errors.push(`${where}: route must be one of ${ROUTES.join(", ")}.`);
    const keyframe = raw.keyframe ? norm(raw.keyframe) : null;
    const endpoint = raw.endpoint ? norm(raw.endpoint) : null;
    const input = raw.input && typeof raw.input === "object" ? obj(raw.input) : null;
    if (shot?.productId) {
      if (route !== "product")
        errors.push(`${where}: a product is only shown by the product route.`);
    } else if (route === "product") {
      errors.push(`${where}: the product route is only for a product detail shot.`);
    }
    if (route === "product" || route === "still-move") {
      if (endpoint) errors.push(`${where}: the ${route} route is made locally; no endpoint.`);
    }
    if (route && route !== "product" && (!keyframe || !ids.has(keyframe))) {
      errors.push(`${where}: start from one of the keyframes (by id).`);
    }
    if (route === "product" && keyframe && !ids.has(keyframe)) {
      errors.push(`${where}: keyframe "${keyframe}" does not exist.`);
    }
    if (shot?.kind === "speaker" && route && route !== "lip-sync") {
      errors.push(`${where}: a speaker shot is lip-synced.`);
    }
    if (route === "lip-sync" && shot && shot.kind !== "speaker" && shot.kind !== "listener") {
      errors.push(`${where}: only speaker and listener shots are lip-synced.`);
    }
    if (route && PAID_ROUTES.includes(route)) {
      if (!endpoint || !input) {
        errors.push(`${where}: the ${route} route needs an endpoint and its exact input.`);
      } else {
        const seconds = shot ? plannedShotSec(shot) : undefined;
        errors.push(
          ...inputErrors(where, endpoint, input, record, route === "motion" ? seconds : undefined),
        );
        const used = placeholdersIn(input);
        const allowed = route === "lip-sync" ? ["keyframe", "audio"] : ["keyframe"];
        for (const p of used) {
          const other = /^keyframe:(.+)$/.exec(p)?.[1];
          if (other ? !ids.has(other) : !allowed.includes(p)) {
            errors.push(`${where}: "{{${p}}}" cannot be resolved here.`);
          }
        }
        if (!used.includes("keyframe"))
          errors.push(`${where}: pass the keyframe as "{{keyframe}}".`);
        if (route === "lip-sync" && !used.includes("audio")) {
          errors.push(`${where}: pass the shot's audio as "{{audio}}".`);
        }
        const named = textsIn(input)
          .map((t) => productText(norm(t)))
          .find(Boolean);
        if (named) errors.push(`${where}: never name "${named}" in a request.`);
      }
    }
    return { route: route ?? "still-move", keyframe, endpoint, input };
  });

  const models = (Array.isArray(answer.models) ? answer.models : [])
    .filter((m) => m.endpoint)
    .map((m) => {
      const endpoint = norm(m.endpoint);
      const billing = readBilling(m.billing, record);
      for (const problem of billing.problems) errors.push(`Models: "${endpoint}" ${problem}`);
      return {
        endpoint,
        name: modelName(record.schemas, endpoint),
        role: norm(m.role),
        why: norm(m.why),
        decisionId: m.decision_id ? norm(m.decision_id) : null,
        ...(billing.billing ? { billing: billing.billing } : {}),
      };
    });
  const used = new Set([
    ...keyframes.map((k) => k.endpoint),
    ...routes.flatMap((r) => (r.endpoint ? [r.endpoint] : [])),
  ]);
  for (const endpoint of used) {
    if (endpoint && !models.some((m) => m.endpoint === endpoint)) {
      errors.push(`Models: list "${endpoint}" with its role and why it was chosen.`);
    }
  }

  return {
    plan: {
      shots,
      keyframes,
      routes,
      models,
      level: ctx.level.id,
      guidanceNote: norm(answer.guidance_note),
    },
    errors: [...new Set(errors)],
  };
}

// ---------------------------------------------------------------------------
// Prices, from recorded tool results only
// ---------------------------------------------------------------------------

/** A model's display name, never the middleman's: the schema's name without "fal". */
export function modelName(schemas: Record<string, ModelSchema>, endpoint: string): string {
  const name = schemas[endpoint]?.name || endpoint.split("/").slice(1).join(" ");
  return (
    name
      .replace(/\bfal(\.ai)?\b/gi, "")
      .replace(/\s+/g, " ")
      .trim() || "Mô hình"
  );
}

/**
 * What one model costs and takes, as the session recorded it: its rate (the
 * recorded one, raised by a verified billing rule), a per-request estimate
 * when the rate's unit cannot be counted, and its shortest billed length.
 */
export interface Rate {
  usd: number | null;
  unit: string;
  /** From estimate_cost, for one typical request, when `unit` cannot be counted. */
  perRequestUsd?: number;
  /** Shortest audio or clip billed (and accepted), from the schema or a verified rule. */
  minSeconds?: number;
}

const unitKind = (unit = "") =>
  /second/i.test(unit)
    ? "seconds"
    : /minute/i.test(unit)
      ? "minutes"
      : /image/i.test(unit)
        ? "images"
        : unit.toLowerCase();

/**
 * A shortest audio length stated for this endpoint in what the tools returned:
 * an audio field's "at least N s" within a short stretch after its id.
 */
export function evidenceMinimumSec(evidence: string, endpoint: string): number | undefined {
  let found: number | undefined;
  for (let i = evidence.indexOf(endpoint); i >= 0; i = evidence.indexOf(endpoint, i + 1)) {
    const window = evidence.slice(i, i + 1000).replace(/\\n/g, "\n");
    const m =
      /audio[^.\n]{0,80}?(?:at least|minimum(?: of)?)\s*(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds?)\b/i.exec(
        window,
      );
    if (m) found = Math.max(found ?? 0, Number(m[1]));
  }
  return found;
}

/** The rate of one endpoint, from the record and the plan's verified billing rule. */
export function rateOf(record: ToolRecord, endpoint: string, billing?: Billing): Rate {
  const recorded = record.prices[endpoint];
  const schema = record.schemas[endpoint];
  let usd = recorded?.usd ?? null;
  let unit = recorded?.unit ?? "";
  if (billing?.usd !== undefined && billing.unit) {
    if (usd === null) {
      usd = billing.usd;
      unit = billing.unit;
    } else if (unitKind(unit) === unitKind(billing.unit) && billing.usd > usd) {
      usd = billing.usd;
    }
  }
  const estimate = record.estimates.findLast((e) => e.endpoint === endpoint);
  const minSeconds =
    Math.max(
      billing?.minSeconds ?? 0,
      schema?.minAudioSec ?? 0,
      evidenceMinimumSec(record.evidence ?? "", endpoint) ?? 0,
    ) || undefined;
  return {
    usd,
    unit,
    ...(estimate && !/second|minute/i.test(estimate.unit ?? "")
      ? { perRequestUsd: estimate.usd }
      : {}),
    ...(minSeconds ? { minSeconds } : {}),
  };
}

/** Billable units of one request, by the price's unit; null when it cannot be known here. */
export function unitsFor(
  unit: string,
  input: Input,
  schema: ModelSchema | undefined,
  seconds: number,
): number | null {
  const u = unit.toLowerCase();
  if (/second|minute/.test(u)) {
    const asked = schema ? requestedSeconds(schema, input) : undefined;
    const sec = asked ?? seconds;
    return /minute/.test(u) ? sec / 60 : sec;
  }
  if (/image/.test(u)) return Number(input.num_images ?? 1) || 1;
  if (/megapixel/.test(u)) {
    const size = obj(input.image_size);
    const w = Number(size.width ?? input.width);
    const h = Number(size.height ?? input.height);
    return w > 0 && h > 0 ? Math.ceil((w * h) / 1e6) : null;
  }
  if (/video|request|call|generation|\brun/.test(u)) return 1;
  return null;
}

/**
 * The input with its length field set so the clip covers `seconds`: the
 * smallest allowed value at least that long (whole seconds for an integer
 * field), within the schema's limits. Unchanged when the model has no such field.
 */
export function fitDuration(
  schema: ModelSchema | undefined,
  input: Input,
  seconds: number,
): { input: Input; seconds: number | undefined } {
  const param = schema?.params.find((p) => DURATION_FIELDS.includes(p.name));
  if (!schema || !param) return { input, seconds: undefined };
  const asked = Number(input[param.name] ?? param.default);
  if (param.enum?.length) {
    const values = param.enum
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const pick =
      values.find((v) => v + 1e-9 >= Math.max(seconds, Number.isFinite(asked) ? asked : 0)) ??
      values.at(-1);
    if (pick === undefined) return { input, seconds: undefined };
    const raw = param.enum.find((v) => Number(v) === pick) as string | number;
    return { input: { ...input, [param.name]: raw }, seconds: pick };
  }
  const whole = /int/i.test(param.type);
  let want = Math.max(seconds, Number.isFinite(asked) ? asked : 0);
  if (whole) want = Math.ceil(want - 1e-9);
  if (param.min !== undefined) want = Math.max(param.min, want);
  if (param.max !== undefined) want = Math.min(param.max, want);
  return { input: { ...input, [param.name]: want }, seconds: want };
}

/**
 * Seconds a lip-sync request is sent and billed: its audio, never under the
 * model's minimum (shorter audio is padded with silence and trimmed later).
 */
export const lipSyncSeconds = (rate: Rate | undefined, audioSec: number) =>
  Math.max(MIN_AUDIO_SEC, audioSec, rate?.minSeconds ?? 0);

/** One paid request's price and quantity. */
export function requestCost(
  rate: Rate | undefined,
  schema: ModelSchema | undefined,
  input: Input,
  route: Route | "keyframe",
  seconds: number,
): { usd: number | null; quantity: string } {
  let billed = seconds;
  let body = input;
  if (route === "lip-sync") billed = lipSyncSeconds(rate, seconds);
  if (route === "motion") {
    const fitted = fitDuration(schema, input, seconds);
    body = fitted.input;
    billed = fitted.seconds ?? seconds;
  }
  const label = (unit: string, units: number) =>
    /second|minute/i.test(unit)
      ? `${round1(billed)} giây`
      : /image/i.test(unit)
        ? `${units} ảnh`
        : `${units} lần`;
  if (rate?.usd !== null && rate?.usd !== undefined) {
    const units = unitsFor(rate.unit, body, schema, billed);
    if (units !== null) return { usd: units * rate.usd, quantity: label(rate.unit, units) };
  }
  if (rate?.perRequestUsd !== undefined) return { usd: rate.perRequestUsd, quantity: "1 lần" };
  return { usd: null, quantity: route === "keyframe" ? "" : `${round1(billed)} giây` };
}

export interface CostRow {
  /** Vietnamese label of the step. */
  step: string;
  /** Model display name; null for our own or local steps. */
  model: string | null;
  /** "5 giây", "1 ảnh"; empty when free. */
  quantity: string;
  /** null: no recorded price fits this step. */
  usd: number | null;
  /** Already made and charged: `usd` is what it cost, not an estimate. */
  paid?: boolean;
}

export interface CostTable {
  rows: CostRow[];
  knownUsd: number;
  unknownSteps: number;
  budgetUsd: number;
  /** Seconds the plan lasts, holds included. */
  seconds: number;
}

export const ROUTE_LABEL: Record<Route, string> = {
  "lip-sync": "Khẩu hình",
  motion: "Chuyển động",
  "still-move": "Ảnh trượt",
  product: "Sản phẩm",
};

/** Rates and schemas of the endpoints a plan uses: all a job needs to price and send it. */
export function planRates(
  plan: LivePlan,
  record: ToolRecord,
): { rates: Record<string, Rate>; schemas: Record<string, ModelSchema> } {
  const used = new Set([
    ...plan.keyframes.map((k) => k.endpoint),
    ...plan.routes.flatMap((r) => (r.endpoint ? [r.endpoint] : [])),
  ]);
  const rates: Record<string, Rate> = {};
  const schemas: Record<string, ModelSchema> = {};
  for (const endpoint of used) {
    const billing = plan.models.find((m) => m.endpoint === endpoint)?.billing;
    rates[endpoint] = rateOf(record, endpoint, billing);
    const schema = record.schemas[endpoint];
    if (schema) schemas[endpoint] = schema;
  }
  return { rates, schemas };
}

/** A step of the plan with the seconds it lasts (planned, or once known, actual). */
export interface PricedStep {
  step: string;
  endpoint: string | null;
  input: Input | null;
  route: Route | "keyframe" | "voice" | "local";
  seconds: number;
  /** Already known (charged, or ours): used as is. */
  usd?: number;
}

/** A cost table from steps; every price from the rates, unknown when none fits. */
export function costTable(
  steps: PricedStep[],
  rates: Record<string, Rate>,
  schemas: Record<string, ModelSchema>,
  budgetUsd: number,
  seconds: number,
): CostTable {
  const rows: CostRow[] = steps.map((s) => {
    if (s.usd !== undefined || !s.endpoint || !s.input) {
      return {
        step: s.step,
        model: s.endpoint ? modelName(schemas, s.endpoint) : null,
        quantity: "",
        usd: s.usd ?? 0,
      };
    }
    const { usd, quantity } = requestCost(
      rates[s.endpoint],
      schemas[s.endpoint],
      s.input,
      s.route as Route | "keyframe",
      s.seconds,
    );
    return { step: s.step, model: modelName(schemas, s.endpoint), quantity, usd };
  });
  return {
    rows,
    knownUsd: rows.reduce((n, r) => n + (r.usd ?? 0), 0),
    unknownSteps: rows.filter((r) => r.usd === null).length,
    budgetUsd,
    seconds,
  };
}

/** The plan's steps before anything is made: planned seconds. */
export function planSteps(plan: LivePlan, lines: Pick<ScriptLine, "text">[]): PricedStep[] {
  const steps: PricedStep[] = [
    {
      step: "Giọng đọc",
      endpoint: null,
      input: null,
      route: "voice",
      seconds: 0,
      usd: estimateVoiceUsd(lines),
    },
  ];
  for (const k of plan.keyframes) {
    steps.push({
      step: `Khung hình ${k.id}`,
      endpoint: k.endpoint,
      input: k.input,
      route: "keyframe",
      seconds: 0,
    });
  }
  plan.shots.shots.forEach((shot, i) => {
    const route = plan.routes[i];
    if (!route) return;
    const paid = PAID_ROUTES.includes(route.route) && route.endpoint && route.input;
    steps.push({
      step: `Cảnh ${i + 1} · ${ROUTE_LABEL[route.route]}`,
      endpoint: paid ? route.endpoint : null,
      input: paid ? route.input : null,
      route: paid ? route.route : "local",
      seconds: plannedShotSec(shot),
    });
  });
  return steps;
}

/**
 * The plan's cost table: our voice, every keyframe, every shot. Each paid
 * step is priced from the session's recorded prices; a step with none is
 * unknown and counted as such, never guessed.
 */
export function priceLivePlan(
  plan: LivePlan,
  record: ToolRecord,
  lines: Pick<ScriptLine, "text">[],
  level: MediaLevel,
): CostTable {
  const { rates, schemas } = planRates(plan, record);
  const steps = planSteps(plan, lines);
  return costTable(
    steps,
    rates,
    schemas,
    // The same length the app shows everywhere else for this script (holds included).
    levelEstimateUsd(level, estimateSeconds(lines)),
    steps.reduce((n, s) => n + s.seconds, 0),
  );
}

/** Operations recommend_model answers for each paid route. */
const ROUTE_OPERATIONS: Record<"lip-sync" | "motion", string[]> = {
  "lip-sync": ["lip-sync", "talking-avatar"],
  motion: ["image-to-video"],
};

/** The model takes what the route sends: an image, and audio for lip-sync. */
function takesRoute(schema: ModelSchema, route: "lip-sync" | "motion") {
  const names = schema.params.map((p) => p.name);
  const image = names.some((n) => /image/i.test(n) && !/end|last|tail/i.test(n));
  return route === "lip-sync" ? image && names.some((n) => /audio/i.test(n)) : image;
}

/**
 * Cheaper models the session itself found fit for a route, priced on this
 * plan's own shots (minimum lengths and per-second rates included). Each
 * becomes a warning that names it; the director's choice is not changed.
 */
export function cheaperAlternatives(plan: LivePlan, record: ToolRecord): string[] {
  const { rates, schemas } = planRates(plan, record);
  const warnings: string[] = [];
  for (const route of ["lip-sync", "motion"] as const) {
    const shots = plan.shots.shots
      .map((shot, i) => ({ shot, r: plan.routes[i] }))
      .filter(({ r }) => r?.route === route && r.endpoint && r.input);
    if (!shots.length) continue;
    const chosen = shots.reduce((n, { shot, r }) => {
      const cost = requestCost(
        rates[r?.endpoint as string],
        schemas[r?.endpoint as string],
        r?.input as Input,
        route,
        plannedShotSec(shot),
      ).usd;
      return cost === null ? Number.NaN : n + cost;
    }, 0);
    if (!Number.isFinite(chosen)) continue;
    const used = new Set(shots.map(({ r }) => r?.endpoint));
    const candidates = ROUTE_OPERATIONS[route].flatMap((op) => record.candidates?.[op] ?? []);
    let best: { endpoint: string; usd: number } | null = null;
    for (const endpoint of new Set(candidates)) {
      const schema = record.schemas[endpoint];
      if (used.has(endpoint) || !schema || !takesRoute(schema, route)) continue;
      const rate = rateOf(record, endpoint);
      if (rate.usd === null || !/second|minute/i.test(rate.unit)) continue;
      const usd = shots.reduce(
        (n, { shot }) => n + (requestCost(rate, schema, {}, route, plannedShotSec(shot)).usd ?? 0),
        0,
      );
      if (!best || usd < best.usd) best = { endpoint, usd };
    }
    if (best && best.usd < chosen * 0.85 && chosen - best.usd >= 0.1) {
      warnings.push(
        `${ROUTE_LABEL[route]}: ${modelName(record.schemas, best.endpoint)} would cost ~$${best.usd.toFixed(2)} for these shots instead of ~$${chosen.toFixed(2)}${rateOf(record, best.endpoint).minSeconds ? "" : " (no minimum length recorded for it)"}.`,
      );
    }
  }
  return warnings;
}

/**
 * The guide is the typical price of a video of this length, so a plan near it
 * is normal: only one clearly above it (a quarter more) is called out.
 */
export const overBudget = (table: Pick<CostTable, "knownUsd" | "budgetUsd">) =>
  table.knownUsd > table.budgetUsd * 1.25;

/** Warnings shown with the plan: over the guide budget, unknown prices. */
export function costWarnings(table: CostTable): string[] {
  const warnings: string[] = [];
  if (overBudget(table)) {
    warnings.push(
      `Over the guide budget: ~$${table.knownUsd.toFixed(2)} of $${table.budgetUsd.toFixed(2)}.`,
    );
  }
  if (table.unknownSteps) warnings.push(`${table.unknownSteps} step(s) have no recorded price.`);
  return warnings;
}

/** What a job keeps of its live direction: the plan, its prices and how it was made. */
export interface LiveDirection {
  plan: LivePlan;
  /** The table as planned, before anything was made. */
  costs: CostTable;
  warnings: string[];
  /** Rates and schemas of the endpoints used: what the job prices and sends by. */
  rates: Record<string, Rate>;
  schemas: Record<string, ModelSchema>;
  /** "recipe": built in code from a shot list and a recipe (no tools, src/shared/build-direction.ts). */
  connection: "signed-in" | "key" | "recipe";
  /** The recipe a built direction was made from. */
  recipe?: { id: string; source: "builtin" | "plan" | "session" };
  /** Tools called, in order, without their server prefix. */
  tools: string[];
  guidance: Retrieval;
  /** The Claude model that directed. */
  model: string | null;
  /** Seconds the session took. */
  seconds: number;
}

/** The live direction a job keeps, from an accepted plan and the session's record. */
export function liveDirection(
  plan: LivePlan,
  record: ToolRecord,
  lines: Pick<ScriptLine, "text">[],
  level: MediaLevel,
  run: { connection: LiveDirection["connection"]; model: string | null; ms: number },
): LiveDirection {
  const costs = priceLivePlan(plan, record, lines, level);
  return {
    plan,
    costs,
    warnings: [...costWarnings(costs), ...cheaperAlternatives(plan, record)],
    ...planRates(plan, record),
    connection: run.connection,
    tools: record.calls.map((c) => c.tool),
    guidance: record.guidance,
    model: run.model,
    seconds: Math.round(run.ms / 1000),
  };
}

/** Earlier keyframes a keyframe is made from (its `{{keyframe:<id>}}` references). */
export const keyframeDeps = (live: LiveDirection, id: string): string[] =>
  placeholdersIn(live.plan.keyframes.find((k) => k.id === id)?.input ?? {})
    .map((p) => /^keyframe:(.+)$/.exec(p)?.[1])
    .filter((d): d is string => Boolean(d));

/** One keyframe's price; null when no recorded price fits. */
export function liveFrameUsd(live: LiveDirection, id: string): number | null {
  const k = live.plan.keyframes.find((x) => x.id === id);
  if (!k) return null;
  return requestCost(live.rates[k.endpoint], live.schemas[k.endpoint], k.input, "keyframe", 0).usd;
}

/**
 * One planned shot's price for `seconds` (its audio for lip-sync, its length
 * for motion); 0 for a shot made locally, null when no recorded price fits.
 */
export function liveShotUsd(live: LiveDirection, index: number, seconds: number): number | null {
  const r = live.plan.routes[index];
  if (!r?.endpoint || !r.input || !PAID_ROUTES.includes(r.route)) return 0;
  return requestCost(live.rates[r.endpoint], live.schemas[r.endpoint], r.input, r.route, seconds)
    .usd;
}

/** The first media URL in a result: `images[0]`, `image`, `video`, `videos[0]`, else any. */
export function readMediaUrl(data: unknown, kind: "image" | "video"): string | undefined {
  const d = (data ?? {}) as Record<string, unknown>;
  const pick = (v: unknown) =>
    v && typeof v === "object" && typeof (v as { url?: unknown }).url === "string"
      ? (v as { url: string }).url
      : undefined;
  const direct =
    kind === "image"
      ? (pick((d.images as unknown[] | undefined)?.[0]) ?? pick(d.image))
      : (pick(d.video) ?? pick((d.videos as unknown[] | undefined)?.[0]));
  if (direct) return direct;
  const ext = kind === "image" ? /\.(png|jpe?g|webp)(\?|$)/i : /\.(mp4|mov|webm)(\?|$)/i;
  let found: string | undefined;
  const walk = (v: unknown) => {
    if (found) return;
    if (typeof v === "string" && /^https:\/\//.test(v) && ext.test(v)) found = v;
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(d);
  return found;
}
