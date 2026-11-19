import { describe, expect, it } from "vitest";
import {
  activeProfile,
  DEFAULT_PROFILE,
  DEFAULT_PROFILE_NAME,
  newProfile,
  parseRegistry,
} from "./profile-rules";

const builtIn = { id: DEFAULT_PROFILE, name: DEFAULT_PROFILE_NAME };

describe("newProfile", () => {
  it("turns a Vietnamese name into a folder-safe id and keeps the name", () => {
    expect(newProfile("  Thử   nghiệm Đầu  ", [builtIn])).toEqual({
      id: "thu-nghiem-dau",
      name: "Thử nghiệm Đầu",
    });
  });

  it("rejects names that cannot become a folder", () => {
    for (const name of ["", "   ", "../..", "/", "!!!"]) {
      expect(() => newProfile(name, [builtIn])).toThrow("Tên không hợp lệ");
    }
  });

  it("rejects a name that collides with an existing profile or the built-in one", () => {
    const existing = [builtIn, { id: "thu-nghiem", name: "Thử nghiệm" }];
    expect(() => newProfile("thu nghiem", existing)).toThrow("Tên đã có");
    expect(() => newProfile("Mặc Định", existing)).toThrow("Tên đã có");
    expect(() => newProfile("Default", existing)).toThrow("Tên không hợp lệ");
  });
});

describe("activeProfile", () => {
  it("uses the pointer only while its folder still exists", () => {
    const registry = parseRegistry(JSON.stringify({ active: "a", names: { a: "A" } }));
    expect(activeProfile(registry, ["a", "b"])).toBe("a");
    expect(activeProfile(registry, ["b"])).toBe(DEFAULT_PROFILE);
  });

  it("falls back to the default for a missing, broken or escaping pointer", () => {
    expect(activeProfile(parseRegistry(null), ["a"])).toBe(DEFAULT_PROFILE);
    expect(activeProfile(parseRegistry("{not json"), ["a"])).toBe(DEFAULT_PROFILE);
    expect(activeProfile(parseRegistry('{"active":"../a"}'), ["../a"])).toBe(DEFAULT_PROFILE);
  });
});
