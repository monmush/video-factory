import { describe, expect, it } from "vitest";
import { streamReader } from "./claude-stream";

const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const delta = (text: string) =>
  line({ type: "stream_event", event: { delta: { type: "text_delta", text } } });

describe("streamReader", () => {
  it("adds up text split across chunks and keeps the result and latest limits", () => {
    const seen: string[] = [];
    const reader = streamReader((t) => seen.push(t));
    const all = [
      delta("Xin "),
      delta("chào"),
      line({ type: "rate_limit_event", rate_limit_info: { n: 1 } }),
      line({ type: "rate_limit_event", rate_limit_info: { n: 2 } }),
      line({ type: "result", result: "Xin chào" }),
    ].join("");
    for (let i = 0; i < all.length; i += 7) reader.push(all.slice(i, i + 7));
    const { result, limits } = reader.end();
    expect(seen.at(-1)).toBe("Xin chào");
    expect(result?.result).toBe("Xin chào");
    expect(limits?.rate_limit_info).toEqual({ n: 2 });
  });

  it("reads a final line without a newline", () => {
    const reader = streamReader();
    reader.push(JSON.stringify({ type: "result", result: "ok" }));
    expect(reader.end().result?.result).toBe("ok");
  });

  it("refuses a line that grows past the limit", () => {
    const reader = streamReader(undefined, 10);
    expect(reader.push("12345")).toBe(true);
    expect(reader.push("678901")).toBe(false);
  });
});
