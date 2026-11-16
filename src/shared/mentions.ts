import { toHandle } from "./handle";

// Tokens typed right before the caret in a prompt box: `#` picks a script,
// `@` a product. Pure, so the pickers and tests share it.

export interface Token {
  /** Index of the `#` or `@`. */
  start: number;
  query: string;
}

/** A `#query` that ends at the caret and starts a word, or null. */
export function findHash(text: string, caret: number): Token | null {
  const match = /(?:^|\s)#([^\s#]{0,40})$/.exec(text.slice(0, caret));
  const query = match?.[1];
  if (query === undefined) return null;
  return { start: caret - query.length - 1, query };
}

/** An `@query` (letters, digits, dashes) that ends at the caret and starts a word, or null. */
export function findAt(text: string, caret: number): Token | null {
  const match = /(?:^|\s)@([\p{L}\p{M}\p{N}-]{0,40})$/u.exec(text.slice(0, caret));
  const query = match?.[1];
  if (query === undefined) return null;
  return { start: caret - query.length - 1, query };
}

const fold = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

/** Digits match the script number; words match the title. */
export function matchScripts<T extends { title: string }>(scripts: T[], query: string): T[] {
  const q = fold(query.trim());
  if (!q) return scripts;
  return scripts.filter((script, i) =>
    /^\d+$/.test(q) ? String(i + 1).startsWith(q) : fold(script.title).includes(q),
  );
}

/**
 * Library products for `@query`: the series' own first (in its order), then
 * the rest. The query matches the handle or the name, ignoring diacritics.
 */
export function matchProducts<T extends { id: string; kind: string; name: string; handle: string }>(
  assets: readonly T[],
  seriesProductIds: readonly string[],
  query: string,
): T[] {
  const products = assets.filter((a) => a.kind === "product");
  const own = seriesProductIds.flatMap((id) => products.find((p) => p.id === id) ?? []);
  const ordered = [...own, ...products.filter((p) => !own.includes(p))];
  const q = toHandle(query);
  if (!q) return ordered;
  return ordered.filter((p) => p.handle.includes(q) || toHandle(p.name).includes(q));
}

/** The text with the token replaced by `@handle `, and the caret after it. */
export function insertMention(
  text: string,
  caret: number,
  token: Token,
  handle: string,
): { text: string; caret: number } {
  const tag = `@${handle} `;
  return {
    text: text.slice(0, token.start) + tag + text.slice(caret),
    caret: token.start + tag.length,
  };
}
