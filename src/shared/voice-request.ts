import {
  accentOfVoice,
  cleanVoiceText,
  spokenTraits,
  type VoiceAccent,
  type VoiceAge,
  type VoiceGender,
  type VoiceTraits,
  voiceKey,
} from "./voices";

export const VOICE_PREVIEW_TEXT =
  "Xin chào! Đây là giọng nói của tôi. Hôm nay trời đẹp quá, mình ngồi xuống đây một lát rồi kể cho nhau nghe một câu chuyện nhỏ nhé. Bạn có muốn nghe thử không?";

export const BASE_VOICES: Record<VoiceGender, readonly string[]> = {
  female: [
    "Achernar",
    "Aoede",
    "Autonoe",
    "Callirrhoe",
    "Despina",
    "Erinome",
    "Gacrux",
    "Kore",
    "Laomedeia",
    "Leda",
    "Pulcherrima",
    "Sulafat",
    "Vindemiatrix",
    "Zephyr",
  ],
  male: [
    "Achird",
    "Algenib",
    "Algieba",
    "Alnilam",
    "Charon",
    "Enceladus",
    "Fenrir",
    "Iapetus",
    "Orus",
    "Puck",
    "Rasalgethi",
    "Sadachbia",
    "Sadaltager",
    "Schedar",
    "Umbriel",
    "Zubenelgenubi",
  ],
};

const AGE_WORDS: Record<VoiceAge | "unknown", string> = {
  young: "A young",
  middle: "A middle-aged",
  old: "An elderly",
  unknown: "A",
};

const PERSON: Record<VoiceGender, string> = { female: "woman", male: "man" };

const ACCENT: Record<VoiceAccent, string> = {
  north: "a Northern Vietnamese (Hanoi) accent",
  central: "a Central Vietnamese (Huế) accent",
  south: "a Southern Vietnamese (Saigon) accent",
};

const DELIVERY =
  "Speaking naturally, as in everyday conversation. Clean, dry, close-microphone studio recording with no background sound and no music.";

function stableHash(text: string): number {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0) as number;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function whoAndAccent(text: string, gender: VoiceGender, age: VoiceAge | undefined): string {
  const who = AGE_WORDS[age ?? "unknown"];
  const accent = accentOfVoice(text);
  if (!accent) {
    return `${who} ${PERSON[gender]} speaking Vietnamese with exactly the accent the description names.`;
  }
  return `${who} Vietnamese ${PERSON[gender]}, a native speaker with ${ACCENT[accent]}.`;
}

export type VoiceRequest = {
  prompt: string;
  voice: string;
  style_instructions: string;
};

const presetFor = (text: string, gender: VoiceGender) => {
  const pool = BASE_VOICES[gender];
  return pool[stableHash(voiceKey(text)) % pool.length] as string;
};

export function voiceRequest(text: string, character: VoiceTraits): VoiceRequest {
  const clean = cleanVoiceText(text);
  const { gender, age } = spokenTraits(clean, character);
  return {
    prompt: VOICE_PREVIEW_TEXT,
    voice: presetFor(clean, gender),
    style_instructions: [
      whoAndAccent(clean, gender, age),
      `The voice is described in Vietnamese as: "${clean.replace(/"/g, "'")}".`,
      DELIVERY,
    ].join(" "),
  };
}

export function sampleIdentity(endpoint: string, text: string, character: VoiceTraits): string {
  const { voice, style_instructions } = voiceRequest(text, character);
  return [endpoint, voice, style_instructions].join("\n");
}
