import { readFile } from "node:fs/promises";
import { app, safeStorage } from "electron";
import type { ProviderId, ProviderMode, ProviderStatus, ProvidersInfo } from "../shared/ipc";
import { dataFile, writeJsonAtomic } from "./paths";

// Provider keys never leave the main process. In development they come from
// `.env.local`; in the packaged app the operator enters them once and they are
// stored encrypted by the OS (Keychain on macOS) via safeStorage.

const ENV_NAMES: Record<ProviderId, string> = {
  fal: "FAL_KEY",
  "fal-billing": "FAL_BILLING_KEY",
  elevenlabs: "ELEVENLABS_API_KEY",
};
const PROVIDERS = Object.keys(ENV_NAMES) as ProviderId[];
const SECRETS_FILE = "secrets.json";

type StoredSecrets = Partial<Record<ProviderId, string>>; // base64 ciphertext

async function readStored(): Promise<StoredSecrets> {
  try {
    return JSON.parse(await readFile(dataFile(SECRETS_FILE), "utf8"));
  } catch {
    return {};
  }
}

export async function getKey(id: ProviderId): Promise<string | null> {
  const fromEnv = process.env[ENV_NAMES[id]];
  if (fromEnv) return fromEnv;
  const stored = (await readStored())[id];
  if (!stored || !safeStorage.isEncryptionAvailable()) return null;
  return safeStorage.decryptString(Buffer.from(stored, "base64"));
}

/**
 * Fixture mode is the default in development so UI work never spends credits.
 * Set HYAN_PROVIDER_MODE=live to allow real requests while developing.
 */
export function providerMode(): ProviderMode {
  const requested = process.env.HYAN_PROVIDER_MODE;
  if (requested === "live" || requested === "fixture") return requested;
  return app.isPackaged ? "live" : "fixture";
}

export async function providersInfo(): Promise<ProvidersInfo> {
  const stored = await readStored();
  const providers: ProviderStatus[] = PROVIDERS.map((id) => {
    const source = process.env[ENV_NAMES[id]] ? "env" : stored[id] ? "stored" : null;
    return { id, configured: source !== null, source };
  });
  return { mode: providerMode(), canStoreKeys: safeStorage.isEncryptionAvailable(), providers };
}

export async function setKey(id: ProviderId, key: string): Promise<ProvidersInfo> {
  if (!PROVIDERS.includes(id)) throw new Error(`Unknown provider: ${id}`);
  if (!safeStorage.isEncryptionAvailable()) throw new Error("OS encryption is unavailable");
  const trimmed = key.trim();
  if (!trimmed) throw new Error("Key is empty");
  const stored = await readStored();
  stored[id] = safeStorage.encryptString(trimmed).toString("base64");
  await writeJsonAtomic(dataFile(SECRETS_FILE), stored);
  return providersInfo();
}

export async function clearKey(id: ProviderId): Promise<ProvidersInfo> {
  const stored = await readStored();
  delete stored[id];
  await writeJsonAtomic(dataFile(SECRETS_FILE), stored);
  return providersInfo();
}

// Clients are created lazily so app start-up does not load either SDK.
// Fixture mode never gets a client, so a forgotten mode check in a caller
// fails loudly instead of spending credits.

function assertLive(provider: string) {
  if (providerMode() === "fixture") {
    throw new Error(`${provider} is disabled in fixture mode (set HYAN_PROVIDER_MODE=live)`);
  }
}

export async function falClient() {
  assertLive("fal");
  const credentials = await getKey("fal");
  if (!credentials) throw new Error("Chưa có khóa fal. Thêm khóa trong Cài đặt.");
  const { createFalClient } = await import("@fal-ai/client");
  return createFalClient({ credentials });
}

export async function elevenLabsClient() {
  assertLive("ElevenLabs");
  const apiKey = await getKey("elevenlabs");
  if (!apiKey) throw new Error("Chưa có khóa ElevenLabs. Thêm khóa trong Cài đặt.");
  const { ElevenLabsClient } = await import("@elevenlabs/elevenlabs-js");
  return new ElevenLabsClient({ apiKey });
}
