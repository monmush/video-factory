export interface ProductShare {
  productId: string;
  share: number;
}

export type ProductMix = ProductShare[];

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

const mixTotal = (mix: ProductMix) => mix.reduce((n, e) => n + e.share, 0);

export function evenMix(productIds: readonly string[]): ProductMix {
  const n = productIds.length;
  if (!n) return [];
  const base = Math.floor(100 / n);
  return productIds.map((productId, i) => ({
    productId,
    share: base + (i < 100 - base * n ? 1 : 0),
  }));
}

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

export function defaultMix(productIds: readonly string[], offset: number): ProductMix {
  const n = productIds.length;
  if (n < 2) return [];
  const start = ((Math.trunc(offset) % n) + n) % n;
  return evenMix([...productIds.slice(start), ...productIds.slice(0, start)]);
}

export function mentionedProducts(
  text: string,
  products: readonly { id: string; handle: string }[],
): string[] {
  const found: { id: string; at: number }[] = [];
  const lower = text.toLowerCase();
  for (const p of products) {
    const tag = `@${p.handle.toLowerCase()}`;
    if (tag.length < 2) continue;
    for (let at = lower.indexOf(tag); at >= 0; at = lower.indexOf(tag, at + 1)) {
      const before = at > 0 ? (lower[at - 1] as string) : "";
      const after = lower[at + tag.length] ?? "";
      if (!/[a-z0-9-]/.test(before) && !/[a-z0-9-]/.test(after)) {
        found.push({ id: p.id, at });
        break;
      }
    }
  }
  return [...new Set(found.sort((a, b) => a.at - b.at).map((f) => f.id))];
}

export function newTopicProducts(input: {
  named: readonly (string | null | undefined)[];
  onBoard: readonly (string | null)[];
  mentioned?: readonly string[];
  savedMix?: ProductMix;
  seriesProductIds: readonly string[];
  offset: number;
}): (string | null | undefined)[] {
  const { named, onBoard, mentioned, savedMix, seriesProductIds, offset } = input;
  const given = named.filter((p): p is string | null => p !== undefined);
  const open = named.filter((p) => p === undefined).length;
  const assigned = mentioned?.length
    ? assignProducts(evenMix(mentioned), [], open)
    : assignProducts(
        savedMix?.length ? savedMix : defaultMix(seriesProductIds, offset),
        [...onBoard, ...given],
        open,
      );
  let next = 0;
  return named.map((p) => (p !== undefined ? p : assigned[next++]));
}
