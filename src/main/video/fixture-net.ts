import { providerMode } from "../providers";

let offlineUntil: number | null = null;

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
