import { describe, expect, it } from "vitest";
import { restagePlan } from "../../shared/restage";
import { readShotList, type ShotListAnswer } from "../../shared/shot-list";
import { answer, CTX } from "../../shared/shot-list.fixture";
import { DIRECTOR_CALLS, type PartialStaging, StagingStopped, stageShotList } from "./staging";

const PROMPT = "Direct this script.";

const missingPicture = (): ShotListAnswer => {
  const a = answer();
  a.pictures = a.pictures?.filter((p) => p.id !== "ba-ots");
  return a;
};
const BA_OTS = answer().pictures?.find((p) => p.id === "ba-ots");
const CORRECTION = JSON.stringify({ pictures: [BA_OTS] });
const brokenSpeaker = (): ShotListAnswer => {
  const a = answer();
  (a.shots?.[0] as { route: string }).route = "still-move";
  return a;
};

function run(
  answers: (string | Error)[],
  extra: { partial?: PartialStaging; signal?: AbortSignal; read?: typeof CTX } = {},
) {
  const requests: string[] = [];
  const files = new Map<string, string>();
  const steps: string[][] = [];
  const result = stageShotList({
    prompt: PROMPT,
    ask: async (request, onText) => {
      requests.push(request);
      const next = answers[requests.length - 1];
      if (next === undefined) throw new Error("asked more often than planned");
      if (next instanceof Error) throw next;
      onText(next.slice(0, next.length / 2));
      return next;
    },
    parse: (text) => JSON.parse(text),
    read: (a) => readShotList(a, extra.read ?? CTX, { motion: false }),
    save: async (name, text) => files.set(name, text),
    onSteps: (s) => steps.push(s),
    ...(extra.partial ? { partial: extra.partial } : {}),
    ...(extra.signal ? { signal: extra.signal } : {}),
  });
  return { result, requests, files, steps };
}

const problemsIn = (files: Map<string, string>, n: number) =>
  JSON.parse(files.get(`shot-list-problems-${n}.json`) ?? "null");

describe("stageShotList", () => {
  it("takes a first plan that keeps every rule with one call and no problems file", async () => {
    const { result, requests, files, steps } = run([JSON.stringify(answer())]);
    expect("list" in (await result)).toBe(true);
    expect(requests).toEqual([PROMPT]);
    expect([...files.keys()]).toEqual(["shot-list-answer-1.json"]);
    expect(steps.at(-1)?.slice(-2)).toEqual(["Kiểm tra quy tắc", "Tính giá"]);
  });

  it("repairs a leftover picture without asking again and records the repair", async () => {
    const spare = { ...BA_OTS, id: "spare" };
    const a = answer();
    a.pictures?.push(spare as NonNullable<typeof BA_OTS>);
    const { result, requests, files } = run([JSON.stringify(a)]);
    const staged = await result;
    expect(requests).toHaveLength(1);
    expect("list" in staged && staged.list.pictures.map((p) => p.id)).not.toContain("spare");
    expect(problemsIn(files, 1)).toMatchObject({
      call: "plan",
      errors: [],
      repaired: [expect.stringMatching(/spare/)],
    });
  });

  it("asks only for the broken entries and merges them into the first plan", async () => {
    const { result, requests, files, steps } = run([JSON.stringify(missingPicture()), CORRECTION]);
    const staged = await result;
    expect("list" in staged && staged.list.pictures.map((p) => p.id)).toEqual([
      "master",
      "an",
      "plate",
      "ba-ots",
    ]);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatch(/Shot 3: picture "ba-ots" does not exist/);
    expect(requests[1]).toMatch(/Answer with a correction only/);
    expect(problemsIn(files, 1).errors).toEqual(['Shot 3: picture "ba-ots" does not exist.']);
    expect(files.has("shot-list-correction-2.json")).toBe(true);
    expect(files.has("shot-list-merged-2.json")).toBe(true);
    const during = steps.find((s) => s.includes("Sửa 1 chỗ chưa đúng quy tắc"));
    expect(during?.slice(0, 2)).toEqual([
      "Đọc kịch bản, bối cảnh và nhân vật",
      "Xếp chỗ ngồi và hướng nhìn",
    ]);
    expect(steps.at(-1)?.slice(-3)).toEqual(["Khung hình: Ba", "Kiểm tra quy tắc", "Tính giá"]);
  });

  it("falls back to one full rewrite of the first plan when the correction is unusable", async () => {
    const first = JSON.stringify(missingPicture());
    const unknownId = JSON.stringify({ remove_pictures: ["nope"] });
    const { result, requests, files } = run([first, unknownId, JSON.stringify(answer())]);
    expect("list" in (await result)).toBe(true);
    expect(requests).toHaveLength(3);
    expect(requests[2]).toContain(`## Your previous plan\n\n${first}`);
    expect(requests[2]).toMatch(/Answer again with a corrected plan/);
    expect(problemsIn(files, 2)).toMatchObject({
      call: "correction",
      unusable: expect.stringMatching(/remove_pictures/),
    });
    expect(files.has("shot-list-answer-3.json")).toBe(true);
  });

  it("rewrites in full when the merged plan still breaks a rule", async () => {
    const stillBroken = JSON.stringify({ pictures: [{ ...BA_OTS, character: "Cô" }] });
    const { result, requests, files } = run([
      JSON.stringify(missingPicture()),
      stillBroken,
      JSON.stringify(answer()),
    ]);
    expect("list" in (await result)).toBe(true);
    expect(requests).toHaveLength(3);
    expect(problemsIn(files, 2).errors.join(" ")).toMatch(/"Cô" is not in the cast/);
    expect(requests[2]).toMatch(/Shot 3: picture "ba-ots" does not exist/);
  });

  it("gives the rules fallback the last problems after every call failed, within the call limit", async () => {
    const { result, requests, files } = run([
      JSON.stringify(brokenSpeaker()),
      "not json",
      JSON.stringify(brokenSpeaker()),
    ]);
    const staged = await result;
    expect(requests).toHaveLength(DIRECTOR_CALLS.length);
    expect("problems" in staged && staged.problems.join(" ")).toMatch(
      /speaker shot uses the speak route/,
    );
    expect(problemsIn(files, 2)).toMatchObject({ call: "correction", failed: expect.any(String) });
  });

  it("skips the correction when the first call gives no plan", async () => {
    const { result, requests, files } = run([
      new Error("Claude Code không phản hồi kịp"),
      JSON.stringify(answer()),
    ]);
    expect("list" in (await result)).toBe(true);
    expect(requests).toEqual([PROMPT, PROMPT]);
    expect(problemsIn(files, 1)).toMatchObject({
      call: "plan",
      failed: "Claude Code không phản hồi kịp",
    });
  });
});

describe("stageShotList after a small script edit", () => {
  const NEW_LINE = "Ừ cháu ngồi xuống đây, uống chén trà nóng đã cháu.";
  const after = CTX.lines.map((l, i) => (i === 1 ? { ...l, text: NEW_LINE } : l));
  const ctx = { ...CTX, lines: after };
  const partialFor = (lines = after): PartialStaging => {
    const list = readShotList(answer(), CTX, { motion: false }).list;
    const r = restagePlan({ lines: CTX.lines, list }, lines, { ...CTX, lines }, { motion: false });
    if (r.kind !== "partial") throw new Error(r.why);
    return r;
  };
  const shot2 = {
    n: 2,
    type: "speaker",
    character: "Ba",
    framing: "medium_close",
    line: 2,
    text: NEW_LINE,
    visual: "Ba gestures to the cup.",
    why: "C7",
    picture: "ba-ots",
    route: "speak",
    motion: null,
  };
  const ANSWER = JSON.stringify({ shots: [shot2], remove_shots: [3] });
  const fullPlan = () => {
    const a = answer();
    a.shots?.splice(1, 2, shot2);
    a.shots?.forEach((s, i) => {
      s.n = i + 1;
    });
    return JSON.stringify(a);
  };
  const restage = (files: Map<string, string>) =>
    JSON.parse(files.get("shot-list-restage.json") ?? "null");

  it("makes one call for the changed line and merges it into the plan", async () => {
    const { result, requests, files } = run([ANSWER], { partial: partialFor(), read: ctx });
    const staged = await result;
    expect("list" in staged && staged.list.shots.shots.map((s) => s.text)).toEqual([
      "Chào ông, hôm nay trời đẹp quá ạ.",
      NEW_LINE,
      "Dạ cháu cảm ơn,",
      "ông pha trà ngon lắm ạ.",
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatch(/Its shots in your plan: 2, 3; write them again/);
    expect(files.has("shot-list-partial-request-1.md")).toBe(true);
    expect(files.has("shot-list-partial-1.json")).toBe(true);
    expect(files.has("shot-list-merged-1.json")).toBe(true);
    expect(restage(files)).toMatchObject({ path: "partial", lines: [2] });
  });

  it("makes no call when code alone fits the plan to the new wording", async () => {
    const lines = CTX.lines.map((l, i) =>
      i === 1 ? { ...l, text: "Ừ, cháu ngồi đây, uống chén trà đã cháu!" } : l,
    );
    const { result, requests, files } = run([], {
      partial: partialFor(lines),
      read: { ...CTX, lines },
    });
    expect("list" in (await result)).toBe(true);
    expect(requests).toEqual([]);
    expect(restage(files)).toMatchObject({ path: "carried", lines: [] });
  });

  it("stages in full when the partial answer changes a shot it was told to keep", async () => {
    const keepsNothing = JSON.stringify({
      shots: [shot2, { ...answer().shots?.[0], n: 1, visual: "An frowns." }],
      remove_shots: [3],
    });
    const { result, requests, files } = run([keepsNothing, fullPlan()], {
      partial: partialFor(),
      read: ctx,
    });
    expect("list" in (await result)).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toBe(PROMPT);
    expect(problemsIn(files, 1)).toMatchObject({
      call: "partial",
      unusable: expect.stringMatching(/Only the shots/),
    });
    expect(restage(files)).toMatchObject({ path: "plan" });
  });

  it("stages in full when the merged plan still breaks a rule, within four calls", async () => {
    const oldWords = JSON.stringify({ shots: [{ ...shot2, text: "Ừ cháu ngồi đây," }] });
    const { result, requests, files } = run(
      [oldWords, JSON.stringify(brokenSpeaker()), "not json", JSON.stringify(brokenSpeaker())],
      {
        partial: partialFor(),
        read: ctx,
      },
    );
    const staged = await result;
    expect("problems" in staged).toBe(true);
    expect(requests).toHaveLength(1 + DIRECTOR_CALLS.length);
    expect(problemsIn(files, 1).errors.join(" ")).toMatch(/reproduce the line exactly/);
    expect(restage(files)).toMatchObject({ path: "rules" });
  });

  it("stops without a further call when the script changes during the call", async () => {
    const stop = new AbortController();
    const { result, requests, files } = run([new Error("Đã dừng")], {
      partial: partialFor(),
      read: ctx,
      signal: stop.signal,
    });
    stop.abort();
    await expect(result).rejects.toBeInstanceOf(StagingStopped);
    expect(requests).toHaveLength(1);
    expect(problemsIn(files, 1)).toMatchObject({ call: "partial", stopped: true });
  });
});
