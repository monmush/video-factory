import type { Asset } from "./ipc";

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
  ages: VoiceAge[];
  accent: VoiceAccent;
  label: string;
}

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

const EAR_APPROVED_VOICE_PER_GENDER: Record<VoiceGender, VoiceId> = {
  female: "mai",
  male: "tuan-anh",
};
const VOICE_WHEN_GENDER_UNKNOWN: VoiceId = "mai";

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

type Clue = { gender?: VoiceGender; age?: VoiceAge };

const SAYS_GENDER_OR_AGE_OUTRIGHT: Record<string, Clue> = {
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

const FORMS_OF_ADDRESS: Record<string, Clue> = {
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

const SAME_WORD_WITH_ANOTHER_MEANING: Record<string, { before?: string[]; after?: string[] }> = {
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
  upper: boolean;
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

const AGE_IN_YEARS = 3;
const SAID_OUTRIGHT = 2;
const ROUGH_HINT = 1;

type Found = { clue: Clue; strength: number };

function cluesIn(raw: string): Found[] {
  const text = raw.normalize("NFC");
  const tokens = tokenize(text);
  const found: Found[] = [];
  const normal = text.toLowerCase();

  for (const m of normal.matchAll(/(\d{1,3})\+?(?:\s*(?:-|–|—|đến|tới)\s*(\d{1,3}))?\s*tuổi/gu)) {
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    found.push({ clue: { age: ageBand((from + to) / 2) }, strength: AGE_IN_YEARS });
  }

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as Token;
    const next = tokens[i + 1];
    const pair = next?.joined ? `${t.word} ${next.word}` : undefined;
    if (pair && SAYS_GENDER_OR_AGE_OUTRIGHT[pair]) {
      found.push({ clue: SAYS_GENDER_OR_AGE_OUTRIGHT[pair], strength: SAID_OUTRIGHT });
      i++;
      continue;
    }
    const exclude = SAME_WORD_WITH_ANOTHER_MEANING[t.word];
    const before = tokens[i - 1];
    if (exclude?.before?.includes(before?.word ?? "") && t.joined) continue;
    if (exclude?.after?.includes(next?.word ?? "") && next?.joined) continue;
    const noLongerYoung =
      t.word === "trẻ" && before?.word === "còn" && tokens[i - 2]?.word === "không";
    if (noLongerYoung) {
      found.push({ clue: { age: "middle" }, strength: ROUGH_HINT });
      continue;
    }
    if (SAYS_GENDER_OR_AGE_OUTRIGHT[t.word]) {
      found.push({ clue: SAYS_GENDER_OR_AGE_OUTRIGHT[t.word] as Clue, strength: SAID_OUTRIGHT });
      continue;
    }
    const address = FORMS_OF_ADDRESS[t.word];
    const partOfACapitalisedName = t.upper && before?.upper && t.joined;
    if (address && !partOfACapitalisedName) {
      found.push({ clue: address, strength: ROUGH_HINT });
    }
  }
  return found;
}

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

const OUTSIDE_THE_VOICES_OWN_AGES = 10;
const AGE_ORDER: VoiceAge[] = ["young", "middle", "old"];

function ageDistance(voice: Voice, age: VoiceAge): number {
  const fit = voice.ages.indexOf(age);
  if (fit >= 0) return fit;
  const target = AGE_ORDER.indexOf(age);
  return (
    OUTSIDE_THE_VOICES_OWN_AGES +
    Math.min(...voice.ages.map((a) => Math.abs(AGE_ORDER.indexOf(a) - target)))
  );
}

export function suggestVoice(traits: VoiceTraits, takenIds: Iterable<string> = []): VoiceId {
  const taken = new Set(takenIds);
  const gender = traits.gender ?? (voiceById(VOICE_WHEN_GENDER_UNKNOWN) as Voice).gender;
  const fallback = traits.gender
    ? EAR_APPROVED_VOICE_PER_GENDER[gender]
    : VOICE_WHEN_GENDER_UNKNOWN;
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

export function resolveVoice(
  asset: Pick<Asset, "name" | "description" | "voiceId">,
  takenIds: Iterable<string> = [],
): VoiceId {
  return (
    voiceById(asset.voiceId)?.id ??
    suggestVoice(guessVoiceTraits(asset.name, asset.description), takenIds)
  );
}

export function takenVoiceIds(assets: readonly Asset[], exceptId?: string): VoiceId[] {
  return assets.flatMap((a) => {
    const voice = a.kind === "character" && a.id !== exceptId ? voiceById(a.voiceId) : undefined;
    return voice ? [voice.id] : [];
  });
}
