import type { Balances } from "../shared/ipc";
import { getKey } from "./providers";
import { readClaudeLimits } from "./usage";

const TIMEOUT_MS = 10_000;
const BALANCE_URL = "https://rest.alpha.fal.ai/billing/user_balance";

function parseBalance(body: string): number | null {
  const text = body.trim();
  const value = Number(text);
  return text !== "" && Number.isFinite(value) ? value : null;
}

async function mediaBalance(): Promise<Balances["media"]> {
  const key = await getKey("fal");
  if (!key) return { status: "no-key" };
  try {
    const res = await fetch(BALANCE_URL, {
      headers: { Authorization: `Key ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) return { status: "no-permission" };
    if (!res.ok) return { status: "error", message: `Lỗi ${res.status}` };
    const balance = parseBalance(await res.text());
    if (balance === null) return { status: "error", message: "Không có số dư" };
    return { status: "ok", balance, currency: "USD" };
  } catch (error) {
    return { status: "error", message: (error as Error).message };
  }
}

export async function balances(): Promise<Balances> {
  const [media, claude] = await Promise.all([mediaBalance(), readClaudeLimits()]);
  return { media, claude };
}
