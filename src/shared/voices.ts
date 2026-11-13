import type { Asset } from "./ipc";

// Character voices: a short list we chose and tested, with our own names.
// The provider mapping lives in src/main/voices.ts and never reaches the
// renderer. Rules and how the list was chosen: docs/VOICE_DECISIONS.md.

export type VoiceGender = "female" | "male";
export type VoiceAge = "young" | "middle" | "old";
export type VoiceAccent = "north" | "central" | "south";

export type VoiceId =
  | "mai"
  | "nhu"
  | "hanh"
  | "hien"
  | "trang"
  | "ninh"
  | "son"
  | "tuan-anh"
  | "lam"
  | "luong";

export interface Voice {
  id: VoiceId;
  name: string;
  gender: VoiceGender;
  /** Age bands the voice suits, best fit first. */
  ages: VoiceAge[];
  accent: VoiceAccent;
  /** Two or three Vietnamese words describing the sound. */
  label: string;
}

/** Preference order within each gender: earlier voices are suggested first. */
export const VOICES: readonly Voice[] = [
  {
    id: "mai",
    name: "Mai",
    gender: "female",
    ages: ["young"],
    accent: "north",
    label: "tươi sáng, tự nhiên",
  },
  {
    id: "nhu",
    name: "Như",
    gender: "female",
    ages: ["young"],
    accent: "north",
    label: "điềm tĩnh, tự tin",
  },
  {
    id: "hanh",
    name: "Hạnh",
    gender: "female",
    ages: ["young"],
    accent: "north",
    label: "mượt, rõ ràng",
  },
  {
    id: "hien",
    name: "Hiền",
    gender: "female",
    ages: ["middle", "old"],
    accent: "north",
    label: "ấm, trầm",
  },
  {
    id: "trang",
    name: "Trang",
    gender: "female",
    ages: ["middle", "old"],
    accent: "north",
    label: "ấm áp, đáng tin",
  },
  {
    id: "ninh",
    name: "Ninh",
    gender: "male",
    ages: ["young"],
    accent: "north",
    label: "trầm ấm, gần gũi",
  },
  {
    id: "son",
    name: "Sơn",
    gender: "male",
    ages: ["young"],
    accent: "north",
    label: "rõ ràng, điềm đạm",
  },
  {
    id: "tuan-anh",
    name: "Tuấn Anh",
    gender: "male",
    ages: ["old", "middle"],
    accent: "north",
    label: "trầm ấm, kể chuyện",
  },
  {
    id: "lam",
    name: "Lâm",
    gender: "male",
    ages: ["middle"],
    accent: "north",
    label: "ấm, trò chuyện",
  },
  {
    id: "luong",
    name: "Lượng",
    gender: "male",
    ages: ["middle"],
    accent: "north",
    label: "điềm tĩnh, rõ ràng",
  },
];

/** Approved by ear for the pilot's young woman and elderly man. */
export const DEFAULT_VOICE: Record<VoiceGender, VoiceId> = { female: "mai", male: "tuan-anh" };
/** Used when nothing tells us the character's gender. */
export const FALLBACK_VOICE: VoiceId = "mai";

export const ACCENTS: { id: VoiceAccent; label: string }[] = [
  { id: "north", label: "Bắc" },
  { id: "central", label: "Trung" },
  { id: "south", label: "Nam" },
];

export function voiceById(id: string | undefined): Voice | undefined {
  return id ? VOICES.find((v) => v.id === id) : undefined;
}

export interface VoiceTraits {
  gender?: VoiceGender;
  age?: VoiceAge;
}

export const ageBand = (years: number): VoiceAge =>
  years < 35 ? "young" : years < 60 ? "middle" : "old";

// --- Guessing gender and age from Vietnamese text --------------------------

type Clue = { gender?: VoiceGender; age?: VoiceAge };

/** Strength 2: words that say gender or age outright. */
const PLAIN: Record<string, Clue> = {
  nam: { gender: "male" },
  "đàn ông": { gender: "male" },
  "nam giới": { gender: "male" },
  trai: { gender: "male" },
  "thanh niên": { gender: "male", age: "young" },
  nữ: { gender: "female" },
  "phụ nữ": { gender: "female" },
  "nữ giới": { gender: "female" },
  gái: { gender: "female" },
  "thiếu nữ": { gender: "female", age: "young" },
  trẻ: { age: "young" },
  "đôi mươi": { age: "young" },
  "trung niên": { age: "middle" },
  "lớn tuổi": { age: "old" },
  "cao tuổi": { age: "old" },
  già: { age: "old" },
  lão: { age: "old" },
};

/** Strength 1: forms of address, which imply gender and roughly age. */
const ADDRESS: Record<string, Clue> = {
  ông: { gender: "male", age: "old" },
  bà: { gender: "female", age: "old" },
  cụ: { age: "old" },
  bác: { age: "old" },
  chú: { gender: "male", age: "middle" },
  anh: { gender: "male", age: "young" },
  cậu: { gender: "male", age: "young" },
  chàng: { gender: "male", age: "young" },
  chị: { gender: "female", age: "young" },
  cô: { gender: "female", age: "young" },
};

/** Common words a keyword appears in with another meaning: [before, after]. */
const NOT_A_CLUE: Record<string, { before?: string[]; after?: string[] }> = {
  nam: {
    before: ["việt", "miền", "phía", "hướng", "phương", "hà", "quảng", "giọng", "đông", "tây"],
    after: ["bộ", "định", "á", "phi", "mỹ", "cực", "kỳ", "trung"],
  },
  anh: { before: ["tiếng", "nước"], after: ["hùng", "đào", "tú"] },
  cô: { after: ["đơn", "độc", "đọng", "lập", "đặc"] },
  chú: { before: ["ghi"], after: ["ý", "thích", "trọng", "tâm"] },
  bác: { after: ["sĩ", "bỏ", "học"] },
  cụ: { before: ["dụng", "công"], after: ["thể"] },
  bà: { after: ["con"] },
  già: { after: ["dặn"] },
};

interface Token {
  word: string;
  /** Written with a capital letter. */
  upper: boolean;
  /** Only spaces separate it from the previous token. */
  joined: boolean;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let last = -1;
  for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const raw = m[0];
    const gap = last < 0 ? "" : text.slice(last, m.index);
    tokens.push({
      word: raw.toLowerCase(),
      upper: raw[0] !== raw[0]?.toLowerCase(),
      joined: last >= 0 && /^\s+$/.test(gap),
    });
    last = (m.index ?? 0) + raw.length;
  }
  return tokens;
}

type Found = { clue: Clue; strength: number };

/** Clues in reading order. */
function cluesIn(raw: string): Found[] {
  const text = raw.normalize("NFC");
  const tokens = tokenize(text);
  const found: Found[] = [];
  const normal = text.toLowerCase();

  // Numbers: "65 tuổi", "khoảng 30–35 tuổi" (the middle of a range).
  for (const m of normal.matchAll(/(\d{1,3})\+?(?:\s*(?:-|–|—|đến|tới)\s*(\d{1,3}))?\s*tuổi/gu)) {
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    found.push({ clue: { age: ageBand((from + to) / 2) }, strength: 3 });
  }

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as Token;
    const next = tokens[i + 1];
    const pair = next?.joined ? `${t.word} ${next.word}` : undefined;
    if (pair && PLAIN[pair]) {
      found.push({ clue: PLAIN[pair], strength: 2 });
      i++;
      continue;
    }
    const exclude = NOT_A_CLUE[t.word];
    const before = tokens[i - 1];
    if (exclude?.before?.includes(before?.word ?? "") && t.joined) continue;
    if (exclude?.after?.includes(next?.word ?? "") && next?.joined) continue;
    // "không còn trẻ": no longer young.
    if (t.word === "trẻ" && before?.word === "còn" && tokens[i - 2]?.word === "không") {
      found.push({ clue: { age: "middle" }, strength: 1 });
      continue;
    }
    if (PLAIN[t.word]) {
      found.push({ clue: PLAIN[t.word] as Clue, strength: 2 });
      continue;
    }
    const address = ADDRESS[t.word];
    // "Tuấn Anh", "Mai Anh": a capitalised word right after another is a name.
    if (address && !(t.upper && before?.upper && t.joined)) {
      found.push({ clue: address, strength: 1 });
    }
  }
  return found;
}

/**
 * Gender and age band from a character's name and description, as far as the
 * Vietnamese text tells. Stronger clues win (an age in years over "trẻ" over
 * "chị"); among equals, the name, then the earliest mention.
 */
export function guessVoiceTraits(name: string, description: string): VoiceTraits {
  const found = [...cluesIn(name), ...cluesIn(description)];
  const pick = <K extends keyof Clue>(key: K): Clue[K] => {
    let best: Found | undefined;
    for (const f of found) {
      if (f.clue[key] && (!best || f.strength > best.strength)) best = f;
    }
    return best?.clue[key];
  };
  const traits: VoiceTraits = {};
  const gender = pick("gender");
  const age = pick("age");
  if (gender) traits.gender = gender;
  if (age) traits.age = age;
  return traits;
}

// --- Choosing a voice -------------------------------------------------------

const AGE_ORDER: VoiceAge[] = ["young", "middle", "old"];

/** How far a voice is from an age band: 0 is its best fit. */
function ageDistance(voice: Voice, age: VoiceAge): number {
  const fit = voice.ages.indexOf(age);
  if (fit >= 0) return fit;
  const target = AGE_ORDER.indexOf(age);
  return 10 + Math.min(...voice.ages.map((a) => Math.abs(AGE_ORDER.indexOf(a) - target)));
}

/**
 * The voice to suggest for a character: same gender, closest age, in
 * preference order, avoiding voices other characters already use while the
 * gender has a free one. Always returns a catalogue id.
 */
export function suggestVoice(traits: VoiceTraits, takenIds: Iterable<string> = []): VoiceId {
  const taken = new Set(takenIds);
  const gender = traits.gender ?? (voiceById(FALLBACK_VOICE) as Voice).gender;
  const fallback = traits.gender ? DEFAULT_VOICE[gender] : FALLBACK_VOICE;
  const pool = VOICES.map((voice, order) => ({ voice, order })).filter(
    (v) => v.voice.gender === gender,
  );
  const rank = ({ voice, order }: (typeof pool)[number]) =>
    traits.age
      ? ageDistance(voice, traits.age) * 100 + order
      : (voice.id === fallback ? -1 : 0) * 100 + order;
  const ranked = pool.sort((a, b) => rank(a) - rank(b)).map((v) => v.voice.id);
  return ranked.find((id) => !taken.has(id)) ?? ranked[0] ?? fallback;
}

/** The character's saved voice, or the rule's choice when none is saved. */
export function resolveVoice(
  asset: Pick<Asset, "name" | "description" | "voiceId">,
  takenIds: Iterable<string> = [],
): VoiceId {
  return (
    voiceById(asset.voiceId)?.id ??
    suggestVoice(guessVoiceTraits(asset.name, asset.description), takenIds)
  );
}

/** Voices saved on characters other than `exceptId`. */
export function takenVoiceIds(assets: readonly Asset[], exceptId?: string): VoiceId[] {
  return assets.flatMap((a) => {
    const voice = a.kind === "character" && a.id !== exceptId ? voiceById(a.voiceId) : undefined;
    return voice ? [voice.id] : [];
  });
}
