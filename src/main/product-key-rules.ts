export type KeyVerdict = "ok" | "rejected" | "unreachable";

const KEY_REJECTED = 401;
const KEY_REAL_BUT_CANNOT_READ_BALANCE = 403;

export function verdictOfBalanceStatus(status: number): KeyVerdict {
  if (status === KEY_REJECTED) return "rejected";
  if (status === KEY_REAL_BUT_CANNOT_READ_BALANCE) return "ok";
  return status >= 200 && status < 300 ? "ok" : "unreachable";
}

const SURROUNDING_QUOTES = /^["'`“”‘’]+|["'`“”‘’]+$/g;

export const cleanPastedKey = (input: string): string =>
  input.trim().replace(SURROUNDING_QUOTES, "").trim();

const TAIL_LENGTH = 4;

export const maskedTail = (key: string): string => `••••${key.slice(-TAIL_LENGTH)}`;
