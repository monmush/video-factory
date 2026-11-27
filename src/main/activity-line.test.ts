import { describe, expect, it } from "vitest";
import { activityLine } from "./activity-line";

const key = "fal-sk-0123456789abcdef";
const time = new Date("2026-11-27T08:30:00.000Z");
const parsed = (line: string) => JSON.parse(line) as Record<string, unknown>;

describe("activityLine", () => {
  it("hides a key before cutting, so no part of it survives at the cut", () => {
    const message = `${"x".repeat(490)}${key}`;
    const line = parsed(activityLine(time, "run", { name: "renderer-error", message }, [key]));
    expect(line.message).toBe(`${"x".repeat(490)}[key]`);
    expect(JSON.stringify(line)).not.toContain(key.slice(0, 8));
  });

  it("cuts long text and hides keys inside nested fields", () => {
    const line = parsed(
      activityLine(
        time,
        "run",
        { name: "chat-message", sessionId: "s", text: "a".repeat(3000), attachments: 0 },
        [key],
      ),
    );
    expect((line.text as string).length).toBe(2000);
    const screen = parsed(
      activityLine(time, "run", { name: "screen", route: "/", params: { id: key } }, [key]),
    );
    expect(screen.params).toEqual({ id: "[key]" });
  });
});
