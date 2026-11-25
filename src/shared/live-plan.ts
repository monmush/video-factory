import { estimateVoiceUsd } from "./board";
import type { ScriptLine } from "./ipc";
import type { MediaLevel, MediaLevelId } from "./media-level";
import {
  type DirectorAnswer,
  estimatePartSec,
  namedInRequest,
  type PlanContext,
  readDirectorAnswer,
  type ShotPlan,
} from "./shot-plan";

export type Route = "lip-sync" | "motion" | "still-move" | "product";
const ROUTES: Route[] = ["lip-sync", "motion", "still-move", "product"];
export const PAID_ROUTES: readonly Route[] = ["lip-sync", "motion"];

export type KeyframeKind = "master" | "character" | "action" | "plate";
const KEYFRAME_KINDS: KeyframeKind[] = ["master", "character", "action", "plate"];

export const SHORTEST_AUDIO_A_SPEAKING_SHOT_IS_GIVEN_SEC = 2;

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
  minAudioSec?: number;
}

export interface UnitPrice {
  usd: number;
  unit: string;
}

export type Retrieval = "complete" | "partial" | "unavailable" | "not-asked";

export interface ToolRecord {
  calls: { tool: string; ok: boolean }[];
  schemas: Record<string, ModelSchema>;
  prices: Record<string, UnitPrice>;
  estimates: { endpoint: string; usd: number; quantity?: number; unit?: string }[];
  decisions: Record<string, string[]>;
  candidates?: Record<string, string[]>;
  guidance: Retrieval;
  evidence?: string;
}

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
  guidance_note?: string;
}

interface RawBilling {
  unit_price?: number | null;
  unit?: string | null;
  min_seconds?: number | null;
  source?: string | null;
}

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
  people?: number;
  references: string[];
  endpoint: string;
  input: Input;
  why: string;
  description?: string;
  peopleIds?: string[];
  material?: string;
}

export interface PlannedRoute {
  route: Route;
  keyframe: string | null;
  endpoint: string | null;
  input: Input | null;
}

export interface LivePlan {
  shots: ShotPlan;
  keyframes: PlannedKeyframe[];
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
  refs: string[];
  level: MediaLevel;
}

const PLACEHOLDER = /^\{\{\s*([^{}]+?)\s*\}\}$/;
export const placeholderOf = (v: unknown) =>
  typeof v === "string" ? (PLACEHOLDER.exec(v)?.[1] ?? null) : null;

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

function textsIn(value: unknown): string[] {
  if (typeof value === "string") return placeholderOf(value) ? [] : [value];
  if (Array.isArray(value)) return value.flatMap(textsIn);
  if (value && typeof value === "object") return Object.values(value).flatMap(textsIn);
  return [];
}

export const DURATION_FIELDS = ["duration", "duration_seconds", "seconds", "num_seconds"];

function requestedSeconds(schema: ModelSchema, input: Input): number | undefined {
  for (const name of DURATION_FIELDS) {
    const param = schema.params.find((p) => p.name === name);
    if (!param) continue;
    const value = Number(input[name] ?? param.default);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

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

const norm = (s: unknown) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const numberCited = (evidence: string, n: number) =>
  new RegExp(`(^|[^0-9.])${escapeRe(String(n))}(?![0-9])`).test(evidence);

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

export const plannedShotSec = (shot: { text: string; hold?: number }) =>
  estimatePartSec(shot.text) + (shot.hold ?? 0);

export function readLivePlan(
  answer: LiveAnswer,
  ctx: LiveContext,
  record: ToolRecord,
): { plan: LivePlan; errors: string[] } {
  const { plan: shots, errors } = readDirectorAnswer(answer, ctx);
  const byName = new Map(ctx.cast.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const productNames = ctx.products.map((p) => p.name);
  const productText = (text: string) => namedInRequest(text, productNames);

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

export function modelName(schemas: Record<string, ModelSchema>, endpoint: string): string {
  const name = schemas[endpoint]?.name || endpoint.split("/").slice(1).join(" ");
  return (
    name
      .replace(/\bfal(\.ai)?\b/gi, "")
      .replace(/\s+/g, " ")
      .trim() || "Mô hình"
  );
}

export interface Rate {
  usd: number | null;
  unit: string;
  perRequestUsd?: number;
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

function rateOf(record: ToolRecord, endpoint: string, billing?: Billing): Rate {
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

const lipSyncSeconds = (rate: Rate | undefined, audioSec: number) =>
  Math.max(SHORTEST_AUDIO_A_SPEAKING_SHOT_IS_GIVEN_SEC, audioSec, rate?.minSeconds ?? 0);

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
  step: string;
  model: string | null;
  quantity: string;
  usd: number | null;
  paid?: boolean;
}

export interface CostTable {
  rows: CostRow[];
  knownUsd: number;
  unknownSteps: number;
  seconds: number;
}

export const ROUTE_LABEL: Record<Route, string> = {
  "lip-sync": "Nói",
  motion: "Chuyển động",
  "still-move": "Ảnh trượt",
  product: "Sản phẩm",
};

function planRates(
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

export interface PricedStep {
  step: string;
  endpoint: string | null;
  input: Input | null;
  route: Route | "keyframe" | "voice" | "local";
  seconds: number;
  usd?: number;
}

export function costTable(
  steps: PricedStep[],
  rates: Record<string, Rate>,
  schemas: Record<string, ModelSchema>,
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
    seconds,
  };
}

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

export function priceLivePlan(
  plan: LivePlan,
  record: ToolRecord,
  lines: Pick<ScriptLine, "text">[],
): CostTable {
  const { rates, schemas } = planRates(plan, record);
  const steps = planSteps(plan, lines);
  return costTable(
    steps,
    rates,
    schemas,
    steps.reduce((n, s) => n + s.seconds, 0),
  );
}

const ROUTE_OPERATIONS: Record<"lip-sync" | "motion", string[]> = {
  "lip-sync": ["lip-sync", "talking-avatar"],
  motion: ["image-to-video"],
};

function takesRoute(schema: ModelSchema, route: "lip-sync" | "motion") {
  const names = schema.params.map((p) => p.name);
  const image = names.some((n) => /image/i.test(n) && !/end|last|tail/i.test(n));
  return route === "lip-sync" ? image && names.some((n) => /audio/i.test(n)) : image;
}

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

export const unknownPriceWarnings = (table: Pick<CostTable, "unknownSteps">): string[] =>
  table.unknownSteps ? [`${table.unknownSteps} step(s) have no recorded price.`] : [];

export interface LiveDirection {
  plan: LivePlan;
  costs: CostTable;
  warnings: string[];
  rates: Record<string, Rate>;
  schemas: Record<string, ModelSchema>;
  connection: "signed-in" | "key" | "recipe";
  recipe?: { id: string; source: "builtin" | "plan" | "session" };
  tools: string[];
  guidance: Retrieval;
  model: string | null;
  seconds: number;
}

export function liveDirection(
  plan: LivePlan,
  record: ToolRecord,
  lines: Pick<ScriptLine, "text">[],
  run: { connection: LiveDirection["connection"]; model: string | null; ms: number },
): LiveDirection {
  const costs = priceLivePlan(plan, record, lines);
  return {
    plan,
    costs,
    warnings: [...unknownPriceWarnings(costs), ...cheaperAlternatives(plan, record)],
    ...planRates(plan, record),
    connection: run.connection,
    tools: record.calls.map((c) => c.tool),
    guidance: record.guidance,
    model: run.model,
    seconds: Math.round(run.ms / 1000),
  };
}

export const keyframeDeps = (live: LiveDirection, id: string): string[] =>
  placeholdersIn(live.plan.keyframes.find((k) => k.id === id)?.input ?? {})
    .map((p) => /^keyframe:(.+)$/.exec(p)?.[1])
    .filter((d): d is string => Boolean(d));

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
