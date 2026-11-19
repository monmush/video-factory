export const ASSET_CATEGORIES = [
  { id: "characters", label: "Nhân vật" },
  { id: "products", label: "Sản phẩm" },
  { id: "environments", label: "Bối cảnh" },
  { id: "styles", label: "Phong cách" },
  { id: "scenes", label: "Cảnh" },
] as const;

export type AssetCategoryId = (typeof ASSET_CATEGORIES)[number]["id"];

export const findCategory = (id: string | undefined) => ASSET_CATEGORIES.find((c) => c.id === id);
