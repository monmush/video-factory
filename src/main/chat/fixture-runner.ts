import { randomUUID } from "node:crypto";
import type { ChatModelChoice } from "../../shared/ipc";
import * as board from "../board";
import * as writer from "../script-writer";
import type { Runner, TurnInput, TurnResult } from "./runner";
import { runTool } from "./tools";

// Sample turns for fixture mode: no AI and no cost, so the chat's streaming,
// tool rows, stop, undo and choices can be worked on freely. Decisions come
// from the fixture router; changes go through the same board tools as Claude.

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createFixtureRunner(choice: ChatModelChoice): Runner {
  let stopping = false;

  async function stream(turn: TurnInput, text: string) {
    for (const word of text.split(/(?<= )/)) {
      if (stopping) return;
      turn.events.textDelta(word);
      await pause(35);
    }
    turn.events.textEnd();
  }

  async function call(turn: TurnInput, name: string, args: unknown) {
    const id = `fixture-${randomUUID()}`;
    turn.events.toolStart(id, name);
    turn.events.toolInput(id, JSON.stringify(args));
    await pause(400);
    const result = await runTool(name, args, turn.host);
    turn.events.toolEnd(id, result.isError);
    return result;
  }

  return {
    choice,
    async run(turn): Promise<TurnResult> {
      stopping = false;
      const { sessionId } = turn.host;
      const ordered = await board.orderedScripts(sessionId);
      if (/gợi ý|lựa chọn|hướng nào/i.test(turn.text)) {
        await call(turn, "offer_choices", {
          question: "Bạn muốn sửa theo hướng nào?",
          options: ["Hài hước hơn", "Sâu lắng hơn", "Ngắn hơn, 30 giây"],
        });
        return { outcome: stopping ? "stopped" : "done" };
      }
      await call(turn, "list_scripts", {});
      if (stopping) return { outcome: "stopped" };
      const ctx = await board.writerContext(sessionId);
      const route = writer.fixtureRoute(ctx, ordered, turn.text, turn.refs);
      if (route.action === "add") {
        await stream(turn, `Mình lập ${route.topics.length} đề tài khác nhau rồi viết lời thoại.`);
        const result = await call(turn, "add_scripts", {
          topics: route.topics,
          direction: route.direction,
          ...(route.targetSec ? { target_seconds: route.targetSec } : {}),
        });
        if (stopping) return { outcome: "stopped" };
        await stream(
          turn,
          result.isError
            ? `Chưa viết được: ${result.text}`
            : (result.text.split("\n")[0] ?? "").replace(/:$/, "."),
        );
      } else if (route.action === "edit") {
        const numbers = route.targets === "all" ? ordered.map((_, i) => i + 1) : route.targets;
        const result = await call(turn, "rewrite_scripts", {
          numbers,
          instruction: route.instruction,
          ...(route.targetSec ? { target_seconds: route.targetSec } : {}),
        });
        if (stopping) return { outcome: "stopped" };
        await stream(turn, result.text);
      } else {
        await stream(turn, route.text);
      }
      return { outcome: stopping ? "stopped" : "done" };
    },
    async stop() {
      stopping = true;
    },
    close() {},
  };
}
