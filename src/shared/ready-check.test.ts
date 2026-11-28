import { describe, expect, it } from "vitest";
import type { Asset, Script, Session } from "./ipc";
import {
  assertCommitted,
  committedIds,
  NOT_COMMITTED,
  needsAttention,
  readyCheck,
} from "./ready-check";

const SERIES = { seriesTargetSec: 45 };

const character = (id: string, fields: Partial<Asset> = {}): Asset => ({
  id,
  kind: "character",
  name: id,
  handle: id,
  description: "",
  images: [{ id: "i", file: "i.png" }],
  createdAt: "",
  updatedAt: "",
  ...fields,
});

const script = (id: string, lines: Script["lines"], fields: Partial<Script> = {}): Script => ({
  id,
  title: id,
  hook: "",
  lines,
  productIds: [],
  staging: "",
  status: "ready",
  brief: { kind: "topic", targetSec: 45 },
  mark: null,
  pinned: false,
  deletedAt: null,
  createdAt: "",
  updatedAt: "",
  ...fields,
});

const line = (characterId: string | null, text = "Trà ngon uống chậm thôi", speaker = "X") => ({
  characterId,
  speaker,
  text,
});

const session = (id: string, seriesId: string, approvedAt: string | null = null): Session => ({
  id,
  seriesId,
  name: id,
  approvedAt,
  createdAt: "",
  updatedAt: "",
});

describe("readyCheck", () => {
  const a = character("a");
  const b = character("b");

  it("blocks a card with an unknown speaker or a character without photos", () => {
    const noPhoto = character("c", { images: [] });
    const scripts = [
      script("1", [line("a"), line(null, "Chào", "Bà Tư")]),
      script("2", [line("c")]),
      script("3", [line("a"), line("b")]),
    ];
    const check = readyCheck(scripts, ["1", "2", "3"], [a, b, noPhoto], SERIES);
    expect(check.blocked.map((c) => c.script.id)).toEqual(["1", "2"]);
    expect(check.blocked[0]?.blockers).toEqual([{ kind: "unknown-speaker", speaker: "Bà Tư" }]);
    expect(check.blocked[1]?.blockers).toEqual([{ kind: "no-image", characterId: "c" }]);
    expect(check.toMake.map((c) => c.script.id)).toEqual(["3"]);
  });

  it("treats a deleted character as not in the library", () => {
    const check = readyCheck([script("1", [line("gone")])], ["1"], [a], SERIES);
    expect(check.blocked).toHaveLength(1);
  });

  it("keeps scope and board order, skipping unfinished scripts", () => {
    const scripts = [
      script("1", [line("a")]),
      script("2", [line("a")], { status: "failed" }),
      script("3", [line("a")], { pinned: true }),
    ];
    const check = readyCheck(scripts, ["1", "2", "3"], [a], SERIES);
    expect(check.checks.map((c) => c.script.id)).toEqual(["3", "1"]);
    expect(readyCheck(scripts, ["1"], [a], SERIES).checks).toHaveLength(1);
  });

  it("warns when a script runs long for its own target, else for the series target", () => {
    const long = Array.from({ length: 20 }, () => line("a", "một hai ba bốn năm sáu bảy tám"));
    const scripts = [
      script("short-target", long, { brief: { kind: "topic", targetSec: 30 } }),
      script("fitting-target", long, { brief: { kind: "topic", targetSec: 45 } }),
      script("no-target", long, { brief: { kind: "topic" } }),
    ];
    const ids = ["short-target", "fitting-target", "no-target"];
    const check = readyCheck(scripts, ids, [a], { seriesTargetSec: 45 });
    expect(check.checks.map((c) => c.overTarget)).toEqual([true, false, false]);
    const shortSeries = readyCheck(scripts, ids, [a], { seriesTargetSec: 30 });
    expect(shortSeries.checks.map((c) => c.overTarget)).toEqual([true, false, true]);
  });
});

describe("commits and the first batch", () => {
  it("treats an older approved session as having committed every finished script", () => {
    const scripts = [script("1", []), script("2", [], { status: "failed" })];
    expect(committedIds(session("s", "x", "t"), scripts)).toEqual(["1"]);
    expect(committedIds({ ...session("s", "x", "t"), committedScriptIds: [] }, scripts)).toEqual(
      [],
    );
    expect(committedIds(session("s", "x"), scripts)).toEqual([]);
  });

  it("does not count scripts added after an older approval as committed", () => {
    const scripts = [script("1", [], { createdAt: "a" }), script("2", [], { createdAt: "z" })];
    expect(committedIds(session("s", "x", "t"), scripts)).toEqual(["1"]);
  });

  it("refuses to spend on a script not committed", () => {
    const scripts = [script("1", []), script("2", [])];
    const approved = { ...session("s", "x", "t"), committedScriptIds: ["1"] };
    expect(() => assertCommitted(approved, scripts, "1")).not.toThrow();
    expect(() => assertCommitted(approved, scripts, "2")).toThrow(NOT_COMMITTED);
    expect(() => assertCommitted(session("s", "x"), scripts, "1")).toThrow(NOT_COMMITTED);
  });
});

describe("characters who speak with the same voice", () => {
  const speaking = script("1", [line("a"), line("b")]);

  it("warns when two speakers' voice texts differ only in case and spacing", () => {
    const cast = [
      character("a", { voice: "Giọng nam trẻ, miền Bắc,  sáng" }),
      character("b", { voice: " giọng Nam trẻ, miền bắc, sáng" }),
      character("c", { voice: "Giọng nam trẻ, miền Bắc, sáng" }),
    ];
    const check = readyCheck([speaking], ["1"], cast, SERIES);
    expect(check.sharedVoices.map((g) => g.map((c) => c.id))).toEqual([["a", "b"]]);
    expect(check.toMake).toHaveLength(1);
    expect(needsAttention(check)).toBe(true);
  });

  it("compares uploaded recordings by file rather than by voice text", () => {
    const text = "Giọng nam trẻ, miền Bắc, sáng";
    const upload = (n: string) => `upload-${n.repeat(64)}.mp3`;
    const different = [
      character("a", { voice: text, voiceSample: upload("1") }),
      character("b", { voice: text, voiceSample: upload("2") }),
    ];
    expect(readyCheck([speaking], ["1"], different, SERIES).sharedVoices).toEqual([]);
    const same = [
      character("a", { voice: text, voiceSample: upload("1") }),
      character("b", { voice: "Giọng nữ lớn tuổi", voiceSample: upload("1") }),
    ];
    const check = readyCheck([speaking], ["1"], same, SERIES);
    expect(check.sharedVoices.map((g) => g.map((c) => c.id))).toEqual([["a", "b"]]);
  });

  it("says nothing when the speakers' voices differ", () => {
    const cast = [
      character("a", { voice: "Giọng nam trẻ, miền Bắc, sáng" }),
      character("b", { voice: "Giọng nữ trẻ, miền Bắc, sáng" }),
    ];
    expect(readyCheck([speaking], ["1"], cast, SERIES).sharedVoices).toEqual([]);
  });
});

describe("needsAttention", () => {
  const cast = [
    character("a", { voice: "Giọng nữ trẻ, miền Bắc, tươi sáng" }),
    character("b", { voice: "Giọng nam lớn tuổi, miền Bắc, trầm ấm" }),
  ];
  const fine = script("1", [line("a"), line("b")], { brief: { kind: "topic" } });

  it("starts without a dialog when nothing needs fixing", () => {
    expect(needsAttention(readyCheck([fine], ["1"], cast, SERIES))).toBe(false);
  });

  it("asks first for a blocked video or a warning", () => {
    const unknown = script("2", [line(null)]);
    expect(needsAttention(readyCheck([fine, unknown], ["1", "2"], cast, SERIES))).toBe(true);
    const long = script("3", fine.lines, { brief: { kind: "topic", targetSec: 1 } });
    expect(needsAttention(readyCheck([long], ["3"], cast, SERIES))).toBe(true);
  });

  it("warns, without blocking, about a series place whose photo shows people or packaging", () => {
    const checkedAt = "2026-11-13T00:00:00.000Z";
    const place = (id: string, people: boolean): Asset => ({
      ...character(id),
      kind: "environment",
      images: [{ id: "p", file: "p.png", placeCheck: { people, packaging: null, checkedAt } }],
    });
    const assets = [...cast, place("yard", true), place("hall", false)];
    const flagged = readyCheck([fine], ["1"], assets, { placeIds: ["yard", "hall"], ...SERIES });
    expect(flagged.places.map((p) => p.id)).toEqual(["yard"]);
    expect(flagged.toMake).toHaveLength(1);
    expect(needsAttention(flagged)).toBe(true);
    const other = readyCheck([fine], ["1"], assets, { placeIds: ["hall"], ...SERIES });
    expect(other.places).toEqual([]);
    expect(needsAttention(other)).toBe(false);
  });
});
