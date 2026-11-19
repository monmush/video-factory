import type { ChatError, ChatModelChoice } from "../../shared/ipc";
import type { ToolHost } from "./tools";

export interface TurnEvents {
  textDelta(text: string): void;
  textEnd(): void;
  toolStart(id: string, name: string): void;
  toolInput(id: string, partialJson: string): void;
  toolEnd(id: string, isError: boolean): void;
  limited(resetsAt: string | null): void;
}

export interface TurnInput {
  content: string | unknown[];
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
  readonly choice: ChatModelChoice;
  run(turn: TurnInput): Promise<TurnResult>;
  stop(): Promise<void>;
  close(): void;
}
