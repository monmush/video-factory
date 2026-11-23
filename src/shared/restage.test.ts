import { describe, expect, it } from "vitest";
import type { ScriptLine } from "./ipc";
import { classifyScriptEdit, restagePlan, untouchedChanged } from "./restage";
import { readShotList, type ShotListAnswer, shotListAnswer } from "./shot-list";
import { answer, CTX, LINES } from "./shot-list.fixture";
import { applyCorrection } from "./shot-list-correction";
import { stagingHeld, stagingOutdated } from "./staging-hold";

const CAPS = { motion: false };
const an = (text: string): ScriptLine => ({ characterId: "a", speaker: "An", text });
const withLine = (i: number, text: string) => LINES.map((l, j) => (j === i ? { ...l, text } : l));

const planned = () => {
  const a = answer();
  const last = a.shots?.[4] as { brief?: string };
  last.brief = "An cười, tay đặt lên chén trà";
  return readShotList(a, CTX, CAPS).list;
};
const basis = () => ({ lines: LINES, list: planned() });

function restaged(after: ScriptLine[]) {
  const r = restagePlan(basis(), after, { ...CTX, lines: after }, CAPS);
  if (r.kind !== "partial") throw new Error(`full: ${r.why}`);
  return r;
}

describe("classifyScriptEdit", () => {
  it("keeps the plan when only whitespace changed", () => {
    const after = withLine(1, "  Ừ cháu ngồi   đây, uống chén trà đã cháu. ");
    expect(classifyScriptEdit(LINES, after)).toEqual({ kind: "same" });
  });

  it("restages one line changed in place, speaker and position unchanged", () => {
    const after = withLine(1, "Ừ cháu ngồi xuống đây, uống chén trà nóng đã cháu.");
    expect(classifyScriptEdit(LINES, after)).toEqual({
      kind: "partial",
      moved: [0, 1, 2],
      changed: [1],
    });
  });

  it("treats a punctuation-only change as a change of that line", () => {
    const after = withLine(1, "Ừ, cháu ngồi đây, uống chén trà đã cháu!");
    expect(classifyScriptEdit(LINES, after)).toMatchObject({ kind: "partial", changed: [1] });
  });

  it("shifts the lines after one added line and asks only for the new line", () => {
    const after = [LINES[0], an("Cháu mới đi làm về, mệt quá ông ạ."), ...LINES.slice(1)];
    expect(classifyScriptEdit(LINES, after as ScriptLine[])).toEqual({
      kind: "partial",
      moved: [0, 2, 3],
      changed: [1],
    });
  });

  it("drops one removed line without asking for any line", () => {
    const before = [LINES[0], an("Cháu mới đi làm về, mệt quá ông ạ."), ...LINES.slice(1)];
    expect(classifyScriptEdit(before as ScriptLine[], LINES)).toEqual({
      kind: "partial",
      moved: [0, null, 1, 2],
      changed: [],
    });
  });

  it("stages in full when a line moves to another speaker or lines are reordered", () => {
    const given = LINES.map((l, i) => (i === 1 ? { ...l, characterId: "a", speaker: "An" } : l));
    expect(classifyScriptEdit(LINES, given)).toMatchObject({ kind: "full", why: "speaker" });
    const swapped = [LINES[1], LINES[0], LINES[2]] as ScriptLine[];
    expect(classifyScriptEdit(LINES, swapped)).toMatchObject({ kind: "full" });
  });

  it("stages in full when more than a small share of the script changed", () => {
    const after = withLine(0, "Chào ông ạ, sáng nay trời đẹp quá.").map((l, i) =>
      i === 2 ? { ...l, text: "Dạ cháu cảm ơn ông nhiều lắm ạ." } : l,
    );
    expect(classifyScriptEdit(LINES, after)).toMatchObject({ kind: "full", why: "too-many" });
  });

  it("stages in full when the last line is added or removed, or the cast changes", () => {
    const longer = [...LINES, an("Mai cháu lại sang ông nhé.")];
    expect(classifyScriptEdit(LINES, longer)).toMatchObject({ kind: "full", why: "last-line" });
    expect(classifyScriptEdit(longer, LINES)).toMatchObject({ kind: "full", why: "last-line" });
    const withBa = [...LINES, an("Mai cháu lại sang ông nhé.")];
    const withoutBa = [LINES[0], LINES[2], an("Mai cháu lại sang ông nhé.")] as ScriptLine[];
    expect(classifyScriptEdit(withBa, withoutBa)).toMatchObject({ kind: "full", why: "cast" });
  });
});

describe("restagePlan", () => {
  it("writes the existing plan back as an answer that reads to the same shot list", () => {
    const list = planned();
    const back = shotListAnswer(list, CTX) as ShotListAnswer;
    expect(readShotList(back, CTX, CAPS)).toEqual({ list, errors: [], repaired: [] });
  });

  it("asks only for the changed line's shots and names them by number", () => {
    const r = restaged(withLine(1, "Ừ cháu ngồi xuống đây, uống chén trà nóng đã cháu."));
    expect(r.open).toEqual([1]);
    expect(r.changes).toMatch(/Line 2 \(Ba\) now reads: .*Its shots in your plan: 2, 3;/);
    expect(r.previous).toEqual(shotListAnswer(planned(), CTX));
  });

  it("re-cuts a punctuation-only change in code, with nothing left to ask", () => {
    const after = withLine(1, "Ừ, cháu ngồi đây, uống chén trà đã cháu!");
    const r = restaged(after);
    expect(r.open).toEqual([]);
    expect(r.previous.shots?.slice(1, 3).map((s) => s.text)).toEqual([
      "Ừ, cháu ngồi đây,",
      "uống chén trà đã cháu!",
    ]);
    expect(readShotList(r.previous, { ...CTX, lines: after }, CAPS).errors).toEqual([]);
  });

  it("asks for the line when a punctuation change removes the mark a shot was cut at", () => {
    expect(restaged(withLine(1, "Ừ cháu ngồi đây uống chén trà đã cháu.")).open).toEqual([1]);
  });

  it("renumbers the lines after an added line and asks where its shots go", () => {
    const after = [LINES[0], an("Cháu mới đi làm về, mệt quá ông ạ."), ...LINES.slice(1)];
    const r = restaged(after as ScriptLine[]);
    expect(r.previous.shots?.map((s) => s.line)).toEqual([1, 3, 3, 4, 4]);
    expect(r.changes).toMatch(/Line 2 \(An\) is new: .*after shot 1\./);
  });

  it("drops a removed line's shots and keeps the plan valid with no call", () => {
    const before = [LINES[0], an("Cháu mới đi làm về, mệt quá ông ạ."), ...LINES.slice(1)];
    const a = answer();
    a.shots?.splice(1, 0, {
      ...(a.shots?.[0] as object),
      line: 2,
      text: "Cháu mới đi làm về, mệt quá ông ạ.",
      framing: "close",
    });
    a.shots?.forEach((s, i) => {
      s.n = i + 1;
      if (i > 1) s.line = Number(s.line) + 1;
    });
    const longer = { ...CTX, lines: before as ScriptLine[] };
    const read = readShotList(a, longer, CAPS);
    expect(read.errors).toEqual([]);
    const r = restagePlan({ lines: longer.lines, list: read.list }, LINES, CTX, CAPS);
    if (r.kind !== "partial") throw new Error("full");
    expect(r.open).toEqual([]);
    const after = readShotList(r.previous, CTX, CAPS);
    expect(after.errors).toEqual([]);
    expect(after.list).toEqual(readShotList(answer(), CTX, CAPS).list);
  });
});

describe("merging a partial restage", () => {
  const after = withLine(1, "Ừ cháu ngồi xuống đây, uống chén trà nóng đã cháu.");
  const ctx = { ...CTX, lines: after };
  const newBa = {
    id: "ba-pour",
    kind: "character",
    character: "Ba",
    people: ["Ba"],
    framing: "medium close-up",
    description: "Ba pours tea, looking at An.",
  };
  const answerForLine2 = {
    pictures: [newBa],
    remove_pictures: ["ba-ots"],
    shots: [
      {
        n: 2,
        type: "speaker",
        character: "Ba",
        framing: "medium_close",
        line: 2,
        text: "Ừ cháu ngồi xuống đây, uống chén trà nóng đã cháu.",
        visual: "Ba pours.",
        why: "C7",
        brief: "Ông rót trà mời An",
        picture: "ba-pour",
        route: "speak",
        motion: null,
      },
    ],
    remove_shots: [3],
  };

  it("keeps untouched shots byte for byte, replaces the changed line's and renumbers", () => {
    const r = restaged(after);
    const merged = applyCorrection(r.previous, answerForLine2);
    if ("unusable" in merged) throw new Error(merged.unusable);
    expect(untouchedChanged(r.previous, merged.answer, r.open)).toBeNull();
    const read = readShotList(merged.answer, ctx, CAPS);
    expect(read.errors).toEqual([]);
    const before = planned();
    const shots = read.list.shots.shots;
    expect(shots).toHaveLength(4);
    expect([shots[0], shots[2], shots[3]]).toEqual([
      before.shots.shots[0],
      before.shots.shots[3],
      before.shots.shots[4],
    ]);
    expect(shots[3]?.brief).toBe("An cười, tay đặt lên chén trà");
    expect([read.list.routes[0], read.list.routes[2], read.list.routes[3]]).toEqual([
      before.routes[0],
      before.routes[3],
      before.routes[4],
    ]);
    expect(read.list.pictures.map((p) => p.id)).toEqual(["master", "an", "plate", "ba-pour"]);
    expect(merged.answer.shots?.map((s) => s.n)).toEqual([1, 2, 3, 4]);
  });

  it("refuses an answer that changes a shot of an untouched line or a picture it uses", () => {
    const r = restaged(after);
    const touchedShot = applyCorrection(r.previous, {
      ...answerForLine2,
      shots: [...answerForLine2.shots, { ...(r.previous.shots?.[0] as object), n: 1, visual: "x" }],
    });
    if ("unusable" in touchedShot) throw new Error(touchedShot.unusable);
    expect(untouchedChanged(r.previous, touchedShot.answer, r.open)).toMatch(/Only the shots/);
    const an = r.previous.pictures?.find((p) => p.id === "an");
    const touchedPicture = applyCorrection(r.previous, {
      ...answerForLine2,
      pictures: [newBa, { ...an, description: "An, now standing." }],
    });
    if ("unusable" in touchedPicture) throw new Error(touchedPicture.unusable);
    expect(untouchedChanged(r.previous, touchedPicture.answer, r.open)).toMatch(/Picture "an"/);
  });
});

describe("staging and the script it was made for", () => {
  it("drops a staging made for an older wording of the script", () => {
    expect(stagingOutdated({ lines: LINES }, { lines: LINES })).toBe(false);
    expect(stagingOutdated({ lines: LINES }, { lines: withLine(2, "Dạ cháu cảm ơn ông.") })).toBe(
      true,
    );
    expect(stagingOutdated({ lines: LINES }, { lines: LINES, deletedAt: "2026-11-20" })).toBe(true);
    expect(stagingOutdated({ lines: LINES }, undefined)).toBe(true);
  });

  it("holds staging only for scripts a running turn touched, and never for ever", () => {
    const touched = new Set<string>();
    const holds = [{ scripts: touched, since: 0 }];
    expect(stagingHeld(holds, "s1", 1000)).toBe(false);
    touched.add("s1");
    expect(stagingHeld(holds, "s1", 1000)).toBe(true);
    expect(stagingHeld(holds, "s2", 1000)).toBe(false);
    expect(stagingHeld(holds, "s1", 60 * 60 * 1000)).toBe(false);
    expect(stagingHeld([], "s1", 1000)).toBe(false);
  });
});
