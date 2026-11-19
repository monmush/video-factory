import type { Alignment, LineChars } from "./shot-plan";

export interface CueWord {
  text: string;
  start: number;
  end: number;
}

export interface Cue {
  start: number;
  end: number;
  words: CueWord[];
}

const MAX_WORDS_PER_CUE = 5;
const MAX_CHARS_PER_CUE = 30;
const MAX_CHARS_PER_ROW = 16;
const SHORT_PAUSE_KEEPS_PHRASE_UP_SEC = 0.6;
const PHRASE_STAYS_AFTER_LAST_WORD_SEC = 0.3;
const MIN_WORDS_BEFORE_A_COMMA_ENDS_A_PHRASE = 3;
export const SUBTITLE_BOTTOM_MARGIN_SHARE = 0.28;
const STILL_PHRASE_LAYER = 0;
const SPOKEN_WORD_LAYER = 1;
const ROWS_BROKEN_BY_US_NEVER_BY_THE_RENDERER = "WrapStyle: 2";

interface Word {
  text: string;
  start: number;
  end: number;
}

const LETTER = /[\p{L}\p{N}]/u;

export function lineWords(text: string): string[] {
  return text
    .normalize("NFC")
    .replace(/\[[^\]]*\]/g, " ")
    .split(/\s+/)
    .filter((w) => LETTER.test(w));
}

export function shownWord(word: string): string {
  return word
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N}?!]+$/u, "")
    .replace(/[^\p{L}\p{N}]+(?=[?!]+$)/u, "");
}

function timedWords(words: string[], alignment: Alignment, chars: LineChars): Word[] | undefined {
  const text = alignment.characters.slice(chars.start, chars.end).join("").normalize("NFC");
  if (text.length !== chars.end - chars.start) return undefined;
  const out: Word[] = [];
  let cursor = 0;
  for (const word of words) {
    const core = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    const at = text.indexOf(core, cursor);
    if (!core || at < 0) return undefined;
    const start = alignment.characterStartTimesSeconds[chars.start + at];
    const end = alignment.characterEndTimesSeconds[chars.start + at + core.length - 1];
    if (start === undefined || end === undefined || end < start) return undefined;
    out.push({ text: word, start, end });
    cursor = at + core.length;
  }
  return out;
}

function spreadWords(words: string[], span: { start: number; end: number }): Word[] {
  const weights = words.map((w) => Math.max(1, w.replace(/[^\p{L}\p{N}]/gu, "").length + 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  return words.map((text, i) => {
    const start = span.start + ((span.end - span.start) * acc) / total;
    acc += weights[i] as number;
    return { text, start, end: span.start + ((span.end - span.start) * acc) / total };
  });
}

const sentenceEnd = (w: string) => /[.!?…]["'”»)]*$/u.test(w);
const clauseEnd = (w: string) => /[,;:—-]["'”»)]*$/u.test(w);
const shownLength = (words: Word[]) => words.map((w) => shownWord(w.text)).join(" ").length;

function phrases(words: Word[]): Word[][] {
  const runs: Word[][] = [];
  let run: Word[] = [];
  for (const word of words) {
    run.push(word);
    if (
      sentenceEnd(word.text) ||
      (clauseEnd(word.text) && run.length >= MIN_WORDS_BEFORE_A_COMMA_ENDS_A_PHRASE)
    ) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs.flatMap((r) => {
    let count = Math.ceil(r.length / MAX_WORDS_PER_CUE);
    for (;;) {
      const size = Math.ceil(r.length / count);
      const parts: Word[][] = [];
      for (let i = 0; i < r.length; i += size) parts.push(r.slice(i, i + size));
      if (count >= r.length || parts.every((p) => shownLength(p) <= MAX_CHARS_PER_CUE)) {
        return parts;
      }
      count++;
    }
  });
}

export function wordCues(
  lines: { text: string }[],
  lineSpans: ({ start: number; end: number } | undefined)[],
  timing?: { alignment: Alignment; lineChars: LineChars[] },
): Cue[] {
  const groups: { words: Word[]; lineEnd: boolean }[] = [];
  lines.forEach((line, i) => {
    const words = lineWords(line.text);
    const span = lineSpans[i];
    const chars = timing?.lineChars[i];
    if (!words.length || !span) return;
    const timed =
      (timing && chars && timedWords(words, timing.alignment, chars)) || spreadWords(words, span);
    const parts = phrases(timed);
    parts.forEach((words, j) => {
      groups.push({ words, lineEnd: j === parts.length - 1 });
    });
  });
  return groups.map((g, i) => {
    const first = g.words[0] as Word;
    const last = g.words.at(-1) as Word;
    const next = groups[i + 1]?.words[0];
    const end =
      next && !g.lineEnd && next.start - last.end < SHORT_PAUSE_KEEPS_PHRASE_UP_SEC
        ? next.start
        : Math.min(
            last.end + PHRASE_STAYS_AFTER_LAST_WORD_SEC,
            next?.start ?? Number.POSITIVE_INFINITY,
          );
    const start = round2(first.start);
    const cueEnd = round2(Math.max(end, first.start + 0.1));
    const words = g.words.map((w, j) => ({
      text: shownWord(w.text),
      start: j === 0 ? start : Math.min(round2(w.start), cueEnd),
      end: j === g.words.length - 1 ? cueEnd : Math.min(round2(g.words[j + 1]?.start ?? 0), cueEnd),
    }));
    return { start, end: cueEnd, words: words.filter((w) => w.text) };
  });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

function assText(text: string): string {
  return text
    .replace(/\{[^}]*\}/g, "")
    .replace(/[{}]/g, "")
    .replace(/\\/g, "⧵")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

export function rowBreak(words: string[]): number | undefined {
  if (words.join(" ").length <= MAX_CHARS_PER_ROW || words.length < 2) return undefined;
  let best = 1;
  let bestLongest = Number.POSITIVE_INFINITY;
  for (let k = 1; k < words.length; k++) {
    const longest = Math.max(words.slice(0, k).join(" ").length, words.slice(k).join(" ").length);
    if (longest < bestLongest || (longest === bestLongest && k < best)) {
      best = k;
      bestLongest = longest;
    }
  }
  return best;
}

const HIDE = "{\\alpha&HFF&}";
const SHOW = "{\\alpha&H00&}";
const LIT =
  "{\\alpha&H00&\\c&H00E6FF&\\fscx100\\fscy100\\t(0,70,\\fscx112\\fscy112)\\t(70,160,\\fscx106\\fscy106)}";

function phraseText(words: string[], tag: (i: number) => string): string {
  const cut = rowBreak(words);
  return words
    .map((w, i) => `${i === cut ? "\\N" : i === 0 ? "" : " "}${tag(i)}${assText(w)}`)
    .join("");
}

export function buildAss(cues: Cue[], size = { width: 720, height: 1280 }): string {
  const fontSize = Math.round(size.height * 0.05);
  const outline = Math.max(3, Math.round(fontSize / 11));
  const shadow = Math.max(2, Math.round(fontSize / 22));
  const marginV = Math.round(size.height * SUBTITLE_BOTTOM_MARGIN_SHARE);
  const marginH = Math.round(size.width * 0.06);
  const events: string[] = [];
  for (const cue of cues) {
    const words = cue.words.map((w) => w.text);
    if (!words.length || cue.end <= cue.start) continue;
    cue.words.forEach((word, i) => {
      if (word.end <= word.start) return;
      const time = `${assTime(word.start)},${assTime(word.end)}`;
      const still = phraseText(words, (j) => (j === i ? HIDE : SHOW));
      const lit = phraseText(words, (j) => (j === i ? LIT : HIDE));
      events.push(`Dialogue: ${STILL_PHRASE_LAYER},${time},Word,,0,0,0,,${still}`);
      events.push(`Dialogue: ${SPOKEN_WORD_LAYER},${time},Word,,0,0,0,,${lit}`);
    });
  }
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${size.width}`,
    `PlayResY: ${size.height}`,
    ROWS_BROKEN_BY_US_NEVER_BY_THE_RENDERER,
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Word,Arial,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${outline},${shadow},2,${marginH},${marginH},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}
