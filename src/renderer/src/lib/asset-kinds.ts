import { type AngleId, type AssetKind, CORE_ANGLES } from "@shared/ipc";
import { type LucideIcon, Package, Trees, UserRound } from "lucide-react";

export interface AssetKindConfig {
  noun: string;
  icon: LucideIcon;
  titleNew: string;
  titleEdit: string;
  create: string;
  remove: string;
  namePlaceholder: string;
  descriptionPlaceholder: string;
  descriptionHint?: string;
  emptyImagesHint: string;
  emptyLibrary: string;
  views: AngleId[];
  generateViews: boolean;
}

export const ASSET_KINDS: Record<AssetKind, AssetKindConfig> = {
  character: {
    noun: "nhân vật",
    icon: UserRound,
    titleNew: "Nhân vật mới",
    titleEdit: "Sửa nhân vật",
    create: "Tạo nhân vật",
    remove: "Xóa nhân vật",
    namePlaceholder: "Tên nhân vật",
    descriptionPlaceholder: "Độ tuổi, khuôn mặt, kiểu tóc, trang phục, màu sắc chủ đạo…",
    descriptionHint: "Mô tả ngoại hình nhìn thấy được là hiệu quả nhất. Không cần tiểu sử.",
    emptyImagesHint: "Kéo thả ảnh vào đây hoặc chọn từ máy. Nên có nhiều góc nhìn khác nhau.",
    emptyLibrary: "Tạo nhân vật dùng lại được từ ảnh tham chiếu, rồi gọi bằng @tên trong lời nhắc.",
    views: [...CORE_ANGLES, "other"],
    generateViews: true,
  },
  product: {
    noun: "sản phẩm",
    icon: Package,
    titleNew: "Sản phẩm mới",
    titleEdit: "Sửa sản phẩm",
    create: "Tạo sản phẩm",
    remove: "Xóa sản phẩm",
    namePlaceholder: "Tên sản phẩm",
    descriptionPlaceholder: "Loại bao bì, hình dạng, màu sắc, chữ trên nhãn…",
    emptyImagesHint: "Kéo thả ảnh gốc rõ nét của sản phẩm vào đây hoặc chọn từ máy.",
    emptyLibrary: "Thêm sản phẩm bằng ảnh gốc, rồi gọi bằng @tên trong lời nhắc.",
    views: [],
    generateViews: false,
  },
  environment: {
    noun: "bối cảnh",
    icon: Trees,
    titleNew: "Bối cảnh mới",
    titleEdit: "Sửa bối cảnh",
    create: "Tạo bối cảnh",
    remove: "Xóa bối cảnh",
    namePlaceholder: "Tên bối cảnh, ví dụ: Sân nhà cổ",
    descriptionPlaceholder: "Địa điểm, kiến trúc, đồ vật, ánh sáng, màu sắc, không khí…",
    descriptionHint: "Mô tả không gian nhìn thấy được. Không cần mô tả người hay sản phẩm.",
    emptyImagesHint:
      "Kéo thả ảnh bối cảnh bạn thích vào đây hoặc chọn từ máy. Nhiều góc của cùng một nơi càng tốt.",
    emptyLibrary: "Lưu những bối cảnh bạn thích từ ảnh, rồi chọn cho series hoặc gọi bằng @tên.",
    views: [],
    generateViews: false,
  },
};

export const CATEGORY_KIND: Partial<Record<string, AssetKind>> = {
  characters: "character",
  products: "product",
  environments: "environment",
};
