import type { Balances } from "../shared/ipc";
import { getKey } from "./providers";
import { readClaudeLimits } from "./usage";

// Live balances from each provider's official API. Reading a balance is free.
//   fal:        GET https://api.fal.ai/v1/account/billing?expand=credits
//               (needs a key with billing:usage:read, e.g. the READONLY preset)
//   ElevenLabs: GET https://api.elevenlabs.io/v1/user/subscription
//   Claude:     no balance API; plan limits arrive with each Claude Code call.

const TIMEOUT_MS = 10_000;

async function falBalance(): Promise<Balances["fal"]> {
  // Prefer the read-only billing key; fall back to the main key in case it has access.
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

async function elevenLabsBalance(): Promise<Balances["elevenlabs"]> {
  const key = await getKey("elevenlabs");
  if (!key) return { status: "no-key" };
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
      headers: { "xi-api-key": key },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) return { status: "no-permission" };
    if (!res.ok) return { status: "error", message: `ElevenLabs trả về lỗi ${res.status}` };
    const data = (await res.json()) as {
      tier?: string;
      character_count?: number;
      character_limit?: number;
      next_character_count_reset_unix?: number;
    };
    return {
      status: "ok",
      used: data.character_count ?? 0,
      limit: data.character_limit ?? 0,
      resetsAt: data.next_character_count_reset_unix
        ? new Date(data.next_character_count_reset_unix * 1000).toISOString()
        : null,
      plan: data.tier ?? "",
    };
  } catch (error) {
    return { status: "error", message: (error as Error).message };
  }
}

export async function balances(): Promise<Balances> {
  const [fal, elevenlabs, claude] = await Promise.all([
    falBalance(),
    elevenLabsBalance(),
    readClaudeLimits(),
  ]);
  return { fal, elevenlabs, claude, checkedAt: new Date().toISOString() };
}
