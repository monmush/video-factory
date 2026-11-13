// Burned-in subtitles for the final video (docs/VIDEO_GENERATION_DECISIONS.md).
// Short-form style: a phrase of up to five words sits still in the centre;
// the word being spoken turns yellow and nudges up, alone. The nudge is drawn
// on a layer above the phrase, so no other word ever moves. Words are timed
// from the voice provider's character timing; without it (fixture mode, old
// jobs) they are spread across each line's span in proportion to length.
// Written as ASS for FFmpeg's libass filter. Pure, so the timing is tested.

import type { Alignment, LineChars } from "./shot-plan";

/** One word's highlight: from when it is spoken until the next word is. */
export interface CueWord {
  text: string;
  start: number;
  end: number;
}

/** A phrase on screen. Words tile [start, end) exactly. */
export interface Cue {
  start: number;
  end: number;
  words: CueWord[];
}

/** Most words in one phrase. Phrases are balanced, so 6 words show as 3 + 3. */
export const MAX_WORDS_PER_CUE = 5;
/** Most characters in one phrase (two rows on screen). */
const MAX_CHARS_PER_CUE = 30;
/** A phrase longer than this goes on two rows. */
const MAX_CHARS_PER_ROW = 16;
/** A pause shorter than this keeps the phrase up (no flicker). */
const HOLD_GAP_SEC = 0.6;
/** How long a phrase stays after its last word is spoken. */
const TAIL_SEC = 0.3;

interface Word {
  text: string;
  start: number;
  end: number;
}

const LETTER = /[\p{L}\p{N}]/u;

/** A line's words, without audio tags like "[whispers]". */
export function lineWords(text: string): string[] {
  return text
    .normalize("NFC")
    .replace(/\[[^\]]*\]/g, " ")
    .split(/\s+/)
    .filter((w) => LETTER.test(w));
}

/** What a word shows: closing punctuation dropped except ? and !. */
export function shownWord(word: string): string {
  return word
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N}?!]+$/u, "")
    .replace(/[^\p{L}\p{N}]+(?=[?!]+$)/u, "");
}

/** Each word's time from the provider's characters, or undefined if one can't be found. */
function timedWords(words: string[], alignment: Alignment, chars: LineChars): Word[] | undefined {
  const text = alignment.characters.slice(chars.start, chars.end).join("").normalize("NFC");
  // The provider may hand back NFD characters; the joined text must still map 1:1.
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

/** Words spread across the line's span in proportion to their letters. */
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

/**
 * A line's words in phrases: split at sentence ends, at commas once a phrase
 * has three words, then into balanced phrases of at most five words.
 */
function phrases(words: Word[]): Word[][] {
  const runs: Word[][] = [];
  let run: Word[] = [];
  for (const word of words) {
    run.push(word);
    if (sentenceEnd(word.text) || (clauseEnd(word.text) && run.length >= 3)) {
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

/**
 * Phrases for the whole dialogue. Times are on the dialogue's timeline,
 * which is also the final video's.
 */
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
    // Holds until the next phrase in the same line unless the pause is long.
    const end =
      next && !g.lineEnd && next.start - last.end < HOLD_GAP_SEC
        ? next.start
        : Math.min(last.end + TAIL_SEC, next?.start ?? Number.POSITIVE_INFINITY);
    const start = round2(first.start);
    const cueEnd = round2(Math.max(end, first.start + 0.1));
    // Each word is lit until the next one starts; the last until the phrase goes.
    const words = g.words.map((w, j) => ({
      text: shownWord(w.text),
      start: j === 0 ? start : Math.min(round2(w.start), cueEnd),
      end: j === g.words.length - 1 ? cueEnd : Math.min(round2(g.words[j + 1]?.start ?? 0), cueEnd),
    }));
    return { start, end: cueEnd, words: words.filter((w) => w.text) };
  });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** ASS time: H:MM:SS.cc (centiseconds). */
export function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

/** Text safe for an ASS Dialogue line: no override blocks, no hard breaks. */
export function assText(text: string): string {
  return text
    .replace(/\{[^}]*\}/g, "")
    .replace(/[{}]/g, "")
    .replace(/\\/g, "⧵")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

/** Where a phrase breaks onto a second row (index of the first word below), or none. */
export function rowBreak(words: string[]): number | undefined {
  if (words.join(" ").length <= MAX_CHARS_PER_ROW || words.length < 2) return undefined;
  let best = 1;
  let bestLongest = Number.POSITIVE_INFINITY;
  for (let k = 1; k < words.length; k++) {
    const longest = Math.max(words.slice(0, k).join(" ").length, words.slice(k).join(" ").length);
    // Ties go to the shorter top row: a pyramid reads more easily.
    if (longest < bestLongest || (longest === bestLongest && k < best)) {
      best = k;
      bestLongest = longest;
    }
  }
  return best;
}

const HIDE = "{\\alpha&HFF&}";
const SHOW = "{\\alpha&H00&}";
/** The spoken word: yellow, nudged up and back in about 0.16 s. */
const LIT =
  "{\\alpha&H00&\\c&H00E6FF&\\fscx100\\fscy100\\t(0,70,\\fscx112\\fscy112)\\t(70,160,\\fscx106\\fscy106)}";

/** One phrase's text with each word wrapped by `tag(index)`, rows kept fixed. */
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
  // Below the faces, above the platform's own caption and buttons.
  const marginV = Math.round(size.height * 0.28);
  const marginH = Math.round(size.width * 0.06);
  const events: string[] = [];
  for (const cue of cues) {
    const words = cue.words.map((w) => w.text);
    if (!words.length || cue.end <= cue.start) continue;
    cue.words.forEach((word, i) => {
      if (word.end <= word.start) return;
      const time = `${assTime(word.start)},${assTime(word.end)}`;
      // Layer 0: the still phrase without the spoken word. Layer 1: only the spoken word.
      // Hidden words keep their space, so both layers lay out identically.
      const still = phraseText(words, (j) => (j === i ? HIDE : SHOW));
      const lit = phraseText(words, (j) => (j === i ? LIT : HIDE));
      events.push(`Dialogue: 0,${time},Word,,0,0,0,,${still}`);
      events.push(`Dialogue: 1,${time},Word,,0,0,0,,${lit}`);
    });
  }
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${size.width}`,
    `PlayResY: ${size.height}`,
    // Rows are broken by us, never by the renderer, so the nudge can't reflow them.
    "WrapStyle: 2",
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
