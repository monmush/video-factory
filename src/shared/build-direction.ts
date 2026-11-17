import { estimateSeconds, levelEstimateUsd } from "./board";
import type { ScriptLine } from "./ipc";
import {
  costTable,
  costWarnings,
  emptyRecord,
  fitDuration,
  inputErrors,
  type LiveDirection,
  type LivePlan,
  type ModelSchema,
  type PlannedKeyframe,
  type PlannedRoute,
  plannedShotSec,
  planSteps,
  type Rate,
} from "./live-plan";
import type { MediaLevel } from "./media-level";
import {
  STILL_BEFORE_SPEAKING,
  STILL_FORMAT,
  STILL_IDENTITY,
  STILL_NO_TEXT,
  speakPrompt,
} from "./prompt-text";
import {
  DEFAULT_MAX_REFERENCES,
  PROMPT_SLOT,
  REFERENCES_SLOT,
  type Recipe,
  type RoleModel,
} from "./recipe";
import type { Picture, ShotList } from "./shot-list";

// The build (docs/PLAN_PHASE_PROPOSAL.md, part 3): a checked shot list and a
// recipe become the live direction a job keeps, so the executor, the prices
// and the plan table read it as they read a live director's plan. Code
// chooses the reference photos, writes the still prompts and fits lengths.
// Pure and deterministic: the same list and recipe give the same requests.

/** Photos of one person a picture is sent with: the main person, then everyone else. */
const MAIN_PERSON_PHOTOS = 3;
const OTHER_PERSON_PHOTOS = 2;
/** Place photos the master is made from. */
const MASTER_PLACE_PHOTOS = 2;
/** Photos per cast member in the master. */
const MASTER_PERSON_PHOTOS = 3;
/** Photos per person the files offer (as `liveFiles` in src/main/video/director.ts). */
const PHOTOS_PER_PERSON = 3;

export interface BuildInput {
  list: ShotList;
  recipe: Recipe;
  lines: Pick<ScriptLine, "text">[];
  level: MediaLevel;
  /** In order of first speaking (cast1, cast2…), with how many photos each has. */
  cast: { id: string; name: string; photos: number }[];
  /** Photos of the place (place-1, place-2…). */
  placePhotos: number;
  /** The directing call that made the list, when there was one. */
  run?: { model: string | null; ms: number };
}

interface Ref {
  placeholder: string;
  /** What the legend calls it: "the place", "the master scene", a name. */
  what: string;
}

/** "Images 1-2 are the place. Image 3 is An." */
export function legend(refs: Ref[]): string {
  const groups: { what: string; from: number; to: number }[] = [];
  refs.forEach((r, i) => {
    const last = groups.at(-1);
    if (last && last.what === r.what && last.to === i) last.to = i + 1;
    else groups.push({ what: r.what, from: i + 1, to: i + 1 });
  });
  return groups
    .map((g) =>
      g.from === g.to ? `Image ${g.from} is ${g.what}.` : `Images ${g.from}-${g.to} are ${g.what}.`,
    )
    .join(" ");
}

const sentence = (s: string) => {
  const t = s.trim();
  if (!t) return "";
  const up = `${t.charAt(0).toUpperCase()}${t.slice(1)}`;
  return /[.!?]$/.test(up) ? up : `${up}.`;
};

/** A template with its slots filled: whole-string slots replaced, the references slot expanded. */
function fill(template: unknown, slots: { prompt?: string; references?: string[] }): unknown {
  if (Array.isArray(template)) {
    return template.flatMap((v) =>
      v === REFERENCES_SLOT ? (slots.references ?? []).map((r) => `{{${r}}}`) : [fill(v, slots)],
    );
  }
  if (template === PROMPT_SLOT) return slots.prompt ?? "";
  if (template && typeof template === "object") {
    return Object.fromEntries(Object.entries(template).map(([k, v]) => [k, fill(v, slots)]));
  }
  return template;
}

/** The schema a role is checked and priced by: its own, under its endpoint and display name. */
const schemaOf = (role: RoleModel): ModelSchema => ({
  ...role.schema,
  endpoint: role.endpoint,
  name: role.name,
});

/** The live direction for a shot list and a recipe. Throws when a built request breaks its schema. */
export function buildDirection(input: BuildInput): LiveDirection {
  const { list, recipe, cast } = input;
  const names = new Map(cast.map((c) => [c.id, c.name]));
  const photos = (id: string, most: number): Ref[] => {
    const at = cast.findIndex((c) => c.id === id);
    const person = cast[at];
    if (!person) return [];
    const n = Math.min(most, person.photos, PHOTOS_PER_PERSON);
    return Array.from({ length: n }, (_, i) => ({
      placeholder: `cast${at + 1}-${i + 1}`,
      what: person.name,
    }));
  };
  const master = list.pictures.find((p) => p.kind === "master");
  const max = recipe.stills.maxReferences ?? DEFAULT_MAX_REFERENCES;

  const references = (p: Picture): Ref[] => {
    let refs: Ref[];
    if (p.kind === "master") {
      refs = [
        ...Array.from({ length: Math.min(MASTER_PLACE_PHOTOS, input.placePhotos) }, (_, i) => ({
          placeholder: `place-${i + 1}`,
          what: "the place",
        })),
        ...cast.flatMap((c) => photos(c.id, MASTER_PERSON_PHOTOS)),
      ];
    } else {
      refs = [
        ...(master ? [{ placeholder: `keyframe:${master.id}`, what: "the master scene" }] : []),
        ...p.people.flatMap((id, i) =>
          photos(id, i === 0 ? MAIN_PERSON_PHOTOS : OTHER_PERSON_PHOTOS),
        ),
      ];
    }
    return refs.slice(0, max);
  };

  // Pictures a speaking shot starts from: their people keep the mouth closed.
  const speaking = new Set(
    list.routes.flatMap((r) => (r.route === "lip-sync" && r.picture ? [r.picture] : [])),
  );
  const schemas: Record<string, ModelSchema> = {};
  const rates: Record<string, Rate> = {};
  const use = (role: RoleModel) => {
    schemas[role.endpoint] = schemaOf(role);
    rates[role.endpoint] = role.rate;
  };
  const record = () => ({ ...emptyRecord(), schemas });
  const check = (where: string, endpoint: string, body: Record<string, unknown>, sec?: number) => {
    const errors = inputErrors(where, endpoint, body, record(), sec);
    if (errors.length) throw new Error(`Recipe "${recipe.id}": ${errors.join(" ")}`);
  };

  use(recipe.stills);
  const keyframes: PlannedKeyframe[] = list.pictures.map((p) => {
    const refs = references(p);
    if (!refs.length) throw new Error(`Picture "${p.id}" has nothing to be made from.`);
    const prompt = [
      legend(refs),
      STILL_FORMAT,
      // The description starts with the shot size and angle (shot-list-prompt.md);
      // the framing field repeats it, so it is not sent twice.
      sentence(p.description),
      p.people.length ? STILL_IDENTITY : "",
      speaking.has(p.id) ? STILL_BEFORE_SPEAKING : "",
      STILL_NO_TEXT,
    ]
      .filter(Boolean)
      .join(" ");
    const body = fill(recipe.stills.input, {
      prompt,
      references: refs.map((r) => r.placeholder),
    }) as Record<string, unknown>;
    check(`Picture "${p.id}"`, recipe.stills.endpoint, body);
    return {
      id: p.id,
      kind: p.kind,
      characterId: p.characterId,
      framing: p.framing,
      references: refs.map((r) => r.placeholder),
      endpoint: recipe.stills.endpoint,
      input: body,
      why: p.people.length ? p.people.map((id) => names.get(id) ?? id).join(", ") : "",
    };
  });

  const routes: PlannedRoute[] = list.shots.shots.map((shot, i) => {
    const r = list.routes[i] ?? { route: "still-move" as const, picture: null, motion: "" };
    const where = `Shot ${i + 1}`;
    if (r.route === "lip-sync") {
      use(recipe.speak);
      const seat = list.shots.seats.find((s) => s.characterId === shot.characterId);
      const body = fill(recipe.speak.input, {
        prompt: speakPrompt(shot.kind === "listener", seat?.ambient, r.motion),
      }) as Record<string, unknown>;
      check(where, recipe.speak.endpoint, body);
      return {
        route: "lip-sync",
        keyframe: r.picture,
        endpoint: recipe.speak.endpoint,
        input: body,
      };
    }
    if (r.route === "motion") {
      if (!recipe.motion) throw new Error(`${where}: the recipe has no motion model.`);
      const motion = recipe.motion;
      use(motion);
      const seconds = plannedShotSec(shot);
      const body = fitDuration(
        schemas[motion.endpoint],
        fill(motion.input, { prompt: r.motion }) as Record<string, unknown>,
        seconds,
      ).input;
      check(where, motion.endpoint, body, seconds);
      return { route: "motion", keyframe: r.picture, endpoint: motion.endpoint, input: body };
    }
    return { route: r.route, keyframe: r.picture, endpoint: null, input: null };
  });

  const used = new Set([
    ...keyframes.map((k) => k.endpoint),
    ...routes.flatMap((r) => (r.endpoint ? [r.endpoint] : [])),
  ]);
  const roles: [string, RoleModel | null][] = [
    ["keyframes", recipe.stills],
    ["lip-sync", recipe.speak],
    ["motion", recipe.motion],
  ];
  const plan: LivePlan = {
    shots: list.shots,
    keyframes,
    routes,
    models: roles.flatMap(([role, m]) =>
      m && (role === "keyframes" ? keyframes.length > 0 : routes.some((r) => r.route === role))
        ? [{ endpoint: m.endpoint, name: m.name, role, why: m.why ?? "", decisionId: null }]
        : [],
    ),
    level: input.level.id,
    guidanceNote: "",
  };
  for (const endpoint of Object.keys(schemas)) {
    if (!used.has(endpoint)) {
      delete schemas[endpoint];
      delete rates[endpoint];
    }
  }
  const steps = planSteps(plan, input.lines);
  const costs = costTable(
    steps,
    rates,
    schemas,
    levelEstimateUsd(input.level, estimateSeconds(input.lines)),
    steps.reduce((n, s) => n + s.seconds, 0),
  );
  return {
    plan,
    costs,
    warnings: costWarnings(costs),
    rates,
    schemas,
    connection: "recipe",
    recipe: { id: recipe.id, source: recipe.source },
    tools: [],
    guidance: "not-asked",
    model: input.run?.model ?? null,
    seconds: Math.round((input.run?.ms ?? 0) / 1000),
  };
}
