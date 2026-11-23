export const NO_CAPTIONS = "No captions, subtitles, watermarks or any text on screen.";
export const CLEAN_FOOTAGE =
  "Every frame is clean, unedited camera footage that looks exactly like the reference image, with nothing laid over the picture.";

const isNegative = (key: string) => /negative/i.test(key);

function promptKey(input: Record<string, unknown>): string | undefined {
  if (typeof input.prompt === "string") return "prompt";
  return Object.keys(input).find((k) => /prompt/i.test(k) && !isNegative(k));
}

export function withCleanFrame(input: Record<string, unknown>): Record<string, unknown> {
  const key = promptKey(input);
  const text = key ? input[key] : undefined;
  if (!key || typeof text !== "string") return input;
  if (Object.keys(input).some(isNegative)) {
    return text.includes(NO_CAPTIONS)
      ? input
      : { ...input, [key]: `${text.trim()} ${NO_CAPTIONS}` };
  }
  const plain = text.replace(NO_CAPTIONS, "").replace(/\s+/g, " ").trim();
  const clean = plain.includes(CLEAN_FOOTAGE) ? plain : `${plain} ${CLEAN_FOOTAGE}`.trim();
  return clean === text ? input : { ...input, [key]: clean };
}

const SHOT_PROMPT = `The person speaks naturally with subtle head movement and natural expression. Keep the face, hair and outfit faithful to the reference image; the camera stays steady unless a camera move is described. ${CLEAN_FOOTAGE}`;
const LISTEN_PROMPT = `The person listens silently with the mouth closed, reacting only with the eyes, brows and a slight head movement. Keep the face, hair and outfit faithful to the reference image; the camera stays steady unless a camera move is described. ${CLEAN_FOOTAGE}`;

export const background = (ambient?: string) =>
  ambient
    ? `The place behind them stays exactly the same, with gentle natural motion: ${ambient.replace(/[.\s]+$/, "")}. Nothing new appears.`
    : "Keep the place behind them faithful to the reference image.";

export const speakPrompt = (listening: boolean, ambient: string | undefined, extra?: string) =>
  [listening ? LISTEN_PROMPT : SHOT_PROMPT, background(ambient), extra?.trim()]
    .filter(Boolean)
    .join(" ");

export const MOTION_OF_A_STILL_MOMENT =
  "The moment in the picture comes alive: the people breathe, blink and shift slightly, anything loose in the place stirs gently, and the camera pushes in slowly. Nobody speaks.";

export const STILL_FORMAT = "Make a vertical 9:16 photograph.";
export const STILL_IDENTITY =
  "Keep every person identical to their reference photos: same face, age, hair, outfit and accessories, with any logo or lettering on their clothing kept exactly as in the photos or left plain.";
export const STILL_BEFORE_SPEAKING = "Mouth closed, hands away from the face.";
export const stillBeforeSpeakingWith = (main: string) =>
  `${main} has the mouth closed and the hands away from the face; nobody else's mouth is clearly visible.`;
export const STILL_NO_TEXT = "No added text, signs, labels or packaging anywhere.";

const AFTER_SPEAKING: Record<string, string> = {
  cười: "then they laugh",
  "cười khẽ": "then they laugh softly",
  "thở dài": "then they sigh",
};

const SPEAKS_ALONE =
  "The person in the picture speaks to someone just out of frame, starting right away.";
const SPEAKS_AMONG_OTHERS =
  "The main person in the picture speaks, starting right away; everyone else stays silent and still, with their mouths closed.";
const SPEECH_FAITHFUL =
  "Keep the face, hair and outfit faithful to the reference image; the camera stays steady unless a camera move is described.";
const SPEECH_SOUND =
  "The only sound is their voice and the natural quiet sound of the room; no music.";

export interface SpeechPromptInput {
  people: number;
  words: string;
  cue: string | null;
  voice: string;
  motion?: string;
  ambient?: string;
}

const asSentence = (text: string) => {
  const t = text.trim();
  return !t || /[.!?]$/.test(t) ? t : `${t}.`;
};

export function speechPrompt(input: SpeechPromptInput): string {
  const after = input.cue ? AFTER_SPEAKING[input.cue] : undefined;
  const said = `They say: "${input.words}"${after ? `, ${after}.` : ""}`;
  return [
    input.people > 1 ? SPEAKS_AMONG_OTHERS : SPEAKS_ALONE,
    asSentence(input.motion ?? ""),
    said,
    input.voice,
    background(input.ambient),
    SPEECH_SOUND,
    SPEECH_FAITHFUL,
    CLEAN_FOOTAGE,
  ]
    .filter(Boolean)
    .join(" ");
}

export function plannedMotion(prompt: unknown, listening: boolean, ambient?: string): string {
  if (typeof prompt !== "string") return "";
  const planned = speakPrompt(listening, ambient);
  return prompt.startsWith(planned) ? prompt.slice(planned.length).trim() : "";
}
