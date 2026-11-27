import { resolve, sep } from "node:path";
import { isSafeSegment } from "../shared/safe-segment";

export class UnsafePathError extends Error {
  constructor() {
    super("Đường dẫn không hợp lệ");
  }
}

export function childPath(root: string, ...segments: string[]): string {
  if (!segments.every(isSafeSegment)) throw new UnsafePathError();
  const base = resolve(root);
  const path = resolve(base, ...segments);
  if (!path.startsWith(base + sep)) throw new UnsafePathError();
  return path;
}

export function childPathOrNull(root: string, ...segments: string[]): string | null {
  try {
    return childPath(root, ...segments);
  } catch {
    return null;
  }
}
