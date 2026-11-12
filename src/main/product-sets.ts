import type { Asset } from "../shared/ipc";

/**
 * Product sets are one level deep: a set contains products, never sets, and a
 * contained product cannot contain others. Checked on the would-be state.
 */
export function checkSets(assets: Pick<Asset, "id" | "kind" | "contains">[]) {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const children = new Set<string>();
  for (const parent of assets) {
    for (const childId of parent.contains ?? []) {
      const child = byId.get(childId);
      if (parent.kind !== "product" || child?.kind !== "product") {
        throw new Error("Chỉ sản phẩm mới ghép được thành bộ");
      }
      if (childId === parent.id) throw new Error("Sản phẩm không thể nằm trong chính nó");
      if (child.contains?.length) throw new Error("Một bộ không thể nằm trong bộ khác");
      children.add(childId);
    }
  }
  for (const parent of assets) {
    if (parent.contains?.length && children.has(parent.id)) {
      throw new Error("Một bộ không thể nằm trong bộ khác");
    }
  }
}
