/**
 * Every amount the UI shows goes through here. Costs are recorded in USD
 * (usage.jsonl). Shown as dollars for now; if the app later sells credits,
 * change this one function (rate, markup, label) instead of every screen.
 */
export function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
