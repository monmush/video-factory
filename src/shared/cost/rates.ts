import { VOICE_PREVIEW_TEXT } from "../voice-request";

const GPT_IMAGE_EDIT = "openai/gpt-image-2.6/sunburst/edit";
const NANO_BANANA_EDIT = "fal-ai/nano-banana-pro/edit";
const WAN = "alibaba/wan-3.0/image-to-video";
const WAN_WITH_REFERENCES = "alibaba/wan-3.0/reference-to-video";
const MINIMAX_H3 = "minimax/h3-max/image-to-video";
const MINIMAX_H3_WITH_REFERENCES = "minimax/h3-max/reference-to-video";
const SOUND_EFFECTS = "elevenlabs/sound-effects/v3";
const BACKGROUND_REMOVAL = "bria/guided-remove-background";
const SPEECH_FROM_TEXT = "google/gemini-3.8-flash-tts";

export const LIST_UNIT_PRICE_USD: Readonly<Record<string, number>> = {
  [GPT_IMAGE_EDIT]: 1,
  [NANO_BANANA_EDIT]: 0.15,
  [WAN]: 0.05,
  [WAN_WITH_REFERENCES]: 0.05,
  [MINIMAX_H3]: 0.0375,
  [MINIMAX_H3_WITH_REFERENCES]: 0.05,
  [SOUND_EFFECTS]: 0.002,
  [BACKGROUND_REMOVAL]: 0.03,
  [SPEECH_FROM_TEXT]: 0.045,
};

export const listUnitPriceUsd = (endpoint: string): number | null =>
  LIST_UNIT_PRICE_USD[endpoint] ?? null;

const unitPrice = (endpoint: string) => LIST_UNIT_PRICE_USD[endpoint] as number;

const WAN_REFERENCES_720P_WITH_AUDIO_BILLED_UNITS_PER_SEC_UNMEASURED = 2;
const WAN_720P_SILENT_BILLED_UNITS_PER_SEC_UNMEASURED = 1;
const MINIMAX_H3_REFERENCES_BILLED_UNITS_PER_SEC_UNMEASURED = 1;
const MINIMAX_H3_BILLED_UNITS_PER_SEC_UNMEASURED = 1;
const SPEECH_FROM_TEXT_BILLED_UNITS_PER_SPOKEN_CHAR_UNMEASURED = 1 / 1000;
const GPT_IMAGE_EDIT_BILLED_UNITS_PER_STILL_ROUNDED_UP = 0.07;
const NANO_BANANA_BILLED_UNITS_PER_STILL_UNMEASURED = 1;

export const STILL_USD =
  GPT_IMAGE_EDIT_BILLED_UNITS_PER_STILL_ROUNDED_UP * unitPrice(GPT_IMAGE_EDIT);
export const NANO_BANANA_STILL_USD =
  NANO_BANANA_BILLED_UNITS_PER_STILL_UNMEASURED * unitPrice(NANO_BANANA_EDIT);

export const VIDEO_USD_PER_SEC = {
  wan: {
    speech:
      WAN_REFERENCES_720P_WITH_AUDIO_BILLED_UNITS_PER_SEC_UNMEASURED *
      unitPrice(WAN_WITH_REFERENCES),
    motion: WAN_720P_SILENT_BILLED_UNITS_PER_SEC_UNMEASURED * unitPrice(WAN),
  },
  minimaxH3: {
    speech:
      MINIMAX_H3_REFERENCES_BILLED_UNITS_PER_SEC_UNMEASURED * unitPrice(MINIMAX_H3_WITH_REFERENCES),
    motion: MINIMAX_H3_BILLED_UNITS_PER_SEC_UNMEASURED * unitPrice(MINIMAX_H3),
  },
} as const;

export const VOICE_SAMPLE_USD =
  [...VOICE_PREVIEW_TEXT].length *
  SPEECH_FROM_TEXT_BILLED_UNITS_PER_SPOKEN_CHAR_UNMEASURED *
  unitPrice(SPEECH_FROM_TEXT);

export const SOUND_EFFECT_USD_PER_SEC = unitPrice(SOUND_EFFECTS);
export const CUTOUT_USD = unitPrice(BACKGROUND_REMOVAL);

export interface ResultCost {
  usd: number | null;
  billed: boolean;
  billedUnits?: number;
}

export function resultCost(
  calculatedUsd: number | null,
  billedUnits: number | null,
  unitPriceUsd: number | null,
): ResultCost {
  if (billedUnits !== null && unitPriceUsd !== null) {
    return { usd: billedUnits * unitPriceUsd, billed: true, billedUnits };
  }
  return { usd: calculatedUsd, billed: false };
}

export const calculated = (usd: number | null): ResultCost => ({ usd, billed: false });
