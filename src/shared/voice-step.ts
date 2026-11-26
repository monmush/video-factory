import type { VoiceTraits } from "./voices";

export interface JobVoice {
  characterId: string;
  text: string;
  character?: VoiceTraits;
  file: string;
  ready: boolean;
  toMake?: true;
  requestId?: string;
  submittedAt?: string;
  sending?: string;
  resultUrl?: string;
  costUsd?: number | null;
  costBilled?: boolean;
  busyAnswers?: number;
  retried: boolean;
  error?: string;
}

export type VoiceChoice = Pick<JobVoice, "characterId" | "text" | "file" | "ready"> & {
  character: VoiceTraits;
};

export const characterTraitsOf = (v: Pick<JobVoice, "character">): VoiceTraits => v.character ?? {};

const sameTraits = (a: VoiceTraits, b: VoiceTraits) => a.gender === b.gender && a.age === b.age;

interface VoicedJob {
  voices?: JobVoice[];
  voicesKept?: true;
  segments?: { characterId: string; state: string }[];
}

export const voicesNeeded = (job: VoicedJob): string[] => [
  ...new Set((job.segments ?? []).filter((s) => s.state !== "done").map((s) => s.characterId)),
];

export const voiceOf = (job: Pick<VoicedJob, "voices">, characterId: string) =>
  job.voices?.find((v) => v.characterId === characterId);

export const voiceReady = (job: Pick<VoicedJob, "voices">, characterId: string) =>
  Boolean(voiceOf(job, characterId)?.ready);

export function voicesToRecord(job: VoicedJob): boolean {
  const needed = voicesNeeded(job);
  return needed.length > 0 && (!job.voicesKept || needed.some((id) => !voiceOf(job, id)));
}

const fresh = (choice: VoiceChoice): JobVoice => ({
  ...choice,
  ...(choice.ready ? {} : { toMake: true as const }),
  retried: false,
});

export function withVoiceChoices<J extends VoicedJob>(job: J, choices: readonly VoiceChoice[]): J {
  if (job.voicesKept) return job;
  const voices = choices.map(fresh);
  const same =
    job.voices?.length === voices.length &&
    voices.every((v) => {
      const was = voiceOf(job, v.characterId);
      return (
        was?.file === v.file &&
        was.ready === v.ready &&
        was.text === v.text &&
        sameTraits(characterTraitsOf(was), characterTraitsOf(v))
      );
    });
  return same ? job : { ...job, voices };
}

export function keptVoices<J extends VoicedJob>(job: J, choices: readonly VoiceChoice[]): J {
  const kept = job.voicesKept ? (job.voices ?? []) : [];
  const added = choices.filter((c) => !kept.some((v) => v.characterId === c.characterId));
  return { ...job, voices: [...kept, ...added.map(fresh)], voicesKept: true };
}

export const voiceToSend = (v: JobVoice) => !v.ready && !v.requestId && !v.error;

export const voiceInFlight = (v: JobVoice) => !v.ready && Boolean(v.requestId);

export const voiceFailed = (v: JobVoice) => !v.ready && !v.requestId && Boolean(v.error);

const notSent = {
  requestId: undefined,
  submittedAt: undefined,
  sending: undefined,
  resultUrl: undefined,
  busyAnswers: undefined,
};

export const voiceWithdrawn = (v: JobVoice): JobVoice => ({ ...v, ...notSent });

export function voiceAttemptFailed(v: JobVoice, message: string): JobVoice {
  const reset = { ...v, ...notSent };
  return v.retried ? { ...reset, error: message } : { ...reset, retried: true, error: undefined };
}

export const voiceRetried = (v: JobVoice): JobVoice =>
  voiceFailed(v) ? { ...v, retried: false, error: undefined } : v;

export const voiceMade = (v: JobVoice): JobVoice => ({
  ...v,
  sending: undefined,
  busyAnswers: undefined,
  error: undefined,
  ready: true,
});
