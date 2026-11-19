import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { childPath, childPathOrNull, isSafeSegment } from "./safe-path";

const root = "/data/assets";

describe("childPath", () => {
  it("joins plain names inside the folder", () => {
    expect(childPath(root, "abc-123", "photo.png")).toBe(join(root, "abc-123", "photo.png"));
  });

  it("refuses anything that could leave the folder or name it itself", () => {
    for (const bad of ["..", ".", "", "../x", "a/b", "a\\b", "/etc", "x\0y"]) {
      expect(() => childPath(root, bad)).toThrow();
      expect(childPathOrNull(root, "ok", bad)).toBeNull();
    }
    expect(() => childPath(root)).toThrow();
  });

  it("accepts names that only look like dots", () => {
    expect(isSafeSegment("..png")).toBe(true);
    expect(childPath(root, "...")).toBe(join(root, "..."));
  });
});
