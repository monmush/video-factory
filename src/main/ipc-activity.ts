import type { ActivityEvent } from "../shared/activity";
import type { IpcChannel } from "../shared/ipc";

export const QUIET_CHANNELS: ReadonlySet<IpcChannel> = new Set<IpcChannel>([
  "app:info",
  "activity:screen",
  "dev:profiles",
  "workspace:get",
  "board:get",
  "chat:info",
  "material:list",
  "voices:sample",
  "assets:estimate-angles",
  "assets:estimate-clean",
  "usage:balances",
  "usage:media-balance",
  "usage:stats",
  "product-key:status",
  "ai:status",
  "ai:onboarded",
  "video:jobs",
  "video:paid-work",
  "video:making",
]);

const ID_FIELDS = ["sessionId", "scriptId", "seriesId"] as const;

function idsOf(first: unknown): Partial<Record<(typeof ID_FIELDS)[number], string>> {
  if (!first || typeof first !== "object" || Array.isArray(first)) return {};
  const fields = first as Record<string, unknown>;
  return Object.fromEntries(
    ID_FIELDS.flatMap((field) =>
      typeof fields[field] === "string" ? [[field, fields[field]]] : [],
    ),
  );
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function actionEvent(
  channel: IpcChannel,
  args: readonly unknown[],
  ms: number,
  failure: { error: unknown } | null,
): ActivityEvent {
  return {
    name: "action",
    channel,
    ms,
    ok: failure === null,
    ...(failure ? { error: messageOf(failure.error) } : {}),
    ...idsOf(args[0]),
  };
}
