export const NO_CAPTIONS = "No captions, subtitles, watermarks or any text on screen.";

export function withNoCaptions(input: Record<string, unknown>): Record<string, unknown> {
  const key = "prompt" in input ? "prompt" : Object.keys(input).find((k) => /prompt/i.test(k));
  const text = key ? input[key] : undefined;
  if (!key || typeof text !== "string" || text.includes(NO_CAPTIONS)) return input;
  return { ...input, [key]: `${text.trim()} ${NO_CAPTIONS}`.trim() };
}
const SHOT_PROMPT = `The person speaks naturally with subtle head movement and natural expression. Keep the face, hair and outfit faithful to the reference image; the camera stays steady unless a camera move is described. ${NO_CAPTIONS}`;
const LISTEN_PROMPT = `The person listens silently with the mouth closed, reacting only with the eyes, brows and a slight head movement. Keep the face, hair and outfit faithful to the reference image; the camera stays steady unless a camera move is described. ${NO_CAPTIONS}`;

export const background = (ambient?: string) =>
  ambient
    ? `The place behind them stays exactly the same, with gentle natural motion: ${ambient.replace(/[.\s]+$/, "")}. Nothing new appears.`
    : "Keep the place behind them faithful to the reference image.";

export const speakPrompt = (listening: boolean, ambient: string | undefined, extra?: string) =>
  [listening ? LISTEN_PROMPT : SHOT_PROMPT, background(ambient), extra?.trim()]
    .filter(Boolean)
    .join(" ");

export const STILL_FORMAT = "Make a vertical 9:16 photograph.";
export const STILL_IDENTITY =
  "Keep every person identical to their reference photos: same face, age, hair, outfit and accessories, with any logo or lettering on their clothing kept exactly as in the photos or left plain.";
export const STILL_BEFORE_SPEAKING = "Mouth closed, hands away from the face.";
export const stillBeforeSpeakingWith = (main: string) =>
  `${main} has the mouth closed and the hands away from the face; nobody else's mouth is clearly visible.`;
export const STILL_NO_TEXT = "No added text, signs, labels or packaging anywhere.";
