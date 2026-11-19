import { describe, expect, it } from "vitest";
import { directorSteps } from "./plan-progress";

const ANSWER = `Here is the plan:
{
  "seats": [{ "character": "Cô gái", "behind": "bamboo", "ambient": "leaves stir" }],
  "props": [{ "name": "teapot", "where": "centre {of} the table" }],
  "state_changes": [],
  "pictures": [
    { "id": "master", "kind": "master", "character": null, "people": ["Cô gái"], "framing": "wide", "description": "A \\"quiet\\" courtyard." },
    { "id": "cg", "kind": "character", "character": "Cô gái", "people": ["Cô gái"], "framing": "mcu", "description": "She sits." },
    { "id": "plate", "kind": "plate", "character": null, "people": [], "framing": "close", "description": "Empty spot." }
  ],
  "shots": [
    { "n": 1, "type": "speaker", "character": "Cô gái", "text": "Ông ơi" },
    { "n": 2, "type": "wide", "character": null, "text": "Đi đâu?" },
    { "n": 3, "type": "detail", "character": null, "product": "Shan Tuyết", "text": "Uống trà" },
    { "n": 4, "type": "listener", "character": "Ông lão", "text": "…" }
  ]
}`;

describe("directorSteps", () => {
  it("reads every picture and shot of a finished answer", () => {
    expect(directorSteps(ANSWER)).toEqual([
      "Đọc kịch bản, bối cảnh và nhân vật",
      "Xếp chỗ ngồi và hướng nhìn",
      "Bày đồ vật trong cảnh",
      "Khung hình: toàn cảnh",
      "Khung hình: Cô gái",
      "Khung hình: chỗ đặt sản phẩm",
      "Cảnh 1: Cô gái nói",
      "Cảnh 2: toàn cảnh",
      "Cảnh 3: sản phẩm",
      "Cảnh 4: Ông lão lắng nghe",
    ]);
  });

  it("reports only objects already closed while the answer is being written", () => {
    expect(directorSteps("")).toEqual(["Đọc kịch bản, bối cảnh và nhân vật"]);
    const cut = ANSWER.slice(0, ANSWER.indexOf('"id": "plate"'));
    expect(directorSteps(cut).at(-1)).toBe("Khung hình: Cô gái");
    const half = ANSWER.slice(0, ANSWER.indexOf('"text": "Đi đâu?"'));
    expect(directorSteps(half).at(-1)).toBe("Cảnh 1: Cô gái nói");
  });

  it("never grows a step list backwards as more text arrives", () => {
    let last = 0;
    for (let i = 0; i <= ANSWER.length; i += 7) {
      const n = directorSteps(ANSWER.slice(0, i)).length;
      expect(n).toBeGreaterThanOrEqual(last);
      last = n;
    }
  });
});
