import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { Asset } from "../../shared/ipc";
import type { PlanSeat } from "../../shared/shot-plan";
import type { VideoJob } from "../../shared/video-job";
import { lookPath, lookStill, readLook, saveLook } from "./look";

let dir = "";
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "hyan-look-"));
  process.env.HYAN_DATA_DIR = dir;
});

const asset = (id: string, kind: Asset["kind"], updatedAt = "t1") =>
  ({ id, kind, name: id, handle: id, description: "", images: [], updatedAt }) as unknown as Asset;
const seat = (characterId: string, side: PlanSeat["side"]): PlanSeat => ({
  characterId,
  side,
  looks: side === "left" ? "frame_right" : "frame_left",
  behind: "",
});

const job = (frames: VideoJob["frames"]): VideoJob =>
  ({
    sessionId: "s",
    scriptId: "1",
    seriesId: "series",
    plan: {
      source: "ai",
      seats: [seat("a", "left"), seat("b", "right")],
      props: [],
      stateChanges: [],
      shots: [],
    },
    frames,
    shots: [],
  }) as unknown as VideoJob;

describe("the series look", () => {
  const place = asset("place", "environment");
  const cast = [asset("a", "character"), asset("b", "character")];

  it("is absent until a video is kept", async () => {
    expect(await readLook("series")).toBeNull();
  });

  it("keeps generated character stills, but not ones the check complained about", async () => {
    await writeFile(join(dir, "a.png"), "A");
    await writeFile(join(dir, "b.png"), "B");
    await saveLook(
      job([
        { id: "wide", kind: "wide", file: "w.png", source: "generated", retried: false },
        {
          id: "character:a",
          kind: "character",
          characterId: "a",
          file: "a.png",
          source: "generated",
          retried: false,
        },
        {
          id: "character:b",
          kind: "character",
          characterId: "b",
          file: "b.png",
          source: "generated",
          check: "looks frame_right",
          retried: false,
        },
      ]),
      dir,
      cast,
      place,
    );
    const look = await readLook("series");
    expect(look?.stills.map((s) => [s.characterId, s.side, s.looks])).toEqual([
      ["a", "left", "frame_right"],
    ]);
    const file = lookStill(look, seat("a", "left"), cast[0] as Asset, place);
    expect(file).toBeTruthy();
    expect(await readFile(lookPath("series", file as string), "utf8")).toBe("A");
  });

  it("stops applying when the seat, the character or the place changes", async () => {
    const look = await readLook("series");
    const a = cast[0] as Asset;
    expect(lookStill(look, seat("a", "right"), a, place)).toBeNull();
    expect(lookStill(look, seat("a", "left"), asset("a", "character", "t2"), place)).toBeNull();
    expect(lookStill(look, seat("a", "left"), a, asset("place", "environment", "t2"))).toBeNull();
    expect(lookStill(look, seat("a", "left"), a, asset("other", "environment"))).toBeNull();
    expect(lookStill(look, seat("b", "right"), cast[1] as Asset, place)).toBeNull();
  });

  it("a later kept video adds its stills and keeps the ones it reused", async () => {
    await saveLook(
      job([
        {
          id: "character:a",
          kind: "character",
          characterId: "a",
          file: "x.png",
          source: "look",
          retried: false,
        },
        {
          id: "character:b",
          kind: "character",
          characterId: "b",
          file: "b.png",
          source: "generated",
          retried: false,
        },
      ]),
      dir,
      cast,
      place,
    );
    const look = await readLook("series");
    expect(look?.stills.map((s) => s.characterId).sort()).toEqual(["a", "b"]);
  });

  it("without a place, still records that the series has a kept video", async () => {
    await saveLook({ ...job([]), seriesId: "plain" } as VideoJob, dir, cast, undefined);
    expect((await readLook("plain"))?.stills).toEqual([]);
  });
});
