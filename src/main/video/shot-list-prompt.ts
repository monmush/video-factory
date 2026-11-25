import type { MaterialOffer, OfferedPicture, OfferedScene } from "../../shared/material-offer";
import type { MediaLevel } from "../../shared/media-level";
import { MAX_SOUND_WORDS } from "../../shared/sound";
import ADDENDUM from "./shot-list-prompt.md?raw";

const MOTION_ON =
  "The `motion` route is available: use it for every `wide` shot, every `listener` shot and every `detail` that shows an action; use `still-move` only for a detail of a still object. In a `motion` shot people are alive and may act: one clear action per shot (a gesture, leaning in, pouring, handing something over, sitting down or standing up), with the background stirring and the camera moving as the moment needs (a slow push-in, a drift, a pan from one person to the other). Nobody is seen speaking in it.";
const MOTION_OFF =
  "The `motion` route is not available for this video: use `still-move` for every wide, detail and listener shot. Nothing moves inside such a shot, so describe a single moment, the most telling instant of the action (the cup brimming over, not the whole pour).";

const SOUND_ON =
  'The video has quiet background sound under the dialogue. Write `ambience`: one short English description of the room tone of this place, steady and quiet, heard for the whole video (for example "quiet tea room, soft distant birdsong through an open window, faint fan hum"). On a shot that does not speak (`listener`, `wide`, `detail`) you may write `sound`: one short English description of a sound the action in it makes (for example "tea poured into a ceramic cup", "porcelain cup set down on a wooden table", "wooden chair scraping"); null when the shot makes no sound of its own. A few spot sounds are enough. Never a `sound` on a `speaker` shot. Never music, singing, voices, speech or laughter in `ambience` or `sound`. ' +
  ` Each of them is at most ${MAX_SOUND_WORDS} words.`;
const SOUND_OFF = "The video has no background sound: set `ambience` and every `sound` to null.";

const MATERIAL_SLOT = /\n*\{\{material\}\}\n*/;

type Names = ReadonlyMap<string, string>;

const nameOf = (names: Names, id: string) => names.get(id) ?? id;

const clipSeconds = (seconds: number) => Math.floor(seconds * 10) / 10;

function sceneBlock(scene: OfferedScene, names: Names): string {
  const fixed = {
    seats: scene.seats.map((s) => ({
      character: nameOf(names, s.characterId),
      behind: s.behind,
      ambient: s.ambient ?? null,
    })),
    props: scene.props,
  };
  return [
    "**The scene is fixed.** Write exactly these `seats` and `props`. You may add a prop this script needs; never change or drop one of these:",
    `\`\`\`json\n${JSON.stringify(fixed, null, 2)}\n\`\`\``,
    "The master picture already exists. List it first as usual, with the id `master`, this framing and this description, unchanged:",
    `- framing: ${scene.framing}\n- description: ${scene.description}`,
    "A wide shot that shows the scene as it is starts from `master`. When a wide shot needs anything else (another pose, something in a hand, a later state of the scene), list a new picture for it.",
    ...(scene.clip
      ? [
          `The master already has its moving clip of ${clipSeconds(scene.clip.seconds)} s: a \`motion\` shot of at most ${clipSeconds(scene.clip.seconds)} seconds that starts from \`master\` replays it. Write that shot's \`motion\` as null.`,
        ]
      : []),
  ].join("\n\n");
}

const NEW_SCENE = [
  "### This video sets the series' scene",
  "Later videos of this series will be staged in the scene you set here, and will reuse its master picture. So make the master the scene as it always is: the whole cast seated at rest in a neutral pose, hands empty, with only the things that belong to the place. Whatever this story adds (an object in a hand, a gesture, a later state of the scene) goes in another picture, never in the master.",
  "In `props`, list only what belongs to the place and stays there in every video (furniture, the objects on the table). An object only this story needs is not a prop: describe it in the pictures that show it.",
].join("\n\n");

const cell = (text: string) => text.replace(/\|/g, "/").replace(/\s+/g, " ").trim();

const secondsLabel = (seconds: number) => `${clipSeconds(seconds)} s`;

function kindLabel(p: OfferedPicture): string {
  return p.clip ? `${p.kind}, moving, ${secondsLabel(p.clip.seconds)}` : p.kind;
}

function pictureRow(p: OfferedPicture, names: Names): string {
  const who = p.people.length ? p.people.map((id) => nameOf(names, id)).join(", ") : "–";
  return `| ${p.alias} | ${kindLabel(p)} | ${cell(who)} | ${cell(p.framing)} | ${cell(p.description)} |`;
}

function picturesBlock(pictures: readonly OfferedPicture[], names: Names): string {
  const rules = [
    "- The first shot of the video always starts from a new picture, never from an existing one and never from `master`.",
    "- At most half of the shots start from an existing picture.",
    "- A `speak` shot may start from an existing `character` picture of its speaker.",
    ...(pictures.some((p) => p.clip)
      ? [
          '- A picture marked "moving, N s" already has its moving clip: a `motion` shot of at most N seconds that starts from it replays that clip. Write that shot\'s `motion` as null.',
        ]
      : []),
  ];
  return [
    "**Pictures that already exist.** Each was made for an earlier video of this series, in this scene. A shot may start from one of them instead of a new picture: name its id as the shot's `picture`, and do not list it in `pictures`.",
    [
      "| id | kind | who | framing | what it shows |",
      "| --- | --- | --- | --- | --- |",
      ...pictures.map((p) => pictureRow(p, names)),
    ].join("\n"),
    "Use one only when the shot would look the same anyway: the same person, size and angle, the same pose, expression and hands, the same state of the props. Otherwise describe a new picture; a new picture is always right.",
    rules.join("\n"),
  ].join("\n\n");
}

export function materialSection(offer: MaterialOffer, names: Names): string {
  return [
    "### What this series already has",
    "Earlier videos of this series were made in this same scene. Stage this video inside it, so that every video of the series is one show.",
    ...(offer.scene ? [sceneBlock(offer.scene, names)] : []),
    ...(offer.pictures.length ? [picturesBlock(offer.pictures, names)] : []),
  ].join("\n\n");
}

function materialCheck(offer: MaterialOffer): string {
  const named = offer.pictures.length
    ? "; every existing picture a shot names is in the table above"
    : "";
  return `${named}; the first shot starts from a new picture`;
}

export function shotListPrompt(
  base: string,
  v: {
    level: MediaLevel;
    motion: boolean;
    sound: boolean;
    direction: string;
    reuse?: boolean;
    material?: { offer: MaterialOffer | null; names: Names } | null;
  },
): string {
  const offer = v.reuse && v.material?.offer?.scene ? v.material.offer : null;
  const rules = base.split(/\n## Output\b/)[0]?.trimEnd() ?? base;
  const slots: Record<string, string> = {
    level_label: v.level.label,
    level_preference: v.level.preference,
    motion_rule: v.motion ? MOTION_ON : MOTION_OFF,
    sound_rule: v.sound ? SOUND_ON : SOUND_OFF,
    direction: v.direction,
    material_check: offer ? materialCheck(offer) : "",
  };
  let addendum = ADDENDUM;
  for (const [key, value] of Object.entries(slots)) {
    addendum = addendum.replaceAll(`{{${key}}}`, value);
  }
  const section = !v.reuse
    ? ""
    : offer
      ? materialSection(offer, v.material?.names ?? new Map())
      : NEW_SCENE;
  const withSection = addendum.replace(MATERIAL_SLOT, () =>
    section ? `\n\n${section}\n\n` : "\n\n",
  );
  return `${rules}\n\n${withSection}`;
}
