import type { KeyframeKind, Route } from "./live-plan";
import type { MaterialOffer, OfferedPicture, OfferedScene } from "./material-offer";
import {
  type DirectorAnswer,
  namedInRequest,
  type PlanContext,
  productFreeProps,
  readDirectorAnswer,
  rulesPlan,
  type ShotPlan,
  withoutProducts,
} from "./shot-plan";

export type ShotListRoute = "speak" | "motion" | "still-move" | "product";
const LIST_ROUTES: ShotListRoute[] = ["speak", "motion", "still-move", "product"];
const AS_ROUTE: Record<ShotListRoute, Route> = {
  speak: "lip-sync",
  motion: "motion",
  "still-move": "still-move",
  product: "product",
};

const PICTURE_KINDS: KeyframeKind[] = ["master", "character", "action", "plate"];

export interface Picture {
  id: string;
  kind: KeyframeKind;
  characterId: string | null;
  people: string[];
  framing: string;
  description: string;
  material?: string;
}

export interface ListedRoute {
  route: Route;
  picture: string | null;
  motion: string;
}

export interface ShotList {
  shots: ShotPlan;
  pictures: Picture[];
  routes: ListedRoute[];
}

interface RawPicture {
  id?: string;
  kind?: string;
  character?: string | null;
  people?: string[] | null;
  framing?: string | null;
  description?: string | null;
}

export interface ShotListAnswer extends DirectorAnswer {
  pictures?: RawPicture[];
  shots?: (NonNullable<DirectorAnswer["shots"]>[number] & {
    picture?: string | null;
    route?: string | null;
    motion?: string | null;
  })[];
}

export interface ShotListCaps {
  motion: boolean;
  sound?: boolean;
}

export interface ReadShotList {
  list: ShotList;
  errors: string[];
  repaired: string[];
}

function withoutSounds(plan: ShotPlan): ShotPlan {
  const { ambience: _, ...rest } = plan;
  return { ...rest, shots: plan.shots.map(({ sound: __, ...shot }) => shot) };
}

const norm = (s: unknown) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
const key = (s: unknown) => norm(s).toLowerCase();

export function shotListErrors(list: ShotList, ctx: PlanContext, caps: ShotListCaps): string[] {
  const errors: string[] = [];
  const productNames = ctx.products.map((p) => p.name);
  const byId = new Map<string, Picture>();
  for (const p of list.pictures) {
    if (byId.has(p.id)) errors.push(`Picture "${p.id}": ids must be unique.`);
    byId.set(p.id, p);
    if (p.kind === "character" && !p.characterId) {
      errors.push(`Picture "${p.id}": a character picture names its person.`);
    }
    if (!p.description) errors.push(`Picture "${p.id}": write its description.`);
    const named = [p.framing, p.description]
      .map((t) => namedInRequest(t, productNames))
      .find(Boolean);
    if (named) {
      errors.push(`Picture "${p.id}": products are never drawn; describe it without "${named}".`);
    }
  }
  if (ctx.hasPlace) {
    if (list.pictures[0]?.kind !== "master") {
      errors.push("The first picture is the master: the whole place with the whole cast.");
    }
    if (list.pictures.filter((p) => p.kind === "master").length > 1) {
      errors.push("Make only one master picture.");
    }
  }
  if (list.routes.length !== list.shots.shots.length) {
    errors.push("Every shot needs its picture and route.");
  }
  list.shots.shots.forEach((shot, i) => {
    const where = `Shot ${i + 1}`;
    const r = list.routes[i];
    if (!r) return;
    const picture = r.picture ? byId.get(r.picture) : undefined;
    if (r.picture && !picture) errors.push(`${where}: picture "${r.picture}" does not exist.`);
    if (!r.picture && r.route !== "product") {
      errors.push(`${where}: name the picture it starts from.`);
    }
    if (shot.productId) {
      if (r.route !== "product") errors.push(`${where}: a product shot uses the product route.`);
      if (picture && picture.kind !== "plate") {
        errors.push(`${where}: a product shot starts from a plate picture.`);
      }
    } else if (r.route === "product") {
      errors.push(`${where}: the product route is only for a product detail shot.`);
    }
    if (shot.kind === "speaker" && r.route !== "lip-sync") {
      errors.push(`${where}: a speaker shot uses the speak route.`);
    }
    if (r.route === "lip-sync") {
      if (shot.kind !== "speaker" && shot.kind !== "listener") {
        errors.push(`${where}: only speaker and listener shots use the speak route.`);
      } else if (
        picture &&
        (picture.kind !== "character" || picture.characterId !== shot.characterId)
      ) {
        errors.push(
          `${where}: a speak shot starts from a character picture of the person on screen.`,
        );
      }
    }
    if (r.route === "motion") {
      if (!caps.motion) {
        errors.push(`${where}: the motion route is not available for this video; use still-move.`);
      } else if (!r.motion) {
        errors.push(`${where}: a motion shot says what moves in its motion text.`);
      }
    }
    const named = namedInRequest(r.motion, productNames);
    if (named) errors.push(`${where}: never name "${named}" in the motion text.`);
  });
  const started = new Set(list.routes.map((r) => r.picture));
  for (const p of list.pictures) {
    if (p.kind !== "master" && !started.has(p.id)) {
      errors.push(`Picture "${p.id}": no shot starts from it; remove it or use it.`);
    }
  }
  return errors;
}

export function readShotList(
  answer: ShotListAnswer,
  ctx: PlanContext,
  caps: ShotListCaps,
  offer?: MaterialOffer | null,
): ReadShotList {
  const read = readDirectorAnswer(answer, ctx);
  const errors = read.errors;
  const plan = caps.sound ? read.plan : withoutSounds(read.plan);
  const byName = new Map(ctx.cast.map((c) => [key(c.name), c.id]));
  const person = (where: string, name: unknown) => {
    const id = byName.get(key(name));
    if (!id) errors.push(`${where}: "${norm(name)}" is not in the cast.`);
    return id ?? null;
  };
  const pictures: Picture[] = (Array.isArray(answer.pictures) ? answer.pictures : []).map(
    (raw, i) => {
      const id = norm(raw.id) || `p${i + 1}`;
      const where = `Picture "${id}"`;
      const kind = PICTURE_KINDS.includes(raw.kind as KeyframeKind)
        ? (raw.kind as KeyframeKind)
        : null;
      if (!kind) errors.push(`${where}: kind must be one of ${PICTURE_KINDS.join(", ")}.`);
      const characterId = raw.character ? person(where, raw.character) : null;
      const people = (Array.isArray(raw.people) ? raw.people : [])
        .map((name) => person(where, name))
        .filter((p): p is string => Boolean(p));
      const all = characterId
        ? [characterId, ...people.filter((p) => p !== characterId)]
        : [...new Set(people)];
      return {
        id,
        kind: kind ?? "action",
        characterId: kind === "character" ? characterId : null,
        people: [...new Set(all)],
        framing: norm(raw.framing),
        description: norm(raw.description),
      };
    },
  );
  const rawShots = Array.isArray(answer.shots) ? answer.shots : [];
  const routes: ListedRoute[] = rawShots.map((raw, i) => {
    const name = LIST_ROUTES.includes(raw.route as ShotListRoute)
      ? (raw.route as ShotListRoute)
      : null;
    if (!name) errors.push(`Shot ${i + 1}: route must be one of ${LIST_ROUTES.join(", ")}.`);
    return {
      route: AS_ROUTE[name ?? "still-move"],
      picture: raw.picture ? norm(raw.picture) : null,
      motion: norm(raw.motion),
    };
  });
  const fitted = offer
    ? fitToOffer({ shots: plan, pictures, routes }, offer)
    : { list: { shots: plan, pictures, routes }, repaired: [] };
  const { kept, dropped } = withoutLeftoverPictures(fitted.list.pictures, fitted.list.routes);
  const list: ShotList = { ...fitted.list, pictures: kept };
  errors.push(...shotListErrors(list, ctx, caps));
  return {
    list,
    errors: [...new Set(errors)],
    repaired: [
      ...fitted.repaired,
      ...dropped.map((id) => `Picture "${id}": no shot starts from it; removed.`),
    ],
  };
}

interface Fitted {
  list: ShotList;
  repaired: string[];
}

function withScene(list: ShotList, scene: OfferedScene | null): ShotList {
  if (!scene) return list;
  const masterAt = list.pictures.findIndex((p) => p.kind === "master");
  const pictures = list.pictures.map((p, i) =>
    i === masterAt
      ? {
          ...p,
          framing: scene.framing,
          description: scene.description,
          people: [...scene.people],
          material: scene.key,
        }
      : p,
  );
  const seats = list.shots.seats.map((seat) => {
    const fixed = scene.seats.find((s) => s.characterId === seat.characterId);
    if (!fixed) return seat;
    const { ambient: _, ...rest } = seat;
    return { ...rest, behind: fixed.behind, ...(fixed.ambient ? { ambient: fixed.ambient } : {}) };
  });
  const names = new Set(scene.props.map((p) => key(p.name)));
  const props = [
    ...scene.props.map((p) => ({ ...p })),
    ...list.shots.props.filter((p) => !names.has(key(p.name))),
  ];
  return { ...list, pictures, shots: { ...list.shots, seats, props } };
}

const offeredBy = (offer: MaterialOffer, list: ShotList) => {
  const listed = new Set(list.pictures.map((p) => p.id));
  return (id: string | null): OfferedPicture | undefined =>
    id && !listed.has(id) ? offer.pictures.find((p) => p.alias === id) : undefined;
};

const pictureOfOffer = (p: OfferedPicture, id: string): Picture => ({
  id,
  kind: p.kind,
  characterId: p.kind === "character" ? p.characterId : null,
  people: [...p.people],
  framing: p.framing,
  description: p.description,
});

function withClipMotion(
  list: ShotList,
  offered: ReturnType<typeof offeredBy>,
  scene: OfferedScene | null,
): ShotList {
  const master = list.pictures.find((p) => p.kind === "master")?.id;
  const clipOf = (picture: string | null) =>
    picture && picture === master ? scene?.clip : offered(picture)?.clip;
  const routes = list.routes.map((r) => {
    const clip = r.route === "motion" && !r.motion ? clipOf(r.picture) : undefined;
    return clip ? { ...r, motion: clip.motion } : r;
  });
  return { ...list, routes };
}

const NEW_SUFFIX = "-new";

function asNewPicture(list: ShotList, offered: ReturnType<typeof offeredBy>, id: string): Picture {
  const offer = offered(id);
  if (offer) return pictureOfOffer(offer, `${id}${NEW_SUFFIX}`);
  const own = list.pictures.find((p) => p.id === id) as Picture;
  const { material: _, ...fresh } = own;
  return {
    ...fresh,
    id: `${id}${NEW_SUFFIX}`,
    ...(own.kind === "master" ? { kind: "action" as const } : {}),
  };
}

function startFromNew(
  list: ShotList,
  offered: ReturnType<typeof offeredBy>,
  index: number,
): { list: ShotList; id: string } {
  const from = list.routes[index]?.picture as string;
  const fresh = asNewPicture(list, offered, from);
  const pictures = list.pictures.some((p) => p.id === fresh.id)
    ? list.pictures
    : [...list.pictures, fresh];
  const routes = list.routes.map((r, i) => (i === index ? { ...r, picture: fresh.id } : r));
  return { list: { ...list, pictures, routes }, id: fresh.id };
}

function fromExisting(list: ShotList, offered: ReturnType<typeof offeredBy>, index: number) {
  const id = list.routes[index]?.picture ?? null;
  if (offered(id)) return true;
  return Boolean(id && list.pictures.find((p) => p.id === id && p.kind === "master")?.material);
}

function openingShotNew(list: ShotList, offered: ReturnType<typeof offeredBy>): Fitted {
  if (!list.routes.length || !fromExisting(list, offered, 0)) return { list, repaired: [] };
  const made = startFromNew(list, offered, 0);
  return {
    list: made.list,
    repaired: [
      `Shot 1: the first shot starts from a new picture; it now starts from "${made.id}".`,
    ],
  };
}

function atMostHalfExisting(list: ShotList, offered: ReturnType<typeof offeredBy>): Fitted {
  const limit = Math.floor(list.routes.length / 2);
  const using = list.routes.flatMap((r, i) => (offered(r.picture) ? [i] : []));
  if (using.length <= limit) return { list, repaired: [] };
  const hasClip = (i: number) => Boolean(offered(list.routes[i]?.picture ?? null)?.clip);
  const keep = new Set(
    [...using.filter(hasClip), ...using.filter((i) => !hasClip(i))].slice(0, limit),
  );
  let next = list;
  const repaired: string[] = [];
  for (const i of using.filter((n) => !keep.has(n))) {
    const made = startFromNew(next, offered, i);
    next = made.list;
    repaired.push(
      `Shot ${i + 1}: at most half of the shots start from an existing picture; it now starts from "${made.id}".`,
    );
  }
  return { list: next, repaired };
}

function withOfferedPictures(list: ShotList, offered: ReturnType<typeof offeredBy>): ShotList {
  const added: Picture[] = [];
  for (const r of list.routes) {
    const offer = offered(r.picture);
    if (offer && !added.some((p) => p.id === offer.alias)) {
      added.push({ ...pictureOfOffer(offer, offer.alias), material: offer.key });
    }
  }
  return added.length ? { ...list, pictures: [...list.pictures, ...added] } : list;
}

function fitToOffer(list: ShotList, offer: MaterialOffer): Fitted {
  const scened = withScene(list, offer.scene);
  const offered = offeredBy(offer, scened);
  const opening = openingShotNew(withClipMotion(scened, offered, offer.scene), offered);
  const capped = atMostHalfExisting(opening.list, offered);
  return {
    list: withOfferedPictures(capped.list, offered),
    repaired: [...opening.repaired, ...capped.repaired],
  };
}

const LIST_ROUTE_OF = Object.fromEntries(
  LIST_ROUTES.map((name) => [AS_ROUTE[name], name]),
) as Record<Route, ShotListRoute>;

export function shotListAnswer(list: ShotList, ctx: PlanContext): ShotListAnswer | null {
  const names = new Map(ctx.cast.map((c) => [c.id, c.name]));
  const products = new Map(ctx.products.map((p) => [p.id, p.name]));
  const known = [
    ...list.pictures.flatMap((p) => [p.characterId, ...p.people]),
    ...list.shots.shots.map((s) => s.characterId),
    ...list.shots.seats.map((s) => s.characterId),
  ].every((id) => !id || names.has(id));
  const productsKnown = list.shots.shots.every((s) => !s.productId || products.has(s.productId));
  if (!known || !productsKnown || list.routes.length !== list.shots.shots.length) return null;
  const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  const plan = list.shots;
  return {
    ambience: plan.ambience ?? null,
    seats: plan.seats.map((s) => ({
      character: names.get(s.characterId) ?? "",
      behind: s.behind,
      ambient: s.ambient ?? null,
    })),
    props: plan.props.map((p) => ({ ...p })),
    state_changes: plan.stateChanges.map((c) => ({ from_shot: c.fromShot + 1, change: c.change })),
    pictures: list.pictures.map((p) => ({
      id: p.id,
      kind: p.kind,
      character: name(p.characterId),
      people: p.people.map((id) => names.get(id) ?? ""),
      framing: p.framing,
      description: p.description,
    })),
    shots: plan.shots.map((s, i) => {
      const route = list.routes[i] as ListedRoute;
      return {
        n: i + 1,
        type: s.kind,
        character: name(s.characterId),
        framing: s.framing,
        line: s.line + 1,
        text: s.text,
        visual: s.visual,
        product: s.productId ? (products.get(s.productId) ?? null) : null,
        why: s.why,
        hold: s.hold ?? null,
        brief: s.brief ?? null,
        sound: s.sound ?? null,
        picture: route.picture,
        route: LIST_ROUTE_OF[route.route],
        motion: route.motion || null,
      };
    }),
  };
}

function withoutLeftoverPictures(
  pictures: Picture[],
  routes: ListedRoute[],
): { kept: Picture[]; dropped: string[] } {
  const ids = new Set(pictures.map((p) => p.id));
  const everyShotHasItsPicture = routes.every((r) => r.picture && ids.has(r.picture));
  if (!everyShotHasItsPicture) return { kept: pictures, dropped: [] };
  const started = new Set(routes.map((r) => r.picture));
  const isLeftover = (p: Picture) => p.kind !== "master" && !started.has(p.id);
  return {
    kept: pictures.filter((p) => !isLeftover(p)),
    dropped: pictures.filter(isLeftover).map((p) => p.id),
  };
}

const SIDE: Record<string, string> = {
  left: "on the left of the frame",
  right: "on the right of the frame",
  centre: "in the middle of the frame",
};
const LOOKS: Record<string, string> = {
  frame_right:
    "turned toward the right edge of the frame, in three-quarter view, looking at the person they are talking to just out of frame",
  frame_left:
    "turned toward the left edge of the frame, in three-quarter view, looking at the person they are talking to just out of frame",
  camera: "facing the camera, the head turned very slightly to one side",
};

const sentence = (s: string) => {
  const t = s.trim().replace(/[.\s]+$/, "");
  return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}.` : "";
};

export function rulesShotList(
  ctx: PlanContext,
  plan: ShotPlan = rulesPlan(ctx),
  scene: OfferedScene | null = null,
): ShotList {
  if (!scene) return rulesShotListOf(ctx, plan);
  const inScene = withScene({ shots: plan, pictures: [], routes: [] }, scene).shots;
  return fitToOffer(rulesShotListOf(ctx, inScene), { scene, pictures: [] }).list;
}

function rulesShotListOf(ctx: PlanContext, plan: ShotPlan): ShotList {
  const productNames = ctx.products.map((p) => p.name);
  const name = (id: string) => ctx.cast.find((c) => c.id === id)?.name ?? "";
  const seats = plan.seats.filter((s) => name(s.characterId));
  const props = productFreeProps(plan.props, productNames);
  const propsText = props.length
    ? `On the scene: ${props.map((p) => `${p.name} (${p.where})`).join("; ")}.`
    : "";
  const pictures: Picture[] = [];
  if (ctx.hasPlace) {
    pictures.push({
      id: "master",
      kind: "master",
      characterId: null,
      people: seats.map((s) => s.characterId),
      framing: "Wide shot at eye level, the whole scene in frame",
      description: [
        seats.length
          ? `${seats.map((s) => `${name(s.characterId)} sits ${SIDE[s.side]}`).join("; ")}.`
          : "The place, empty.",
        seats.length > 1 ? "They are turned toward each other, talking." : "",
        propsText,
        "Soft natural light, as in the place.",
      ]
        .filter(Boolean)
        .join(" "),
    });
  }
  for (const seat of seats) {
    const who = name(seat.characterId);
    const lone = seats.length < 2;
    pictures.push({
      id: `char-${pictures.filter((p) => p.kind === "character").length + 1}`,
      kind: "character",
      characterId: seat.characterId,
      people: [seat.characterId],
      framing: "Medium close-up, chest up, at eye level",
      description: [
        `${who} is seated ${SIDE[seat.side]?.replace("of the frame", "of the scene")}, ${LOOKS[lone ? "camera" : seat.looks]}.`,
        "Calm natural expression.",
        seat.behind ? sentence(`Behind ${who}: ${withoutProducts(seat.behind, productNames)}`) : "",
        "The same light as the scene.",
      ]
        .filter(Boolean)
        .join(" "),
    });
  }
  const pictureOf = (characterId: string | null) =>
    pictures.find((p) => p.kind === "character" && p.characterId === characterId)?.id ?? null;
  const master = pictures.find((p) => p.kind === "master")?.id ?? null;
  const routes: ListedRoute[] = plan.shots.map((shot, i) => {
    if (shot.kind === "speaker" || shot.kind === "listener") {
      return {
        route: shot.kind === "speaker" ? "lip-sync" : "still-move",
        picture: pictureOf(shot.characterId) ?? master,
        motion: "",
      };
    }
    if (shot.productId && !ctx.hasPlace) return { route: "product", picture: null, motion: "" };
    if (shot.kind === "wide" || !ctx.hasPlace)
      return { route: "still-move", picture: master, motion: "" };
    const visual = withoutProducts(shot.visual, productNames);
    const id = `${shot.productId ? "plate" : "detail"}-${i + 1}`;
    pictures.push({
      id,
      kind: shot.productId ? "plate" : "action",
      characterId: null,
      people: [],
      framing: "Close shot from slightly above",
      description: shot.productId
        ? [
            "An empty spot on the main surface in front of the camera, in sharp focus, with free space above it.",
            visual ? sentence(`Where: ${visual}`) : "",
          ]
            .filter(Boolean)
            .join(" ")
        : visual || "A close detail of the scene.",
    });
    return { route: shot.productId ? "product" : "still-move", picture: id, motion: "" };
  });
  const started = new Set(routes.map((r) => r.picture));
  return {
    shots: plan,
    pictures: pictures.filter((p) => p.kind === "master" || started.has(p.id)),
    routes,
  };
}
