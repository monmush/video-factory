import { describe, expect, it } from "vitest";
import { migrateSettings } from "./batch-settings";
import { estimateSeconds, estimateUsd, estimateVoiceUsd } from "./board";
import { migrateJob, newJob } from "./video-job";
import {
  billedClipSec,
  clipUsd,
  DEFAULT_VIDEO_MODEL,
  LEVEL_LABEL,
  modelForClip,
  modelGroups,
  modelOutput,
  VIDEO_MODELS,
  videoModel,
} from "./video-models";

const model = (id: string) => videoModel(id);

describe("video model registry", () => {
  it("has unique ids, one suggested model per level, only 720p to 1080p, and never shows the middleman's name", () => {
    expect(new Set(VIDEO_MODELS.map((m) => m.id)).size).toBe(VIDEO_MODELS.length);
    for (const level of Object.keys(LEVEL_LABEL)) {
      expect(VIDEO_MODELS.filter((m) => m.level === level && "pick" in m && m.pick)).toHaveLength(
        1,
      );
    }
    for (const m of VIDEO_MODELS) {
      for (const out of Object.values(m.outputs)) {
        expect(["720p", "768p", "1080p"]).toContain(out.resolution);
      }
      expect(`${m.name} ${m.maker} ${m.blurb}`).not.toMatch(/fal/i);
    }
  });

  it("groups by level, suggested first, every model once", () => {
    const groups = modelGroups();
    for (const g of groups) {
      const first = g.models[0];
      expect(first && "pick" in first && first.pick).toBe(true);
      expect(g.models.every((m) => m.level === g.level)).toBe(true);
    }
    const listed = groups.flatMap((g) => g.models.map((m) => m.id));
    expect(listed.sort()).toEqual(VIDEO_MODELS.map((m) => m.id).sort());
  });

  it("reads missing and unknown ids as the default", () => {
    expect(videoModel().id).toBe(DEFAULT_VIDEO_MODEL);
    expect(videoModel(null).id).toBe(DEFAULT_VIDEO_MODEL);
    expect(videoModel("gone-model").id).toBe(DEFAULT_VIDEO_MODEL);
  });

  it("MiniMax follows the output size: 768p in a 720p video, 1080p at twice the rate", () => {
    const minimax = model("minimax-h3-lipsync");
    expect(modelOutput(minimax, "720p")).toEqual({ resolution: "768p", usdPerSec: 0.08 });
    expect(modelOutput(minimax, "1080p")).toEqual({ resolution: "1080p", usdPerSec: 0.16 });
    expect(modelOutput(minimax)).toEqual(modelOutput(minimax, "720p"));
    expect(modelOutput(model("fabric-1-720p"), "1080p").resolution).toBe("720p");
    expect(modelOutput(model("kling-avatar-v2-pro"), "720p").resolution).toBe("1080p");
  });

  it("ids saved before MiniMax was merged keep their resolution", () => {
    expect(videoModel("minimax-h3-lipsync-1080p").id).toBe("minimax-h3-lipsync");
    expect(migrateSettings({ videoModel: "minimax-h3-lipsync-1080p" })).toEqual({
      videoModel: "minimax-h3-lipsync",
      resolution: "1080p",
    });
    expect(
      migrateSettings<{ videoModel?: string; resolution?: string }>({
        videoModel: "minimax-h3-lipsync-768p",
      }).resolution,
    ).toBe("720p");
    expect(
      migrateSettings({ videoModel: "minimax-h3-lipsync-1080p", resolution: "720p" }).resolution,
    ).toBe("720p");
    const job = newJob({
      sessionId: "s",
      seriesId: "x",
      scriptId: "1",
      title: "T",
      lines: [{ characterId: "a", speaker: "A", text: "Một hai" }],
      useEnvironment: false,
      now: "2026-11-13T10:00:00.000Z",
    });
    expect(migrateJob({ ...job, model: "minimax-h3-lipsync-1080p" })).toMatchObject({
      model: "minimax-h3-lipsync",
      resolution: "1080p",
    });
  });

  it("bills at least the model's minimum, and more for long MiniMax clips", () => {
    const minimax = model("minimax-h3-lipsync");
    expect(billedClipSec(minimax, 3)).toBe(5);
    expect(clipUsd(minimax, 3)).toBeCloseTo(5 * 0.08);
    expect(clipUsd(minimax, 3, "1080p")).toBeCloseTo(5 * 0.16);
    expect(clipUsd(minimax, 10)).toBeCloseTo(10 * 0.08);
    expect(clipUsd(minimax, 20)).toBeCloseTo(20 * 0.08 * 1.2);
    expect(clipUsd(model("omnihuman-v2"), 2.5)).toBeCloseTo(4 * 0.105);
    expect(clipUsd(videoModel(), 2.5)).toBeCloseTo(2.5 * 0.0562);
    expect(clipUsd(minimax, 0)).toBe(0);
  });

  it("a clip longer than the model takes is made by the default", () => {
    expect(modelForClip("omnihuman-v2", 299).id).toBe("omnihuman-v2");
    expect(modelForClip("omnihuman-v2", 301).id).toBe(DEFAULT_VIDEO_MODEL);
    expect(modelForClip("kling-avatar-v2-pro", 1000).id).toBe("kling-avatar-v2-pro");
    expect(modelForClip(undefined, 3).id).toBe(DEFAULT_VIDEO_MODEL);
  });
});

describe("board estimates follow the batch's model", () => {
  const lines = [
    { characterId: "a", text: "Con chào ông ạ" },
    { characterId: "b", text: "Ừ, ngồi xuống uống chén trà đã, trà hôm nay ngon lắm đấy con" },
  ];

  it("the default model's rate when none is chosen", () => {
    expect(estimateUsd(lines)).toBeCloseTo(
      estimateSeconds(lines) * 0.0562 + estimateVoiceUsd(lines),
    );
  });

  it("another model's rate, with short lines raised to its minimum", () => {
    const short = 4 / 3.7 + 0.3;
    expect(estimateUsd(lines, { model: "omnihuman-v2" })).toBeCloseTo(
      (estimateSeconds(lines) + (4 - short)) * 0.105 + estimateVoiceUsd(lines),
    );
    expect(estimateUsd(lines, { model: "kling-avatar-v2-pro" })).toBeCloseTo(
      estimateSeconds(lines) * 0.115 + estimateVoiceUsd(lines),
    );
  });

  it("MiniMax costs twice as much in a 1080p video", () => {
    const at = (resolution: string) =>
      estimateUsd(lines, { model: "minimax-h3-lipsync", resolution }) - estimateVoiceUsd(lines);
    expect(at("1080p")).toBeCloseTo(2 * at("720p"));
  });
});
