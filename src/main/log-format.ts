import { format } from "node:util";

export type LogLevel = "INFO" | "WARN" | "ERROR";

const SHORTEST_SECRET = 8;
const SECRET_MARK = "[key]";

export function redactSecrets(text: string, secrets: Iterable<string>): string {
  const longestFirst = [...secrets]
    .filter((secret) => secret.length >= SHORTEST_SECRET)
    .sort((a, b) => b.length - a.length);
  return longestFirst.reduce((out, secret) => out.split(secret).join(SECRET_MARK), text);
}

export function formatLogEntry(
  time: Date,
  level: LogLevel,
  args: unknown[],
  secrets: Iterable<string>,
): string {
  return `${time.toISOString()} ${level} ${redactSecrets(format(...args), secrets)}\n`;
}
