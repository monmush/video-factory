import { describe, expect, it } from "vitest";
import type { DirectionEntry } from "./direction";
import { type RewordedScene, reworded, rewordedFrom } from "./reworded";

const scene = (text: string, fields: Partial<RewordedScene> = {}): RewordedScene => ({
  text,
  kind: "speaker",
  framing: "close",
  productId: null,
  brief: `An nói ${text} và mỉm cười với khách`,
  ...fields,
});

const before = [scene("Trà này thơm quá"), scene("Cho tôi một ấm"), scene("Mời anh")];
const plan = { source: "ai" };

describe("what a new plan changed after the words changed", () => {
  it("names only the scenes that look different, wherever they moved", () => {
    const after = [
      scene("Xin chào"),
      scene("Trà này thơm quá"),
      scene("Cho tôi hai ấm"),
      scene("Mời anh"),
    ];
    expect(reworded({ scenes: before, droppedWishes: 0 }, after)).toEqual({
      scenes: [0, 2],
      droppedWishes: 0,
    });
  });

  it("counts a scene with the same words but another picture as changed", () => {
    const after = [scene("Trà này thơm quá", { kind: "wide", framing: null }), ...before.slice(1)];
    expect(reworded({ scenes: before, droppedWishes: 0 }, after).scenes).toEqual([0]);
  });

  it("reads as staged again in full when nothing recognisable is kept", () => {
    const after = before.map((s) => scene(s.text, { brief: "Một cảnh hoàn toàn khác ở quán trà" }));
    expect(reworded({ scenes: before, droppedWishes: 0 }, after).scenes).toBe("all");
    expect(reworded({ scenes: [], droppedWishes: 0 }, before).scenes).toBe("all");
  });

  it("matches repeated scenes one for one", () => {
    const twice = [scene("Mời anh"), scene("Mời anh")];
    expect(reworded({ scenes: [scene("Mời anh")], droppedWishes: 0 }, twice).scenes).toEqual([1]);
  });
});

describe("what to remember before staging again", () => {
  const wish = (words: string): DirectionEntry => ({ words, want: "cận tay", at: words });
  const whole: DirectionEntry = { want: "ánh sáng ấm", at: "w" };

  it("keeps the shown plan and counts the wishes whose words are gone", () => {
    const direction = [wish("một ấm"), wish("Mời anh"), whole];
    const from = rewordedFrom({ plan, shots: before, direction }, [wish("Mời anh"), whole]);
    expect(from).toEqual({ scenes: before, droppedWishes: 1 });
  });

  it("carries the last shown plan across edits made before the new plan exists", () => {
    const carried = { scenes: before, droppedWishes: 1 };
    const direction = [wish("Mời anh")];
    expect(rewordedFrom({ shots: [], direction, rewordedFrom: carried }, [])).toEqual({
      scenes: before,
      droppedWishes: 2,
    });
  });

  it("has nothing to compare for a script that was never staged", () => {
    expect(rewordedFrom({ shots: [] }, [])).toBeUndefined();
  });
});
