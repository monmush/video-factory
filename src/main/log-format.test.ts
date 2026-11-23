import { describe, expect, it } from "vitest";
import { formatLogEntry, redactSecrets } from "./log-format";

const key = "fal-sk-0123456789abcdef";
const time = new Date("2026-11-23T08:30:00.000Z");

describe("formatLogEntry", () => {
  it("hides a key inside a longer message", () => {
    const entry = formatLogEntry(time, "WARN", [`request failed with Key ${key}:x`], [key]);
    expect(entry).toBe("2026-11-23T08:30:00.000Z WARN request failed with Key [key]:x\n");
  });

  it("keeps an error's stack and hides a key inside it", () => {
    const error = new Error(`unauthorized ${key}`);
    const entry = formatLogEntry(time, "ERROR", ["[video] failed", error], [key]);
    expect(entry).toContain("[video] failed Error: unauthorized [key]");
    expect(entry).toContain("log-format.test.ts");
    expect(entry).not.toContain(key);
  });
});

describe("redactSecrets", () => {
  it("ignores empty and short values so normal text survives", () => {
    expect(redactSecrets("video render done", ["", "e", "done", "render "])).toBe(
      "video render done",
    );
  });
});
