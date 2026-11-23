import type { Rate } from "../live-plan";

const GPT_IMAGE_EDIT = "openai/gpt-image-2.6/sunburst/edit";
const WAN_PRIME = "alibaba/wan-3.0-prime/image-to-video";
const WAN = "alibaba/wan-3.0/image-to-video";
const MINIMAX_H3 = "minimax/h3-max/image-to-video";
const VEO_FAST = "fal-ai/veo3.1/fast/image-to-video";
const SOUND_EFFECTS = "elevenlabs/sound-effects/v3";
const BACKGROUND_REMOVAL = "bria/guided-remove-background";
const KLING_AVATAR_STANDARD = "fal-ai/kling-video/ai-avatar/v2/standard";
const OMNIHUMAN = "bytedance/omnihuman/v2";
const NANO_BANANA_EDIT = "fal-ai/nano-banana-pro/edit";

export const LIST_UNIT_PRICE_USD: Readonly<Record<string, number>> = {
  [GPT_IMAGE_EDIT]: 1,
  [WAN_PRIME]: 0.045,
  [WAN]: 0.045,
  [MINIMAX_H3]: 0.0375,
  [VEO_FAST]: 0.15,
  [SOUND_EFFECTS]: 0.002,
  [BACKGROUND_REMOVAL]: 0.03,
  [KLING_AVATAR_STANDARD]: 0.0562,
  [OMNIHUMAN]: 0.105,
  [NANO_BANANA_EDIT]: 0.15,
};

export const listUnitPriceUsd = (endpoint: string): number | null =>
  LIST_UNIT_PRICE_USD[endpoint] ?? null;

const unitPrice = (endpoint: string) => LIST_UNIT_PRICE_USD[endpoint] as number;

export const WAN_PRIME_1080P_SILENT_BILLED_UNITS_PER_SEC = 5.6;
export const WAN_720P_WITH_AUDIO_BILLED_UNITS_PER_SEC = 2;
const GPT_IMAGE_EDIT_BILLED_UNITS_PER_STILL_ROUNDED_UP = 0.07;
const ONE_BILLED_UNIT_PER_SEC_UNMEASURED = 1;

export const MOTION_USD_PER_SEC =
  WAN_PRIME_1080P_SILENT_BILLED_UNITS_PER_SEC * unitPrice(WAN_PRIME);
export const MOTION_MIN_SEC = 2;

export const STILL_USD =
  GPT_IMAGE_EDIT_BILLED_UNITS_PER_STILL_ROUNDED_UP * unitPrice(GPT_IMAGE_EDIT);
export const NANO_BANANA_STILL_USD = unitPrice(NANO_BANANA_EDIT);

export const SPEAKING_CLIP_USD_PER_SEC = {
  minimaxH3: ONE_BILLED_UNIT_PER_SEC_UNMEASURED * unitPrice(MINIMAX_H3),
  wan720pWithAudio: WAN_720P_WITH_AUDIO_BILLED_UNITS_PER_SEC * unitPrice(WAN),
  veoFast: ONE_BILLED_UNIT_PER_SEC_UNMEASURED * unitPrice(VEO_FAST),
} as const;

export const LIP_SYNC_USD_PER_SEC = {
  klingAvatarStandard: unitPrice(KLING_AVATAR_STANDARD),
  minimaxLipSync768p: 0.08,
  minimaxLipSync1080p: 0.16,
  omnihuman: unitPrice(OMNIHUMAN),
  klingAvatarPro: 0.115,
  fabric720p: 0.15,
} as const;

export const SOUND_EFFECT_USD_PER_SEC = unitPrice(SOUND_EFFECTS);
export const CUTOUT_USD = unitPrice(BACKGROUND_REMOVAL);
export const VOICE_USD_PER_CHAR = 0.08 / 1000;

export const MOTION_RATE: Rate = {
  usd: MOTION_USD_PER_SEC,
  unit: "seconds",
  minSeconds: MOTION_MIN_SEC,
};

export const STILL_RATE: Rate = { usd: STILL_USD, unit: "images" };

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
