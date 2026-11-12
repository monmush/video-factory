import type { ChatError, ChatModelChoice } from "../../shared/ipc";
import type { ToolHost } from "./tools";

// The provider-neutral boundary, after T3 Code's adapter layer: a runner keeps
// one agent conversation and runs one turn at a time, reporting what happens
// as events. The chat runtime turns events into saved chat parts. Claude runs
// through the Agent SDK today; Codex can be another runner later.

export interface TurnEvents {
  textDelta(text: string): void;
  /** The current text block is complete. */
  textEnd(): void;
  toolStart(id: string, name: string): void;
  /** Streamed JSON of a tool call's input, as far as written. */
  toolInput(id: string, partialJson: string): void;
  toolEnd(id: string, isError: boolean): void;
  /**
   * The user's plan limit is reached (Claude Code then holds the turn until it
   * reopens): the reset time, "" when unknown, or null once usage is allowed again.
   */
  limited(resetsAt: string | null): void;
}

export interface TurnInput {
  /** The message for the model: text, or content blocks with attachments. */
  content: string | unknown[];
  /** Plain text and attached script ids, for runners that read them directly. */
  text: string;
  refs: string[];
  host: ToolHost;
  events: TurnEvents;
}

export type TurnResult =
  | { outcome: "done" }
  | { outcome: "stopped" }
  | { outcome: "failed"; error: ChatError };

export interface Runner {
  /** Model and effort the runner was started with. */
  readonly choice: ChatModelChoice;
  run(turn: TurnInput): Promise<TurnResult>;
  /** Asks the running turn to stop; `run` then resolves with "stopped". */
  stop(): Promise<void>;
  close(): void;
}
