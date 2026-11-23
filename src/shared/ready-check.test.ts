import { describe, expect, it } from "vitest";
import { estimateSeconds, estimateVoiceUsd } from "./board";
import type { Asset, Script, Session } from "./ipc";
import {
  assertCommitted,
  committedIds,
  isFirstBatch,
  NOT_COMMITTED,
  needsAttention,
  readyCheck,
} from "./ready-check";

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

describe("all-in estimate", () => {
  const lines = [{ text: "a".repeat(1000) }];

  it("prices voice at about $0.08 per 1,000 characters", () => {
    expect(estimateVoiceUsd(lines)).toBeCloseTo(0.08);
    expect(estimateVoiceUsd([])).toBe(0);
  });
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
    const check = readyCheck(scripts, ["1", "2", "3"], [a, b, noPhoto]);
    expect(check.blocked.map((c) => c.script.id)).toEqual(["1", "2"]);
    expect(check.blocked[0]?.blockers).toEqual([{ kind: "unknown-speaker", speaker: "Bà Tư" }]);
    expect(check.blocked[1]?.blockers).toEqual([{ kind: "no-image", characterId: "c" }]);
    expect(check.toMake.map((c) => c.script.id)).toEqual(["3"]);
  });

  it("treats a deleted character as not in the library", () => {
    const check = readyCheck([script("1", [line("gone")])], ["1"], [a]);
    expect(check.blocked).toHaveLength(1);
  });

  it("keeps scope and board order, skipping unfinished scripts", () => {
    const scripts = [
      script("1", [line("a")]),
      script("2", [line("a")], { status: "failed" }),
      script("3", [line("a")], { pinned: true }),
    ];
    const check = readyCheck(scripts, ["1", "2", "3"], [a]);
    expect(check.checks.map((c) => c.script.id)).toEqual(["3", "1"]);
    expect(readyCheck(scripts, ["1"], [a]).checks).toHaveLength(1);
  });

  it("warns past the script's own target, never a fixed length", () => {
    const long = Array.from({ length: 20 }, () => line("a", "một hai ba bốn năm sáu bảy tám"));
    const seconds = estimateSeconds(long);
    const check = readyCheck(
      [
        script("short-target", long, { brief: { kind: "topic", targetSec: seconds / 1.3 } }),
        script("long-target", long, { brief: { kind: "topic", targetSec: seconds } }),
        script("no-target", long, { brief: { kind: "topic" } }),
      ],
      ["short-target", "long-target", "no-target"],
      [a],
    );
    expect(check.checks.map((c) => c.overTarget)).toEqual([true, false, false]);
  });

  it("lists speaking characters once and flags a shared voice", () => {
    const same = [character("a", { voiceId: "mai" }), character("b", { voiceId: "mai" })];
    const check = readyCheck(
      [script("1", [line("a"), line("b")]), script("2", [line("b")])],
      ["1", "2"],
      same,
    );
    expect(check.cast.map((m) => [m.character.id, m.voiceId, m.sharesVoice])).toEqual([
      ["a", "mai", true],
      ["b", "mai", true],
    ]);
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

  it("is the first batch until another session of the series is approved", () => {
    const current = session("s", "x");
    expect(isFirstBatch(current, [current, session("o", "y", "t")])).toBe(true);
    expect(isFirstBatch(current, [current, session("o", "x")])).toBe(true);
    expect(isFirstBatch(current, [current, session("o", "x", "t")])).toBe(false);
  });
});

describe("needsAttention", () => {
  const cast = [character("a", { voiceId: "mai" }), character("b", { voiceId: "tuan-anh" })];
  const fine = script("1", [line("a"), line("b")], { brief: { kind: "topic" } });

  it("starts without a dialog when nothing needs fixing", () => {
    expect(needsAttention(readyCheck([fine], ["1"], cast))).toBe(false);
  });

  it("asks first for a blocked video or a warning", () => {
    const unknown = script("2", [line(null)]);
    expect(needsAttention(readyCheck([fine, unknown], ["1", "2"], cast))).toBe(true);
    const same = [character("a", { voiceId: "mai" }), character("b", { voiceId: "mai" })];
    expect(needsAttention(readyCheck([fine], ["1"], same))).toBe(true);
    const long = script("3", fine.lines, { brief: { kind: "topic", targetSec: 1 } });
    expect(needsAttention(readyCheck([long], ["3"], cast))).toBe(true);
  });

  it("warns, without blocking, about a series place whose photo shows people or packaging", () => {
    const checkedAt = "2026-11-13T00:00:00.000Z";
    const place = (id: string, people: boolean): Asset => ({
      ...character(id),
      kind: "environment",
      images: [{ id: "p", file: "p.png", placeCheck: { people, packaging: null, checkedAt } }],
    });
    const assets = [...cast, place("yard", true), place("hall", false)];
    const flagged = readyCheck([fine], ["1"], assets, { placeIds: ["yard", "hall"] });
    expect(flagged.places.map((p) => p.id)).toEqual(["yard"]);
    expect(flagged.toMake).toHaveLength(1);
    expect(needsAttention(flagged)).toBe(true);
    const other = readyCheck([fine], ["1"], assets, { placeIds: ["hall"] });
    expect(other.places).toEqual([]);
    expect(needsAttention(other)).toBe(false);
  });
});
