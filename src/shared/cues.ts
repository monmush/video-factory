// Sounds without words at the end of a line ("[cười]" after a joke): heard in
// the voice, never subtitled, never counted as words (docs/VOICE_DECISIONS.md,
// "Sounds without words"). Scripts carry them in Vietnamese; the voice step
// sends the voice model's own English tag. Pure, so the writer's check, the
// voice step and tests share one list.

/** The cues a script may use, with the tag the voice model understands. */
export const CUES: Record<string, string> = {
  cười: "[laughs]",
  "cười khẽ": "[chuckles]",
  "thở dài": "[sighs]",
};

const BRACKETED = /\[[^\]]*\]/g;
const key = (cue: string) => cue.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * A line as a script may hold it: at most one known cue, only at the very
 * end; any other bracketed text (stage directions, unknown cues) removed.
 */
export function cleanCues(text: string): string {
  const trimmed = text.normalize("NFC").trim();
  const last = /\[([^\]]*)\]\s*$/.exec(trimmed);
  const ending = last && CUES[key(last[1] ?? "")] ? `[${key(last[1] ?? "")}]` : "";
  const body = (last && ending ? trimmed.slice(0, last.index) : trimmed)
    .replace(BRACKETED, " ")
    .replace(/\s+/g, " ")
    .trim();
  return ending && body ? `${body} ${ending}` : body;
}

/** The line as the voice model reads it: known cues as its own tags. */
export function voiceText(text: string): string {
  return text.replace(BRACKETED, (m) => CUES[key(m.slice(1, -1))] ?? m);
}

/** The text without any bracketed sound, for finding words in the voice's timing. */
export const withoutCues = (text: string) =>
  text.replace(BRACKETED, " ").replace(/\s+/g, " ").trim();
