import { describe, expect, it } from "vitest";
import { deliveredSec, deliveryGraph, seriesBookends } from "./bookends";

describe("delivered length", () => {
  it("speeds up the body only, never the intro or outro", () => {
    const bookends = { intro: { file: "i.mp4", seconds: 5 }, outro: { file: "o.mp4", seconds: 9 } };
    expect(deliveredSec(50, 1.25, bookends)).toBe(54);
    expect(deliveredSec(50, 1.25, undefined)).toBe(40);
  });
});

describe("delivery graph", () => {
  const chains = (filter: string) => filter.split(";");

  it("joins intro, body and outro in that order with the tempo on the body only", () => {
    const { filter, inputs } = deliveryGraph({ tempo: 1.25, intro: true, outro: true });
    expect(inputs).toEqual(["intro", "body", "outro"]);
    const [introV, introA, bodyV, bodyA, outroV, outroA, join] = chains(filter);
    expect(bodyV).toMatch(/^\[1:v:0\]setpts=PTS\/1\.25,/);
    expect(bodyA).toMatch(/^\[1:a:0\]atempo=1\.25,/);
    for (const chain of [introV, introA, outroV, outroA]) {
      expect(chain).not.toMatch(/setpts|atempo/);
    }
    expect(introV).toMatch(/^\[0:v:0\]/);
    expect(outroA).toMatch(/^\[2:a:0\]/);
    expect(join).toBe("[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[v][a]");
  });

  it("puts the body first when there is only an outro, without tempo filters at 1x", () => {
    const { filter, inputs } = deliveryGraph({ tempo: 1, intro: false, outro: true });
    expect(inputs).toEqual(["body", "outro"]);
    expect(filter).not.toMatch(/setpts|atempo/);
    expect(chains(filter).at(-1)).toBe("[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]");
  });

  it("still gives one valid graph when only the tempo changes", () => {
    const { filter, inputs } = deliveryGraph({ tempo: 2, intro: false, outro: false });
    expect(inputs).toEqual(["body"]);
    expect(chains(filter)).toEqual([
      "[0:v:0]setpts=PTS/2,fps=30,setsar=1,format=yuv420p[v0]",
      "[0:a:0]atempo=2,aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a0]",
      "[v0][a0]concat=n=1:v=1:a=1[v][a]",
    ]);
  });
});

describe("saved intro and outro", () => {
  it("drops a slot with an unsafe file name or a bad length", () => {
    expect(
      seriesBookends({
        intro: { file: "../secrets.json", seconds: 5 },
        outro: { file: "outro-1.mp4", seconds: 9 },
      }),
    ).toEqual({ outro: { file: "outro-1.mp4", seconds: 9 } });
    expect(
      seriesBookends({
        intro: { file: "intro-1.mp4", seconds: Number.NaN },
        outro: { file: "outro-1.mp4", seconds: 0 },
      }),
    ).toBeUndefined();
    expect(seriesBookends(undefined)).toBeUndefined();
  });
});
