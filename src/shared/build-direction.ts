import {
  costTable,
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
  unknownPriceWarnings,
} from "./live-plan";
import {
  STILL_BEFORE_SPEAKING,
  STILL_FORMAT,
  STILL_IDENTITY,
  STILL_NO_TEXT,
  speakPrompt,
  stillBeforeSpeakingWith,
} from "./prompt-text";
import { PROMPT_SLOT, REFERENCES_SLOT, type Recipe, type RoleModel } from "./recipe";
import type { Picture, ShotList } from "./shot-list";

const MAIN_PERSON_PHOTOS = 3;
const OTHER_PERSON_PHOTOS = 2;
export const MASTER_PLACE_PHOTOS = 2;
const MASTER_PERSON_PHOTOS = 3;
export const PHOTOS_OFFERED_PER_PERSON = 3;

export interface BuildInput {
  list: ShotList;
  recipe: Recipe;
  cast: { id: string; name: string; photos: number }[];
  placePhotos: number;
  pace: number;
  run?: { model: string | null; ms: number };
}

interface Ref {
  placeholder: string;
  what: string;
}

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

const schemaOf = (role: RoleModel): ModelSchema => ({
  ...role.schema,
  endpoint: role.endpoint,
  name: role.name,
});

function shareReferences(groups: Ref[][], budget: number): Ref[] {
  const taken = groups.map(() => 0);
  const rotation = [...groups.keys()].slice(1).concat(0);
  let left = budget;
  let grew = true;
  while (left > 0 && grew) {
    grew = false;
    for (const i of rotation) {
      if (left > 0 && (taken[i] ?? 0) < (groups[i]?.length ?? 0)) {
        taken[i] = (taken[i] ?? 0) + 1;
        left -= 1;
        grew = true;
      }
    }
  }
  return groups.flatMap((g, i) => g.slice(0, taken[i]));
}

export function buildDirection(input: BuildInput): LiveDirection {
  const { list, recipe, cast } = input;
  const names = new Map(cast.map((c) => [c.id, c.name]));
  const photos = (id: string, most: number): Ref[] => {
    const at = cast.findIndex((c) => c.id === id);
    const person = cast[at];
    if (!person) return [];
    const n = Math.min(most, person.photos, PHOTOS_OFFERED_PER_PERSON);
    return Array.from({ length: n }, (_, i) => ({
      placeholder: `cast${at + 1}-${i + 1}`,
      what: person.name,
    }));
  };
  const master = list.pictures.find((p) => p.kind === "master");
  const max = recipe.stills.maxReferences;

  const references = (p: Picture): Ref[] => {
    const placeRefs = Array.from(
      { length: Math.min(MASTER_PLACE_PHOTOS, input.placePhotos) },
      (_, i) => ({ placeholder: `place-${i + 1}`, what: "the place" }),
    );
    const groups =
      p.kind === "master"
        ? [placeRefs, ...cast.map((c) => photos(c.id, MASTER_PERSON_PHOTOS))]
        : [
            master ? [{ placeholder: `keyframe:${master.id}`, what: "the master scene" }] : [],
            ...p.people.map((id, i) =>
              photos(id, i === 0 ? MAIN_PERSON_PHOTOS : OTHER_PERSON_PHOTOS),
            ),
          ];
    const filled = groups.filter((g) => g.length > 0);
    if (filled.length > max) {
      throw new Error(
        `Picture "${p.id}" needs at least ${filled.length} reference images (one for each person and its scene), but the image model takes ${max}.`,
      );
    }
    return shareReferences(groups, max);
  };

  const picturesASpeakingShotStartsFrom = new Set(
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
      sentence(p.description),
      p.people.length ? STILL_IDENTITY : "",
      picturesASpeakingShotStartsFrom.has(p.id)
        ? p.people.length > 1
          ? stillBeforeSpeakingWith(names.get(p.people[0] as string) ?? "The main person")
          : STILL_BEFORE_SPEAKING
        : "",
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
      ...(p.people.length ? { people: p.people.length } : {}),
      references: refs.map((r) => r.placeholder),
      endpoint: recipe.stills.endpoint,
      input: body,
      why: p.people.length ? p.people.map((id) => names.get(id) ?? id).join(", ") : "",
      ...(p.material
        ? { material: p.material, description: p.description, peopleIds: [...p.people] }
        : {}),
    };
  });

  const moving = (where: string, keyframe: string | null, prompt: string, seconds: number) => {
    const motion = recipe.motion;
    use(motion);
    const body = fitDuration(
      schemas[motion.endpoint],
      fill(motion.input, { prompt }) as Record<string, unknown>,
      seconds,
    ).input;
    check(where, motion.endpoint, body, seconds);
    return { route: "motion" as const, keyframe, endpoint: motion.endpoint, input: body };
  };
  const routes: PlannedRoute[] = list.shots.shots.map((shot, i) => {
    const r = list.routes[i] ?? { route: "still-move" as const, picture: null, motion: "" };
    const where = `Shot ${i + 1}`;
    if (r.route === "lip-sync" && shot.kind === "speaker") {
      return {
        route: "lip-sync",
        keyframe: r.picture,
        endpoint: null,
        input: null,
        ...(r.motion ? { motion: r.motion } : {}),
      };
    }
    if (r.route === "lip-sync") {
      const seat = list.shots.seats.find((s) => s.characterId === shot.characterId);
      return moving(
        where,
        r.picture,
        speakPrompt(true, seat?.ambient, r.motion),
        plannedShotSec(shot, input.pace),
      );
    }
    if (r.route === "motion")
      return moving(where, r.picture, r.motion, plannedShotSec(shot, input.pace));
    return { route: r.route, keyframe: r.picture, endpoint: null, input: null };
  });

  const used = new Set([
    ...keyframes.map((k) => k.endpoint),
    ...routes.flatMap((r) => (r.endpoint ? [r.endpoint] : [])),
  ]);
  const roles: [string, RoleModel][] = [
    ["keyframes", recipe.stills],
    ["motion", recipe.motion],
  ];
  const plan: LivePlan = {
    shots: list.shots,
    keyframes,
    routes,
    models: roles.flatMap(([role, m]) =>
      (role === "keyframes" ? keyframes.length > 0 : routes.some((r) => r.route === role))
        ? [{ endpoint: m.endpoint, name: m.name, role, why: m.why ?? "", decisionId: null }]
        : [],
    ),
    guidanceNote: "",
  };
  for (const endpoint of Object.keys(schemas)) {
    if (!used.has(endpoint)) {
      delete schemas[endpoint];
      delete rates[endpoint];
    }
  }
  const steps = planSteps(plan, input.pace);
  const costs = costTable(
    steps,
    rates,
    schemas,
    steps.reduce((n, s) => n + s.seconds, 0),
  );
  return {
    plan,
    costs,
    warnings: unknownPriceWarnings(costs),
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
