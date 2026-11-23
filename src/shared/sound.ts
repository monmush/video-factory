import { SOUND_EFFECT_USD_PER_SEC } from "./cost/rates";

export type SoundRole = "ambience" | "spot";

export interface SoundCue {
  id: string;
  role: SoundRole;
  text: string;
  start: number;
  length: number;
  shot?: number;
}

export interface SoundAsk {
  id: string;
  role: SoundRole;
  text: string;
  seconds: number;
  loop: boolean;
  shot?: number;
}

export interface JobSound extends SoundAsk {
  file?: string;
  fileSec?: number;
  requestId?: string;
  submittedAt?: string;
  sending?: string;
  resultUrl?: string;
  costUsd?: number | null;
  costBilled?: boolean;
  attempts: number;
  dropped?: boolean;
  error?: string;
}

interface LayerPlace {
  role: SoundRole;
  start: number;
  length: number;
}

export type AudioLayer =
  | (LayerPlace & { kind: "file"; file: string; fileSec: number })
  | (LayerPlace & { kind: "clip"; shot: number });

export interface SoundSource<Id extends string = string> {
  id: Id;
  usdPerSec: number;
  asks: (cues: readonly SoundCue[]) => SoundAsk[];
  layers: (cues: readonly SoundCue[], sounds: readonly JobSound[]) => AudioLayer[];
}

export const MAX_SOUND_SEC = 30;
const MIN_SOUND_SEC = 0.5;
export const MAX_SOUND_ATTEMPTS = 2;

const clampSec = (s: number) => Math.min(MAX_SOUND_SEC, Math.max(MIN_SOUND_SEC, s));
const round2 = (n: number) => Math.round(n * 100) / 100;

const generatedEffects: SoundSource<"generated-effects"> = {
  id: "generated-effects",
  usdPerSec: SOUND_EFFECT_USD_PER_SEC,
  asks: (cues) =>
    cues.map((c) => ({
      id: c.id,
      role: c.role,
      text: c.text,
      seconds: round2(clampSec(c.length)),
      loop: c.role === "ambience",
      ...(c.shot !== undefined ? { shot: c.shot } : {}),
    })),
  layers: (cues, sounds) =>
    cues.flatMap((c): AudioLayer[] => {
      const made = sounds.find((s) => s.id === c.id && s.text === c.text && s.file);
      if (!made?.file) return [];
      return [
        {
          kind: "file",
          file: made.file,
          fileSec: made.fileSec ?? made.seconds,
          role: c.role,
          start: c.start,
          length: c.length,
        },
      ];
    }),
};

export const SOUND_SOURCES = { "generated-effects": generatedEffects } as const;

export type SoundSourceId = keyof typeof SOUND_SOURCES;

export const SOUND_SOURCE: SoundSourceId = "generated-effects";

export const soundSource = (id?: string | null): SoundSource =>
  SOUND_SOURCES[(id && id in SOUND_SOURCES ? id : SOUND_SOURCE) as SoundSourceId];

export const MAX_SOUND_WORDS = 16;
const NOT_A_SOUND_EFFECT =
  /\b(music|musical|song|songs|singing|sings?|melody|melodies|tune|soundtrack|voices?|vocals?|speech|speaking|speaks?|talk(s|ing)?|chatter|conversation|words?|whisper(s|ing)?|laugh(s|ter|ing)?|narrat\w*)\b/i;

const withinWordLimit = (text: string) => text.split(" ").length <= MAX_SOUND_WORDS;

function leadingClausesWithinLimit(text: string): string {
  const clauses = text.split(/\s*,\s*/).filter(Boolean);
  let kept = "";
  for (const clause of clauses) {
    const longer = kept ? `${kept}, ${clause}` : clause;
    if (!withinWordLimit(longer)) break;
    kept = longer;
  }
  return kept || text.split(" ").slice(0, MAX_SOUND_WORDS).join(" ");
}

export function cleanSoundText(raw: unknown): string {
  const text = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || NOT_A_SOUND_EFFECT.test(text)) return "";
  return withinWordLimit(text) ? text : leadingClausesWithinLimit(text);
}

export interface CueShot {
  index: number;
  kind: string;
  sound?: string;
  start: number;
  end: number;
}

export function soundCues(
  ambience: string | undefined,
  shots: readonly CueShot[],
  totalSec: number,
): SoundCue[] {
  const cues: SoundCue[] = [];
  if (ambience && totalSec > 0) {
    cues.push({ id: "ambience", role: "ambience", text: ambience, start: 0, length: totalSec });
  }
  for (const shot of shots) {
    if (!shot.sound || shot.kind === "speaker") continue;
    const length = shot.end - shot.start;
    if (!(length > 0)) continue;
    cues.push({
      id: `spot:${shot.index}`,
      role: "spot",
      text: shot.sound,
      start: shot.start,
      length,
      shot: shot.index,
    });
  }
  return cues;
}

export const asksUsd = (source: SoundSource, asks: readonly Pick<SoundAsk, "seconds">[]) =>
  asks.reduce((n, a) => n + a.seconds * source.usdPerSec, 0);

export function withAsks(
  sounds: readonly JobSound[] | undefined,
  asks: readonly SoundAsk[],
): JobSound[] {
  const before = sounds ?? [];
  const same = (s: JobSound, a: SoundAsk) => s.id === a.id && s.text === a.text;
  return asks.map((a): JobSound => before.find((s) => same(s, a)) ?? { ...a, attempts: 0 });
}

export const soundOpen = (s: JobSound) => !s.file && !s.dropped;

export const soundToSend = (s: JobSound) => soundOpen(s) && !s.requestId;

export const soundInFlight = (s: JobSound) => soundOpen(s) && Boolean(s.requestId);

export const soundsSettled = (sounds: readonly JobSound[] | undefined) =>
  !(sounds ?? []).some(soundOpen);

export const soundWithdrawn = (sound: JobSound): JobSound => ({
  ...sound,
  requestId: undefined,
  submittedAt: undefined,
  sending: undefined,
  resultUrl: undefined,
});

export function soundAttemptFailed(sound: JobSound, message: string): JobSound {
  const attempts = sound.attempts + 1;
  return {
    ...sound,
    requestId: undefined,
    submittedAt: undefined,
    sending: undefined,
    resultUrl: undefined,
    attempts,
    error: message,
    ...(attempts >= MAX_SOUND_ATTEMPTS ? { dropped: true } : {}),
  };
}

export interface PlacedLayer {
  layer: AudioLayer;
  start: number;
  length: number;
  loop: boolean;
  fadeIn: number;
  fadeOut: number;
  gainDb: number;
}

export const MIX = {
  voiceLufs: -16,
  belowVoiceDb: { ambience: 22, spot: 12 } as Record<SoundRole, number>,
  finalLufs: -14,
  finalTruePeak: -1.5,
  finalLra: 11,
  ambienceFadeInSec: 1,
  ambienceFadeOutSec: 1.5,
  spotFadeInSec: 0.02,
  spotFadeOutSec: 0.2,
} as const;

const SHORTEST_LAYER_SEC = 0.05;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function placeLayers(layers: readonly AudioLayer[], totalSec: number): PlacedLayer[] {
  return layers.flatMap((layer): PlacedLayer[] => {
    const gainDb = -MIX.belowVoiceDb[layer.role];
    if (layer.role === "ambience") {
      const length = totalSec;
      if (length < SHORTEST_LAYER_SEC) return [];
      return [
        {
          layer,
          start: 0,
          length: round3(length),
          loop: layer.kind === "file" && layer.fileSec + 1e-3 < length,
          fadeIn: round3(Math.min(MIX.ambienceFadeInSec, length / 3)),
          fadeOut: round3(Math.min(MIX.ambienceFadeOutSec, length / 3)),
          gainDb,
        },
      ];
    }
    const start = Math.min(Math.max(0, layer.start), totalSec);
    const length = Math.min(
      layer.length,
      totalSec - start,
      layer.kind === "file" ? layer.fileSec : Number.POSITIVE_INFINITY,
    );
    if (length < SHORTEST_LAYER_SEC) return [];
    return [
      {
        layer,
        start: round3(start),
        length: round3(length),
        loop: false,
        fadeIn: round3(Math.min(MIX.spotFadeInSec, length / 3)),
        fadeOut: round3(Math.min(MIX.spotFadeOutSec, length / 3)),
        gainDb,
      },
    ];
  });
}

const FORMAT = "aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo";

export interface MixInput {
  placed: PlacedLayer;
  measuredLufs: number;
}

export function mixGraph(
  voiceLufs: number,
  inputs: readonly MixInput[],
  totalSec: number,
): { filter: string; loops: boolean[] } {
  const total = totalSec.toFixed(3);
  const voiceGain = (MIX.voiceLufs - voiceLufs).toFixed(2);
  const voice = `[0:a]${FORMAT},volume=${voiceGain}dB,apad=whole_dur=${total},atrim=0:${total}`;
  if (!inputs.length) return { filter: `${voice}[mix]`, loops: [] };
  const filters = [`${voice},asplit=2[voice][key]`];
  inputs.forEach(({ placed, measuredLufs }, i) => {
    const gain = (MIX.voiceLufs + placed.gainDb - measuredLufs).toFixed(2);
    const delay = Math.round(placed.start * 1000);
    const fadeOutAt = Math.max(0, placed.length - placed.fadeOut).toFixed(3);
    filters.push(
      `[${i + 1}:a]${FORMAT},atrim=0:${placed.length.toFixed(3)},asetpts=PTS-STARTPTS,` +
        `afade=t=in:d=${placed.fadeIn.toFixed(3)},afade=t=out:st=${fadeOutAt}:d=${placed.fadeOut.toFixed(3)},` +
        `volume=${gain}dB,adelay=${delay}|${delay}[l${i}]`,
    );
  });
  filters.push(
    `${inputs.map((_, i) => `[l${i}]`).join("")}amix=inputs=${inputs.length}:normalize=0:duration=longest,` +
      `apad=whole_dur=${total},atrim=0:${total}[bed]`,
    "[bed][key]sidechaincompress=threshold=0.03:ratio=6:attack=15:release=350[ducked]",
    "[voice][ducked]amix=inputs=2:normalize=0:duration=first[mix]",
  );
  return { filter: filters.join(";"), loops: inputs.map((x) => x.placed.loop) };
}
