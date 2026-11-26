import { describe, expect, it } from "vitest";
import {
  anchoredDirection,
  type DirectionEntry,
  directionAt,
  directionSlot,
  MAX_DIRECTIONS,
  setDirection,
} from "./direction";
import { AUTO_MODELS } from "./models";
import { readShotList, rulesShotList } from "./shot-list";
import { answer, CTX, LINES } from "./shot-list.fixture";
import { BRIEF_MAX, cleanBrief, rulesPlan } from "./shot-plan";
import { applyPlan, newJob } from "./video-job";

const T = "2026-11-16T10:00:00.000Z";

describe("briefs", () => {
  it("reads the director's brief, one line and capped", () => {
    const a = answer();
    (a.shots?.[0] as { brief?: string }).brief = "  Cô gái ôm bụng,\n nhăn mặt nhìn sang ông lão  ";
    (a.shots?.[1] as { brief?: string }).brief = "chữ ".repeat(200);
    const { list, errors } = readShotList(a, CTX, { motion: false });
    expect(errors).toEqual([]);
    expect(list.shots.shots[0]?.brief).toBe("Cô gái ôm bụng, nhăn mặt nhìn sang ông lão");
    const long = list.shots.shots[1]?.brief ?? "";
    expect(long.length).toBeGreaterThan(200);
    expect(long.length).toBeLessThanOrEqual(BRIEF_MAX + 1);
    expect(cleanBrief(null)).toBe("");
  });

  it("invents none: a missing brief stays missing, never a rule error", () => {
    const { list, errors } = readShotList(answer(), CTX, { motion: false });
    expect(errors).toEqual([]);
    expect(list.shots.shots.every((s) => s.brief === undefined)).toBe(true);
    expect(rulesPlan(CTX).shots.every((s) => s.brief === undefined)).toBe(true);
  });

  it("keeps a brief on the job's shots", () => {
    const plan = rulesPlan(CTX);
    plan.shots[2] = { ...(plan.shots[2] as (typeof plan.shots)[number]), brief: "An mỉm cười" };
    const list = rulesShotList(CTX, plan);
    const job = newJob({
      sessionId: "s",
      seriesId: "r",
      scriptId: "x",
      title: "t",
      lines: LINES,
      useEnvironment: true,
      models: AUTO_MODELS,
      now: T,
    });
    expect(applyPlan(job, list.shots).shots[2]?.brief).toBe("An mỉm cười");
  });
});

describe("direction", () => {
  it("keeps one wish per shot's words; an empty one removes it", () => {
    let list = setDirection(undefined, { words: "Chào  ông", want: "Cười tươi" }, T);
    list = setDirection(list, { words: "chào ông", want: "Nhìn ra vườn" }, T);
    expect(list).toEqual([{ words: "chào ông", want: "Nhìn ra vườn", at: T }]);
    expect(directionAt(list, "Chào ông")?.want).toBe("Nhìn ra vườn");
    expect(setDirection(list, { words: "Chào ông", want: " " }, T)).toEqual([]);
  });

  it("adds whole-video wishes, once each; `at` replaces or removes one", () => {
    let list = setDirection([], { want: "Sáng hơn" }, "1");
    list = setDirection(list, { want: "Nhiều toàn cảnh" }, "2");
    list = setDirection(list, { want: "sáng hơn" }, "3");
    expect(list.map((d) => d.want)).toEqual(["Nhiều toàn cảnh", "sáng hơn"]);
    expect(setDirection(list, { want: "", at: "2" }, "4").map((d) => d.want)).toEqual(["sáng hơn"]);
  });

  it("keeps the newest when there are too many", () => {
    let list: DirectionEntry[] = [];
    for (let i = 0; i < MAX_DIRECTIONS + 3; i++)
      list = setDirection(list, { want: `w${i}` }, `${i}`);
    expect(list).toHaveLength(MAX_DIRECTIONS);
    expect(list[0]?.want).toBe("w3");
  });

  it("fills the prompt's slot", () => {
    expect(directionSlot([])).toBe("none");
    expect(
      directionSlot([
        { words: "Chào ông", want: "Cười tươi", at: T },
        { want: "Ấm hơn", at: T },
      ]),
    ).toBe('- At the words "Chào ông": Cười tươi\n- For the whole video: Ấm hơn');
  });

  it("keeps the wishes whose words are still said", () => {
    const list: DirectionEntry[] = [
      { words: "hôm nay trời đẹp", want: "a", at: T },
      { words: "trời mưa", want: "b", at: T },
      { want: "c", at: T },
    ];
    expect(anchoredDirection(list, LINES).map((d) => d.want)).toEqual(["a", "c"]);
  });
});
