import { SPEAKING_CLIP_USD_PER_SEC } from "./cost/rates";

export interface SpeechRequest {
  prompt: string;
  imageUrl: string;
  seconds: number;
}

export type SpeechDurations =
  | { kind: "whole-seconds"; min: number; max: number }
  | { kind: "choices"; values: readonly number[] };

export interface SpeechModel {
  id: string;
  name: string;
  maker: string;
  endpoint: string;
  usdPerSec: number;
  durations: SpeechDurations;
  runsLongerSec?: number;
  input: (req: SpeechRequest) => Record<string, unknown>;
}

export const SPEECH_MODELS = [
  {
    id: "minimax-h3-max",
    name: "MiniMax H3 Max",
    maker: "MiniMax",
    endpoint: "minimax/h3-max/image-to-video",
    usdPerSec: SPEAKING_CLIP_USD_PER_SEC.minimaxH3,
    durations: { kind: "whole-seconds", min: 1, max: 15 },
    runsLongerSec: 0.7,
    input: (r: SpeechRequest) => ({
      prompt: r.prompt,
      image_url: r.imageUrl,
      duration: r.seconds,
      resolution: "768P",
      prompt_expansion_mode: "disabled",
    }),
  },
  {
    id: "wan-3",
    name: "Wan 3.0",
    maker: "Alibaba",
    endpoint: "alibaba/wan-3.0/image-to-video",
    usdPerSec: SPEAKING_CLIP_USD_PER_SEC.wan720pWithAudio,
    durations: { kind: "whole-seconds", min: 2, max: 30 },
    input: (r: SpeechRequest) => ({
      prompt: r.prompt,
      start_image_url: r.imageUrl,
      duration: r.seconds,
      resolution: "720p",
      audio: true,
    }),
  },
  {
    id: "veo-3.1-fast",
    name: "Veo 3.1 Fast",
    maker: "Google",
    endpoint: "fal-ai/veo3.1/fast/image-to-video",
    usdPerSec: SPEAKING_CLIP_USD_PER_SEC.veoFast,
    durations: { kind: "choices", values: [4, 6, 8] },
    input: (r: SpeechRequest) => ({
      prompt: r.prompt,
      image_url: r.imageUrl,
      duration: `${r.seconds}s`,
      resolution: "720p",
      aspect_ratio: "9:16",
      generate_audio: true,
    }),
  },
] as const satisfies readonly SpeechModel[];

export type SpeechModelId = (typeof SPEECH_MODELS)[number]["id"];

const SPEECH_MODELS_TO_TRY: readonly SpeechModelId[] = ["wan-3", "veo-3.1-fast", "minimax-h3-max"];

const byId = new Map<string, SpeechModel>(SPEECH_MODELS.map((m) => [m.id, m]));

export const speechModel = (id?: string | null): SpeechModel =>
  byId.get(id ?? "") ?? (byId.get("wan-3") as SpeechModel);

export function askedSpeechSec(model: SpeechModel, wantedSec: number): number | null {
  const want = Math.max(0, wantedSec);
  if (model.durations.kind === "choices") {
    return model.durations.values.find((v) => v + 1e-9 >= want) ?? null;
  }
  const whole = Math.max(model.durations.min, Math.ceil(want - 1e-9));
  return whole <= model.durations.max ? whole : null;
}

const LONGER_STEP_SEC = 2;

export function longerSpeechSec(model: SpeechModel, askedSec: number): number {
  if (model.durations.kind === "choices") {
    return model.durations.values.find((v) => v > askedSec + 1e-9) ?? askedSec + LONGER_STEP_SEC;
  }
  return askedSec + LONGER_STEP_SEC;
}

export function speechModelToTry(
  levelDefault: string,
  rejected: readonly string[],
  wantedSec: number,
): SpeechModel | null {
  const order = [...new Set([speechModel(levelDefault).id, ...SPEECH_MODELS_TO_TRY])];
  return (
    order
      .map((id) => speechModel(id))
      .find((m) => !rejected.includes(m.id) && askedSpeechSec(m, wantedSec) !== null) ?? null
  );
}

export const speechUsd = (model: SpeechModel, askedSec: number) => askedSec * model.usdPerSec;

export type VoiceMode = "dubbed" | "native";

export const SPEECH_MARGIN_SEC = 2;
