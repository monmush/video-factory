import { resolve, sep } from "node:path";

export class UnsafePathError extends Error {
  constructor() {
    super("Đường dẫn không hợp lệ");
  }
}

export const isSafeSegment = (segment: unknown): segment is string =>
  typeof segment === "string" &&
  segment.length > 0 &&
  segment !== "." &&
  segment !== ".." &&
  !/[/\\\0]/.test(segment);

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
