import { describe, expect, it } from "vitest";
import { VIDEO_MODELS } from "../../shared/video-models";
import { shotEndpoint } from "./shot-models";

const REQ = {
  imageUrl: "https://x/i.png",
  audioUrl: "https://x/a.mp3",
  prompt: "Speaks.",
  resolution: "720p" as const,
};
const input = (id: string, resolution: "720p" | "1080p" = "720p") =>
  shotEndpoint(id).input({ ...REQ, resolution });

describe("speaking-shot requests", () => {
  it("only models marked as taking a prompt are sent one", () => {
    for (const m of VIDEO_MODELS) expect("prompt" in input(m.id)).toBe(m.takesPrompt);
  });

  it("Kling keeps the input of the successful live test", () => {
    expect(input("kling-avatar-v2-standard")).toEqual({
      image_url: REQ.imageUrl,
      audio_url: REQ.audioUrl,
      prompt: "Speaks.",
      enable_safety_checker: true,
    });
    expect(input("kling-avatar-v2-pro")).toEqual(input("kling-avatar-v2-standard"));
  });

  it("OmniHuman takes a prompt; Fabric and MiniMax do not", () => {
    expect(input("omnihuman-v2")).toEqual({
      image_url: REQ.imageUrl,
      audio_url: REQ.audioUrl,
      prompt: "Speaks.",
    });
    expect(input("fabric-1-720p")).not.toHaveProperty("prompt");
    expect(input("minimax-h3-lipsync")).not.toHaveProperty("prompt");
  });

  it("MiniMax follows the video's size; Fabric is always 720p; never 480p", () => {
    expect(input("minimax-h3-lipsync", "720p").resolution).toBe("768P");
    expect(input("minimax-h3-lipsync", "1080p").resolution).toBe("1080P");
    expect(input("fabric-1-720p", "1080p").resolution).toBe("720p");
    // Ids saved before the merge are asked like the merged model.
    expect(input("minimax-h3-lipsync-1080p", "1080p")).toEqual(
      input("minimax-h3-lipsync", "1080p"),
    );
    for (const m of VIDEO_MODELS) {
      for (const r of ["720p", "1080p"] as const) {
        expect(String(input(m.id, r).resolution ?? "")).not.toMatch(/480/);
      }
    }
  });

  it("reads the video and its billed seconds; none when the provider reports none", () => {
    const read = shotEndpoint("omnihuman-v2").read;
    expect(read({ video: { url: "https://v/1.mp4" }, duration: 4 })).toEqual({
      url: "https://v/1.mp4",
      seconds: 4,
    });
    expect(shotEndpoint("fabric-1-720p").read({ video: { url: "https://v/2.mp4" } })).toEqual({
      url: "https://v/2.mp4",
      seconds: undefined,
    });
    expect(read(null)).toEqual({ url: undefined, seconds: undefined });
  });

  it("unknown ids are asked like the default", () => {
    expect(input("gone-model")).toEqual(input("kling-avatar-v2-standard"));
  });
});
