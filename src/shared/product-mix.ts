// A batch's product mix (docs/SCRIPT_BOARD_DECISIONS.md, "Product per
// video"): which products the batch's videos feature, as whole percentages
// summing to 100. It is a target for scripts not yet written: each new topic
// is given the product the board is furthest behind on. Scripts already
// written change only when someone asks. One product per video. Pure, so the
// main process, the board and tests share it.

export interface ProductShare {
  productId: string;
  /** Whole percent, 1–100. */
  share: number;
}

export type ProductMix = ProductShare[];

/** Why a mix cannot be saved, or null when it can. */
export function mixProblem(mix: ProductMix, isProduct: (id: string) => boolean): string | null {
  const ids = new Set<string>();
  for (const entry of mix) {
    if (!isProduct(entry.productId)) return "Không tìm thấy sản phẩm";
    if (ids.has(entry.productId)) return "Sản phẩm bị lặp";
    ids.add(entry.productId);
    if (!Number.isInteger(entry.share) || entry.share < 1 || entry.share > 100) {
      return "Tỉ lệ phải là số nguyên từ 1 đến 100";
    }
  }
  const total = mixTotal(mix);
  if (mix.length && total !== 100) return `Tổng là ${total}%, cần 100%`;
  return null;
}

export const mixTotal = (mix: ProductMix) => mix.reduce((n, e) => n + e.share, 0);

/** Equal shares for these products, summing to 100 (the first ones take the remainder). */
export function evenMix(productIds: readonly string[]): ProductMix {
  const n = productIds.length;
  if (!n) return [];
  const base = Math.floor(100 / n);
  return productIds.map((productId, i) => ({
    productId,
    share: base + (i < 100 - base * n ? 1 : 0),
  }));
}

/**
 * Products for `count` new scripts: each goes to the product furthest below
 * its share of the board as it will be (ties: the earlier one in the mix).
 * `existing` is the product of each script already on the board (null: none);
 * those count toward the total whatever they feature. No mix: no assignment
 * (undefined), so the writer chooses as before.
 */
export function assignProducts(
  mix: ProductMix | undefined,
  existing: readonly (string | null)[],
  count: number,
): (string | undefined)[] {
  if (!mix?.length) return Array.from({ length: count }, () => undefined);
  const counts = new Map(mix.map((e) => [e.productId, 0]));
  for (const id of existing) {
    if (id && counts.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let total = existing.length;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    total++;
    let best = mix[0] as ProductShare;
    let bestGap = Number.NEGATIVE_INFINITY;
    for (const entry of mix) {
      const gap = (entry.share / 100) * total - (counts.get(entry.productId) ?? 0);
      if (gap > bestGap + 1e-9) {
        best = entry;
        bestGap = gap;
      }
    }
    counts.set(best.productId, (counts.get(best.productId) ?? 0) + 1);
    out.push(best.productId);
  }
  return out;
}

/** How many scripts feature each product, in order of first appearance; none counted apart. */
export function productCounts(scripts: readonly { productIds: readonly string[] }[]) {
  const counts = new Map<string, number>();
  let none = 0;
  for (const s of scripts) {
    const id = s.productIds[0];
    if (!id) none++;
    else counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return { counts, none };
}

/**
 * Short labels for product names in a tight space: words every name shares
 * are dropped ("Bạch Trà Shan Tuyết", "Hồng Trà Shan Tuyết", "Shan Tuyết Cổ
 * Thụ" read "Bạch Trà", "Hồng Trà", "Cổ Thụ"), unless that would empty one.
 */
export function shortNames(names: readonly string[]): string[] {
  if (names.length < 2) return [...names];
  const words = names.map((n) => n.split(/\s+/).filter(Boolean));
  const key = (w: string) => w.toLocaleLowerCase("vi");
  const shared = new Set(words[0]?.map(key));
  for (const list of words.slice(1)) {
    const mine = new Set(list.map(key));
    for (const w of shared) if (!mine.has(w)) shared.delete(w);
  }
  if (!shared.size) return [...names];
  const short = words.map((list) => list.filter((w) => !shared.has(key(w))).join(" "));
  return short.some((s) => !s) ? [...names] : short;
}
