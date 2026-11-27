import { describe, expect, it } from "vitest";
import { type CrewMember, staffCrew } from "./agent-crew";

const rules = { seats: 3, dwellMs: 2000 };
const targetsOf = (crew: CrewMember[]) => crew.map((m) => m.target);

describe("cursors follow the work that is really running", () => {
  it("one cursor per running item, and none when nothing runs", () => {
    const crew = staffCrew([], ["a", "b"], 0, rules);
    expect(targetsOf(crew)).toEqual(["a", "b"]);
    expect(staffCrew(crew, [], 100, rules)).toEqual([]);
  });

  it("a cursor stays on its item while others finish around it", () => {
    const crew = staffCrew([], ["a", "b", "c"], 0, rules);
    const later = staffCrew(crew, ["c"], 500, rules);
    expect(later).toEqual([{ seat: 2, target: "c", since: 0 }]);
  });

  it("a cursor whose item finished moves to one nobody is on", () => {
    const crew = staffCrew([], ["a", "b", "c", "d"], 0, rules);
    const later = staffCrew(crew, ["b", "c", "d"], 500, rules);
    expect(later).toContainEqual({ seat: 0, target: "d", since: 500 });
    expect(new Set(targetsOf(later)).size).toBe(3);
  });

  it("with more items than cursors, cursors rotate so every item is visited", () => {
    const items = ["a", "b", "c", "d", "e"];
    let crew = staffCrew([], items, 0, rules);
    const visited = new Set(targetsOf(crew));
    for (let now = 2000; now <= 8000; now += 2000) {
      crew = staffCrew(crew, items, now, rules);
      expect(new Set(targetsOf(crew)).size).toBe(crew.length);
      for (const target of targetsOf(crew)) visited.add(target);
    }
    expect([...visited].sort()).toEqual(items);
  });

  it("cursors do not swap places when every item already has one", () => {
    const crew = staffCrew([], ["a", "b"], 0, rules);
    expect(staffCrew(crew, ["a", "b"], 9000, rules)).toEqual(crew);
  });
});
