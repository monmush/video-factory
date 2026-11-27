import { describe, expect, it } from "vitest";
import type { Asset, AssetKind, Series, Workspace } from "./ipc";
import {
  buildShare,
  INVALID_SHARE_MESSAGE,
  mergeShare,
  NEWER_SHARE_MESSAGE,
  parseShare,
} from "./setup-share";

const at = "2026-11-01T00:00:00.000Z";

const asset = (id: string, kind: AssetKind, handle = id, extra: Partial<Asset> = {}): Asset => ({
  id,
  kind,
  name: id,
  handle,
  description: "",
  images: [{ id: `${id}-img`, file: `${id}.png` }],
  ...(kind === "character" ? { voice: "Giọng nữ trẻ" } : {}),
  createdAt: at,
  updatedAt: at,
  ...extra,
});

const series = (id: string, extra: Partial<Series> = {}): Series => ({
  id,
  name: id,
  guidance: "",
  characterIds: [],
  productIds: [],
  environmentIds: [],
  createdAt: at,
  updatedAt: at,
  ...extra,
});

const workspace = (extra: Partial<Workspace> = {}): Workspace => ({
  version: 1,
  series: [],
  sessions: [],
  assets: [],
  ...extra,
});

const shareOf = (ws: Workspace) =>
  parseShare(JSON.parse(JSON.stringify(buildShare(ws, { createdAt: at, appVersion: "1.0.0" }))));

describe("parseShare", () => {
  const valid = () =>
    JSON.parse(JSON.stringify(buildShare(workspace(), { createdAt: at, appVersion: "1" })));

  it("asks for an update when the file comes from a newer version", () => {
    expect(() => parseShare({ ...valid(), version: 2 })).toThrow(NEWER_SHARE_MESSAGE);
  });

  it.each([
    ["another format", { format: "zip" }],
    ["series that are not objects", { series: ["x"] }],
    ["an asset id that climbs out of its folder", { assets: [asset("..", "product")] }],
    [
      "an image file with a path",
      { assets: [asset("a", "product", "a", { images: [{ id: "i", file: "../secrets.json" }] })] },
    ],
    [
      "a cutout file with a path",
      {
        assets: [
          asset("a", "product", "a", {
            images: [{ id: "i", file: "a.png", cutout: { file: "x/y.png", usable: true } }],
          }),
        ],
      },
    ],
  ])("rejects %s", (_, change) => {
    expect(() => parseShare({ ...valid(), ...change })).toThrow(INVALID_SHARE_MESSAGE);
  });

  it("keeps fields it does not know and normalises old series fields", () => {
    const raw = {
      ...valid(),
      series: [{ ...series("s"), videoModel: "old", futureField: 1, characterIds: undefined }],
    };
    const parsed = parseShare(raw);
    expect(parsed.series[0]).toMatchObject({ futureField: 1, characterIds: [] });
    expect(parsed.series[0]).not.toHaveProperty("videoModel");
  });

  it("keeps a series' intro and outro but drops one whose file name leaves its folder", () => {
    const bookends = {
      intro: { file: "../../secrets.json", seconds: 4 },
      outro: { file: "outro-1.mp4", seconds: 9 },
    };
    const parsed = parseShare({ ...valid(), series: [series("s", { bookends })] });
    expect(parsed.series[0]?.bookends).toEqual({ outro: { file: "outro-1.mp4", seconds: 9 } });
  });
});

describe("buildShare", () => {
  it("leaves out sessions and pins", () => {
    const share = buildShare(
      workspace({
        series: [series("s", { pinnedAt: at })],
        sessions: [
          { id: "b", seriesId: "s", name: "b", approvedAt: null, createdAt: at, updatedAt: at },
        ],
      }),
      { createdAt: at, appVersion: "1" },
    );
    expect(share).not.toHaveProperty("sessions");
    expect(share.series[0]).not.toHaveProperty("pinnedAt");
  });
});

describe("mergeShare", () => {
  it("adds what is missing and keeps the receiver's own copy of what exists", () => {
    const local = asset("shared", "character", "lan", { name: "Lan đã sửa" });
    const ws = workspace({ assets: [local], series: [series("mine", { name: "Của tôi" })] });
    const share = shareOf(
      workspace({
        assets: [asset("shared", "character", "lan", { name: "Lan gốc" }), asset("p", "product")],
        series: [series("mine", { name: "Đè lên" }), series("new")],
      }),
    );
    const merged = mergeShare(ws, share);
    expect(merged.assets.find((a) => a.id === "shared")?.name).toBe("Lan đã sửa");
    expect(merged.series.find((s) => s.id === "mine")?.name).toBe("Của tôi");
    expect(merged.addedAssetIds).toEqual(["p"]);
    expect(merged.addedSeriesIds).toEqual(["new"]);
    expect(merged.skipped).toBe(2);
  });

  it("links a newly shared asset to a series the receiver already has, and nothing else", () => {
    const ws = workspace({
      assets: [asset("hero", "character"), asset("old", "product")],
      series: [series("s", { characterIds: ["hero"], productIds: [] })],
    });
    const share = shareOf(
      workspace({
        assets: [asset("hero", "character"), asset("old", "product"), asset("fresh", "product")],
        series: [series("s", { characterIds: ["hero"], productIds: ["old", "fresh"] })],
      }),
    );
    const merged = mergeShare(ws, share).series.find((s) => s.id === "s");
    expect(merged?.productIds).toEqual(["fresh"]);
    expect(merged?.characterIds).toEqual(["hero"]);
  });

  it("gives an incoming asset a free handle when another asset already uses it", () => {
    const long = "a".repeat(40);
    const ws = workspace({
      assets: [
        asset("x", "product", "lan"),
        asset("y", "product", "lan-2"),
        asset("z", "product", long),
      ],
    });
    const share = shareOf(
      workspace({ assets: [asset("in1", "character", "lan"), asset("in2", "product", long)] }),
    );
    const handles = mergeShare(ws, share).assets.map((a) => a.handle);
    expect(handles.slice(3)).toEqual(["lan-3", `${"a".repeat(38)}-2`]);
    expect(new Set(handles).size).toBe(handles.length);
  });

  it("links an added series only to assets that exist and are of the right kind", () => {
    const ws = workspace({ assets: [asset("place", "environment")] });
    const share = shareOf(
      workspace({
        assets: [asset("hero", "character")],
        series: [
          series("s", {
            characterIds: ["hero", "gone", "place"],
            environmentIds: ["place", "hero"],
          }),
        ],
      }),
    );
    const added = mergeShare(ws, share).series[0];
    expect(added?.characterIds).toEqual(["hero"]);
    expect(added?.environmentIds).toEqual(["place"]);
  });

  it("adds only global notes whose id and text are both new", () => {
    const note = (id: string, text: string) => ({ id, text, area: "script" as const, at });
    const ws = workspace({ notes: [note("1", "Nói chậm")] });
    const share = shareOf(
      workspace({ notes: [note("1", "Khác"), note("2", "Nói chậm"), note("3", "Mới")] }),
    );
    expect(mergeShare(ws, share).notes.map((n) => n.id)).toEqual(["1", "3"]);
  });
});
