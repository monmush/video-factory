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

export function voiceText(text: string): string {
  return text.replace(BRACKETED, (m) => CUES[key(m.slice(1, -1))] ?? m);
}

export const withoutCues = (text: string) =>
  text.replace(BRACKETED, " ").replace(/\s+/g, " ").trim();
