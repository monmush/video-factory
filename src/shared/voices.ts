import type { Asset } from "./ipc";

export type VoiceGender = "female" | "male";
export type VoiceAge = "young" | "middle" | "old";
export type VoiceAccent = "north" | "central" | "south";

export const MAX_VOICE_CHARS = 200;

export const ACCENT_WRITING_RULE: Record<VoiceAccent, string> = {
  north:
    'Giọng miền Bắc: không dùng từ địa phương miền khác như "vô", "nha", "hổng", "hông", "trời má", "bự".',
  central:
    'Giọng miền Trung: không dùng từ riêng của miền Bắc như "thế nhỉ", "đấy" hay của miền Nam như "hổng", "hông", "trời má".',
  south:
    'Giọng miền Nam: không dùng từ riêng của miền Bắc như "thế", "nhỉ", "đấy", "vâng", "ốm" (nghĩa là bệnh).',
};

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

type Reading = "character" | "voice";

const saysAMaleVoice = (t: Token, before: Token | undefined, reading: Reading) =>
  reading === "voice" && t.word === "nam" && !t.upper && t.joined && before?.word === "giọng";

function cluesIn(raw: string, reading: Reading = "character"): Found[] {
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
    const maleVoice = saysAMaleVoice(t, before, reading);
    if (!maleVoice && exclude?.before?.includes(before?.word ?? "") && t.joined) continue;
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

function strongestTraits(found: Found[]): VoiceTraits {
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

export const guessVoiceTraits = (name: string, description: string): VoiceTraits =>
  strongestTraits([...cluesIn(name), ...cluesIn(description)]);

const UPLOADED_SAMPLE = /^upload-[0-9a-f]{64}\.mp3$/;

export const isUploadedSample = (name: string) => UPLOADED_SAMPLE.test(name);

export const uploadedSampleName = (sha256Hex: string) => `upload-${sha256Hex}.mp3`;

export const voiceKey = (text: string) =>
  text.normalize("NFC").trim().toLocaleLowerCase("vi").replace(/\s+/g, " ");

export const cleanVoiceText = (text: string | undefined) =>
  (text ?? "").normalize("NFC").replace(/\s+/g, " ").trim().slice(0, MAX_VOICE_CHARS).trim();

interface Region {
  accent: VoiceAccent;
  label: string;
  places: string[];
}

const REGIONS: Region[] = [
  {
    accent: "north",
    label: "miền Bắc",
    places: ["miền bắc", "bắc bộ", "giọng bắc", "người bắc", "hà nội", "hải phòng", "nam định"],
  },
  {
    accent: "central",
    label: "miền Trung",
    places: [
      "miền trung",
      "trung bộ",
      "huế",
      "đà nẵng",
      "xứ nghệ",
      "nghệ an",
      "giọng nghệ",
      "hà tĩnh",
      "quảng bình",
      "quảng trị",
      "quảng nam",
      "quảng ngãi",
      "bình định",
      "phú yên",
      "nha trang",
      "khánh hòa",
    ],
  },
  {
    accent: "south",
    label: "miền Nam",
    places: [
      "miền nam",
      "nam bộ",
      "sài gòn",
      "hồ chí minh",
      "tp.hcm",
      "miền tây",
      "cần thơ",
      "bến tre",
      "an giang",
      "đồng tháp",
      "vĩnh long",
      "cà mau",
      "tiền giang",
      "sóc trăng",
      "bạc liêu",
      "kiên giang",
      "long an",
      "bình dương",
      "đồng nai",
      "vũng tàu",
    ],
  },
];

const COUNTRIES: Record<string, string> = {
  "Hàn Quốc": "Hàn Quốc",
  Hàn: "Hàn Quốc",
  "Nhật Bản": "Nhật Bản",
  Nhật: "Nhật Bản",
  "Trung Quốc": "Trung Quốc",
  "Đài Loan": "Đài Loan",
  "Hồng Kông": "Hồng Kông",
  "Thái Lan": "Thái Lan",
  Thái: "Thái Lan",
  Lào: "Lào",
  Campuchia: "Campuchia",
  Mỹ: "Mỹ",
  Anh: "Anh",
  Pháp: "Pháp",
  Đức: "Đức",
  Nga: "Nga",
  Úc: "Úc",
  "Ấn Độ": "Ấn Độ",
  Philippines: "Philippines",
  Singapore: "Singapore",
  Indonesia: "Indonesia",
  Malaysia: "Malaysia",
  Canada: "Canada",
  Ý: "Ý",
  "Tây Ban Nha": "Tây Ban Nha",
  "Hà Lan": "Hà Lan",
  Tây: "phương Tây",
};

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const asWord = (text: string) => `(?<![\\p{L}\\p{N}])${escaped(text)}(?![\\p{L}\\p{N}])`;

const FOREIGN = new RegExp(
  `(?:[Nn]gười|[Qq]uốc tịch|[Đđ]ến từ|[Gg]ốc)\\s+(${Object.keys(COUNTRIES)
    .sort((a, b) => b.length - a.length)
    .map(escaped)
    .join("|")})(?![\\p{L}\\p{N}])`,
  "u",
);

const firstAt = (text: string, pattern: RegExp) => text.search(pattern);

function placeOf(text: string): { at: number; region: Region } | null {
  const lower = text.normalize("NFC").toLocaleLowerCase("vi");
  let found: { at: number; region: Region } | null = null;
  for (const region of REGIONS) {
    for (const place of region.places) {
      const at = firstAt(lower, new RegExp(asWord(place), "u"));
      if (at >= 0 && (!found || at < found.at)) found = { at, region };
    }
  }
  return found;
}

export const accentOfVoice = (voice: string): VoiceAccent | undefined =>
  placeOf(voice)?.region.accent;

const DEFAULT_REGION = "miền Bắc";

export function voiceRegion(text: string): string {
  const normal = text.normalize("NFC");
  const foreign = FOREIGN.exec(normal);
  const place = placeOf(normal);
  if (foreign && (!place || foreign.index < place.at)) {
    return `người ${COUNTRIES[foreign[1] as string]} nói tiếng Việt`;
  }
  return place?.region.label ?? DEFAULT_REGION;
}

export interface CharacterVoiceTraits extends VoiceTraits {
  region: string;
}

export const characterVoiceTraits = (name: string, description: string): CharacterVoiceTraits => ({
  ...guessVoiceTraits(name, description),
  region: voiceRegion(`${name}. ${description}`),
});

const GENDER_WORD: Record<VoiceGender, string> = { female: "nữ", male: "nam" };
const AGE_WORD: Record<VoiceAge, string> = {
  young: "trẻ",
  middle: "trung niên",
  old: "lớn tuổi",
};

const VARIANTS: Record<VoiceGender, Record<VoiceAge, readonly string[]>> = {
  female: {
    young: ["tươi sáng, nói nhanh", "trong trẻo, nhẹ nhàng", "hơi khàn, tự tin"],
    middle: ["ấm, rõ ràng", "trầm, điềm tĩnh", "sáng, nói nhanh"],
    old: ["ấm, chậm rãi", "hơi khàn, hiền từ", "trong, thong thả"],
  },
  male: {
    young: ["sáng, nói nhanh", "trầm ấm, gần gũi", "khỏe, rõ ràng"],
    middle: ["ấm, trò chuyện", "trầm, điềm đạm", "vang, nói nhanh"],
    old: ["trầm ấm, chậm rãi", "hơi khàn, hiền hậu", "vang, thong thả"],
  },
};

const GENDER_WHEN_UNKNOWN: VoiceGender = "female";
const AGE_WHEN_UNKNOWN: VoiceAge = "middle";

export const voiceTextTraits = (text: string): VoiceTraits =>
  strongestTraits(cluesIn(text, "voice"));

export function spokenTraits(
  text: string,
  character: VoiceTraits,
): VoiceTraits & { gender: VoiceGender } {
  const stated = voiceTextTraits(text);
  const age = stated.age ?? character.age;
  return {
    gender: stated.gender ?? character.gender ?? GENDER_WHEN_UNKNOWN,
    ...(age ? { age } : {}),
  };
}

export function defaultVoiceText(
  traits: CharacterVoiceTraits,
  takenTexts: Iterable<string> = [],
): string {
  const gender = traits.gender ?? GENDER_WHEN_UNKNOWN;
  const age = traits.age ?? AGE_WHEN_UNKNOWN;
  const taken = new Set([...takenTexts].map(voiceKey));
  const options = VARIANTS[gender][age].map(
    (variant) => `Giọng ${GENDER_WORD[gender]} ${AGE_WORD[age]}, ${traits.region}, ${variant}`,
  );
  return options.find((o) => !taken.has(voiceKey(o))) ?? (options[0] as string);
}

const otherCharacters = (assets: readonly Asset[], exceptId?: string) =>
  assets.filter((a) => a.kind === "character" && a.id !== exceptId);

export const takenVoiceTexts = (assets: readonly Asset[], exceptId?: string): string[] =>
  otherCharacters(assets, exceptId).flatMap((a) => (a.voice ? [a.voice] : []));

export const defaultVoiceFor = (
  character: Pick<Asset, "id" | "name" | "description">,
  assets: readonly Asset[],
) =>
  defaultVoiceText(
    characterVoiceTraits(character.name, character.description),
    takenVoiceTexts(assets, character.id),
  );

export const characterVoice = (
  character: Pick<Asset, "id" | "name" | "description" | "voice">,
  assets: readonly Asset[],
) => cleanVoiceText(character.voice) || defaultVoiceFor(character, assets);

const VOICE_TEXT_OF_A_CATALOGUE_VOICE: Record<string, string> = {
  mai: "Giọng nữ trẻ, miền Bắc, tươi sáng, tự nhiên",
  nhu: "Giọng nữ trẻ, miền Bắc, điềm tĩnh, tự tin",
  hanh: "Giọng nữ trẻ, miền Bắc, mượt, rõ ràng",
  hien: "Giọng nữ trung niên, miền Bắc, ấm, trầm",
  trang: "Giọng nữ trung niên, miền Bắc, ấm áp, đáng tin",
  ninh: "Giọng nam trẻ, miền Bắc, trầm ấm, gần gũi",
  son: "Giọng nam trẻ, miền Bắc, rõ ràng, điềm đạm",
  "tuan-anh": "Giọng nam lớn tuổi, miền Bắc, trầm ấm, kể chuyện",
  lam: "Giọng nam trung niên, miền Bắc, ấm, trò chuyện",
  luong: "Giọng nam trung niên, miền Bắc, điềm tĩnh, rõ ràng",
};

export type SavedAsset = Asset & { voiceId?: string };

export function withVoiceTexts(saved: readonly SavedAsset[]): Asset[] {
  const named = saved.map(({ voiceId, ...asset }): Asset => {
    if (asset.kind !== "character") return asset;
    const voice =
      cleanVoiceText(asset.voice) || VOICE_TEXT_OF_A_CATALOGUE_VOICE[voiceId ?? ""] || "";
    return voice ? { ...asset, voice } : asset;
  });
  const done: Asset[] = [];
  for (const asset of named) {
    const needsDefault = asset.kind === "character" && !asset.voice;
    done.push(
      needsDefault ? { ...asset, voice: defaultVoiceFor(asset, [...done, ...named]) } : asset,
    );
  }
  return done;
}
