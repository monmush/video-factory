import { describe, expect, it } from "vitest";
import { BASE_VOICES, sampleIdentity, voiceRequest } from "./voice-request";

const ENDPOINT = "model";
const OLD_MAN = { gender: "male", age: "old" } as const;

describe("voiceRequest", () => {
  it("reads a male voice and the Northern accent from the voice text", () => {
    const request = voiceRequest("Giọng nam lớn tuổi, miền Bắc, trầm ấm, kể chuyện", {});
    expect(BASE_VOICES.male).toContain(request.voice);
    expect(request.style_instructions).toContain(
      "An elderly Vietnamese man, a native speaker with a Northern Vietnamese (Hanoi) accent.",
    );
  });

  it("does not read the Southern region as a male voice", () => {
    const request = voiceRequest("Giọng nữ trẻ, miền Nam, tươi sáng", {});
    expect(BASE_VOICES.female).toContain(request.voice);
    expect(request.style_instructions).toContain(
      "A young Vietnamese woman, a native speaker with a Southern Vietnamese (Saigon) accent.",
    );
  });

  it("takes gender and age from the character when the voice text names none", () => {
    const request = voiceRequest("Trầm ấm, chậm rãi, miền Bắc", OLD_MAN);
    expect(BASE_VOICES.male).toContain(request.voice);
    expect(request.style_instructions).toContain("An elderly Vietnamese man,");
  });

  it("lets the voice text win over the character", () => {
    const request = voiceRequest("Giọng nữ trẻ, miền Bắc, trong trẻo", OLD_MAN);
    expect(BASE_VOICES.female).toContain(request.voice);
    expect(request.style_instructions).toContain("A young Vietnamese woman,");
  });

  it("leaves a foreign speaker's accent to the description", () => {
    const request = voiceRequest("Giọng nữ trẻ, người Hàn Quốc nói tiếng Việt, trong trẻo", {});
    expect(request.style_instructions).toContain(
      "A young woman speaking Vietnamese with exactly the accent the description names.",
    );
  });
});

describe("sampleIdentity", () => {
  it("is the same for the same text and traits however the text is spaced", () => {
    const text = "Giọng nam trẻ, miền Trung, sáng, nói nhanh";
    const spaced = `  ${text.replaceAll(" ", "   ")} `;
    expect(sampleIdentity(ENDPOINT, spaced, OLD_MAN)).toBe(sampleIdentity(ENDPOINT, text, OLD_MAN));
  });

  it("differs when the character decides a different voice", () => {
    const text = "Trầm ấm, chậm rãi, miền Bắc";
    expect(sampleIdentity(ENDPOINT, text, OLD_MAN)).not.toBe(
      sampleIdentity(ENDPOINT, text, { gender: "female", age: "old" }),
    );
  });
});
