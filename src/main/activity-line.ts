import type { ActivityEvent } from "../shared/activity";
import { redactSecrets } from "./log-format";

const LONGEST_TEXT: Partial<Record<string, number>> = { message: 500, error: 300 };
const LONGEST_TEXT_OTHERWISE = 2000;

function cleaned(value: unknown, field: string, secrets: readonly string[]): unknown {
  if (typeof value === "string") {
    return redactSecrets(value, secrets).slice(0, LONGEST_TEXT[field] ?? LONGEST_TEXT_OTHERWISE);
  }
  if (Array.isArray(value)) return value.map((item) => cleaned(item, field, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, cleaned(inner, key, secrets)]),
    );
  }
  return value;
}

export function activityLine(
  time: Date,
  run: string,
  event: ActivityEvent,
  secrets: readonly string[],
): string {
  return `${JSON.stringify(cleaned({ at: time.toISOString(), run, ...event }, "", secrets))}\n`;
}
