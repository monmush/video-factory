export const TEMPOS = [1, 1.25, 1.5, 2] as const;

export type Tempo = (typeof TEMPOS)[number];

export const tempoOf = (value: unknown): Tempo => TEMPOS.find((tempo) => tempo === value) ?? 1;

export const tempoLabel = (tempo: Tempo) => `${String(tempo).replace(".", ",")}x`;

export const atTempoSec = (seconds: number, tempo: unknown) => seconds / tempoOf(tempo);
