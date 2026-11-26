export const CUES: Record<string, string> = {
  cười: "[laughs]",
  "cười khẽ": "[chuckles]",
  "thở dài": "[sighs]",
};

const BRACKETED = /\[[^\]]*\]/g;
const key = (cue: string) => cue.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");

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

export const withoutCues = (text: string) =>
  text.replace(BRACKETED, " ").replace(/\s+/g, " ").trim();

export function splitTrailingCue(text: string): { words: string; cue: string | null } {
  const trimmed = text.normalize("NFC").trim();
  const last = /\[([^\]]*)\]\s*$/.exec(trimmed);
  const cue = last ? key(last[1] ?? "") : "";
  if (!last || !CUES[cue]) return { words: withoutCues(trimmed), cue: null };
  return { words: withoutCues(trimmed.slice(0, last.index)), cue };
}
