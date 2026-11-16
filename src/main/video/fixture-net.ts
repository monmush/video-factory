import { providerMode } from "../providers";

// Fixture mode only: HYAN_FIXTURE_OFFLINE=<seconds> makes every simulated
// provider step fail like a lost connection for that long, counted from the
// first step that tries, so "Mất kết nối, sẽ thử lại" and the automatic
// retry can be driven for free. Never active in live mode.

let offlineUntil: number | null = null;

/** Throws the error fetch gives with no connection while the simulated outage lasts. */
export function fixtureNetwork(): void {
  if (providerMode() !== "fixture") return;
  const seconds = Number(process.env.HYAN_FIXTURE_OFFLINE);
  if (!(seconds > 0)) return;
  offlineUntil ??= Date.now() + seconds * 1000;
  if (Date.now() < offlineUntil) {
    throw new TypeError("fetch failed", {
      cause: Object.assign(new Error("getaddrinfo ENOTFOUND fixture.invalid"), {
        code: "ENOTFOUND",
      }),
    });
  }
}
