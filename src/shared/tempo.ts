import { lengthFit, promisedSec } from "./pace";

export const TEMPOS = [1, 1.25, 1.5, 2] as const;

export type Tempo = (typeof TEMPOS)[number];

export const pickedTempo = (value: unknown): Tempo | undefined =>
  TEMPOS.find((tempo) => tempo === value);

export const tempoLabel = (tempo: number) => `${String(tempo).replace(".", ",")}x`;

interface TimedJob {
  lines: readonly { text: string }[];
  pace?: number;
  finalSec?: number;
  tempo?: unknown;
}

export const jobTempo = (job: TimedJob): number => pickedTempo(job.tempo) ?? 1;

export const atTempoSec = (seconds: number, tempo: number) => seconds / tempo;

export const finalSecAtTempo = (job: TimedJob): number | null =>
  job.finalSec === undefined ? null : atTempoSec(job.finalSec, jobTempo(job));

export interface FinishedLength {
  seconds: number;
  offScriptSec: number | null;
}

export function finishedLength(job: TimedJob): FinishedLength | null {
  const seconds = finalSecAtTempo(job);
  if (seconds === null) return null;
  const promised = promisedSec(job);
  const offScript = promised !== null && lengthFit(seconds, promised) !== "fits";
  return { seconds, offScriptSec: offScript ? promised : null };
}
