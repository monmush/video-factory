import type { Balances } from "../shared/ipc";
import { getKey } from "./providers";
import { readClaudeLimits } from "./usage";

const TIMEOUT_MS = 10_000;

async function falBalance(): Promise<Balances["fal"]> {
  const keys = [await getKey("fal-billing"), await getKey("fal")].filter((k): k is string =>
    Boolean(k),
  );
  if (keys.length === 0) return { status: "no-key" };
  let denied = false;
  for (const key of keys) {
    try {
      const res = await fetch("https://api.fal.ai/v1/account/billing?expand=credits", {
        headers: { Authorization: `Key ${key}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 401 || res.status === 403) {
        denied = true;
        continue;
      }
      if (!res.ok) return { status: "error", message: `fal trả về lỗi ${res.status}` };
      const data = (await res.json()) as {
        credits?: { current_balance?: number; currency?: string };
      };
      if (typeof data.credits?.current_balance !== "number") {
        return { status: "error", message: "fal không trả về số dư" };
      }
      return {
        status: "ok",
        balance: data.credits.current_balance,
        currency: data.credits.currency ?? "USD",
      };
    } catch (error) {
      return { status: "error", message: (error as Error).message };
    }
  }
  return denied ? { status: "no-permission" } : { status: "no-key" };
}

export async function balances(): Promise<Balances> {
  const [fal, claude] = await Promise.all([falBalance(), readClaudeLimits()]);
  return { fal, claude, checkedAt: new Date().toISOString() };
}
