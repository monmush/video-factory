import { describe, expect, it } from "vitest";
import { characterPeopleProblem } from "./still-people";

describe("characterPeopleProblem", () => {
  it("accepts the number of people a planned picture lists", () => {
    expect(characterPeopleProblem({ people: 2, framing: "Medium shot" }, 2)).toBeNull();
    expect(characterPeopleProblem({ people: 2, framing: "Medium shot" }, 3)).toBe(
      "3 people, should be 2",
    );
    expect(characterPeopleProblem({ people: 1 }, 2)).toBe("2 people, should be 1");
    expect(characterPeopleProblem({ people: 2 }, 0)).toBe("0 people, should be 2");
  });

  it("lets a person at the edge of the frame go uncounted", () => {
    expect(characterPeopleProblem({ people: 2, framing: "Medium shot" }, 1)).toBeNull();
  });

  it("keeps one person, or over the shoulder, when the count is unknown", () => {
    expect(characterPeopleProblem({ framing: "Medium close-up" }, 1)).toBeNull();
    expect(characterPeopleProblem({ framing: "Medium close-up" }, 2)).toBe("2 people");
    expect(characterPeopleProblem({ framing: "Over the shoulder of Bà" }, 2)).toBeNull();
    expect(characterPeopleProblem({}, undefined)).toBeNull();
  });
});
