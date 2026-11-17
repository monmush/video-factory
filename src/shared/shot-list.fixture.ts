import type { ShotListAnswer } from "./shot-list";
import type { PlanContext } from "./shot-plan";

// A small video for the shot list and build tests: two people, a place, a
// product shot on a plate, an over-the-shoulder picture.

export const LINES = [
  { characterId: "a", speaker: "An", text: "Chào ông, hôm nay trời đẹp quá ạ." },
  { characterId: "b", speaker: "Ba", text: "Ừ cháu ngồi đây, uống chén trà đã cháu." },
  { characterId: "a", speaker: "An", text: "Dạ cháu cảm ơn, ông pha trà ngon lắm ạ." },
];

export const CTX: PlanContext = {
  lines: LINES,
  cast: [
    { id: "a", name: "An" },
    { id: "b", name: "Ba" },
  ],
  products: [{ id: "p", name: "Bạch Trà Shan Tuyết" }],
  hasPlace: true,
};

export const answer = (): ShotListAnswer => ({
  seats: [
    { character: "An", behind: "a bamboo screen", ambient: "bamboo leaves stir in a light breeze" },
    { character: "Ba", behind: "a wooden window", ambient: "steam drifts from the pot" },
  ],
  props: [{ name: "teapot", where: "centre of the table" }],
  state_changes: [],
  pictures: [
    {
      id: "master",
      kind: "master",
      character: null,
      people: ["An", "Ba"],
      framing: "wide shot at eye level",
      description: "An and Ba sit at a low table in the courtyard. Soft morning light.",
    },
    {
      id: "an",
      kind: "character",
      character: "An",
      people: ["An"],
      framing: "medium close-up",
      description: "An sits on the left, turned toward the right edge of the frame.",
    },
    {
      id: "ba-ots",
      kind: "character",
      character: "Ba",
      people: ["Ba", "An"],
      framing: "medium close-up over An's shoulder",
      description: "Ba sits on the right, An's shoulder soft in the foreground.",
    },
    {
      id: "plate",
      kind: "plate",
      character: null,
      people: [],
      framing: "close, from slightly above",
      description: "An empty spot on the bamboo mat beside the teapot.",
    },
  ],
  shots: [
    {
      n: 1,
      type: "speaker",
      character: "An",
      framing: "medium_close",
      line: 1,
      text: "Chào ông, hôm nay trời đẹp quá ạ.",
      visual: "An smiles.",
      why: "C2",
      picture: "an",
      route: "speak",
      motion: "nods slightly",
    },
    {
      n: 2,
      type: "wide",
      line: 2,
      text: "Ừ cháu ngồi đây,",
      visual: "The courtyard.",
      why: "C3",
      picture: "master",
      route: "still-move",
      motion: null,
    },
    {
      n: 3,
      type: "speaker",
      character: "Ba",
      framing: "medium_close",
      line: 2,
      text: "uống chén trà đã cháu.",
      visual: "Ba gestures to the cup.",
      why: "C7",
      picture: "ba-ots",
      route: "speak",
      motion: null,
    },
    {
      n: 4,
      type: "detail",
      line: 3,
      text: "Dạ cháu cảm ơn,",
      visual: "On the bamboo mat beside the teapot.",
      product: "Bạch Trà Shan Tuyết",
      why: "C12",
      picture: "plate",
      route: "product",
      motion: null,
    },
    {
      n: 5,
      type: "speaker",
      character: "An",
      framing: "close",
      line: 3,
      text: "ông pha trà ngon lắm ạ.",
      visual: "An grins.",
      why: "C7",
      hold: 1,
      picture: "an",
      route: "speak",
      motion: null,
    },
  ],
});
