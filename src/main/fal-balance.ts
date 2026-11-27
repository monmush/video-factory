const TIMEOUT_MS = 10_000;
const BALANCE_URL = "https://rest.alpha.fal.ai/billing/user_balance";

export const fetchBalance = (key: string) =>
  fetch(BALANCE_URL, {
    headers: { Authorization: `Key ${key}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
