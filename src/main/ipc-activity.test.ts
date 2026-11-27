import { describe, expect, it } from "vitest";
import { actionEvent } from "./ipc-activity";

describe("actionEvent", () => {
  it("keeps only the ids of the first argument, never keys or text", () => {
    const event = actionEvent(
      "chat:send",
      [{ sessionId: "s", text: "bí mật", refs: [], attachments: [], apiKey: "k" }],
      12,
      null,
    );
    expect(event).toEqual({
      name: "action",
      channel: "chat:send",
      ms: 12,
      ok: true,
      sessionId: "s",
    });
    expect(actionEvent("providers:set-key", ["fal", "fal-sk-secret"], 3, null)).toEqual({
      name: "action",
      channel: "providers:set-key",
      ms: 3,
      ok: true,
    });
  });
});
