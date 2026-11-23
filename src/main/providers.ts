import { readFile } from "node:fs/promises";
import { app, safeStorage } from "electron";
import type { ProviderId, ProviderMode, ProviderStatus, ProvidersInfo } from "../shared/ipc";
import { dataFile, writeJsonAtomic } from "./paths";

const ENV_NAMES: Record<ProviderId, string> = {
  fal: "FAL_KEY",
  "fal-billing": "FAL_BILLING_KEY",
  elevenlabs: "ELEVENLABS_API_KEY",
};
const PROVIDERS = Object.keys(ENV_NAMES) as ProviderId[];
const SECRETS_FILE = "secrets.json";

type Base64Ciphertext = string;
type StoredSecrets = Partial<Record<ProviderId, Base64Ciphertext>>;

async function readStored(): Promise<StoredSecrets> {
  try {
    return JSON.parse(await readFile(dataFile(SECRETS_FILE), "utf8"));
  } catch {
    return {};
  }
}

const bundledKey = (id: ProviderId): string | null => __BUNDLED_KEYS__[ENV_NAMES[id]] || null;

const storedKeysInUse = new Set<string>();

export function knownKeyValues(): string[] {
  const fromEnv = PROVIDERS.map((id) => process.env[ENV_NAMES[id]] ?? "");
  const bundled = Object.values(__BUNDLED_KEYS__).filter((value) => value !== undefined);
  return [...fromEnv, ...bundled, ...storedKeysInUse];
}

export async function getKey(id: ProviderId): Promise<string | null> {
  const fromEnv = process.env[ENV_NAMES[id]];
  if (fromEnv) return fromEnv;
  const stored = (await readStored())[id];
  if (stored && safeStorage.isEncryptionAvailable()) {
    const key = safeStorage.decryptString(Buffer.from(stored, "base64"));
    storedKeysInUse.add(key);
    return key;
  }
  return bundledKey(id);
}

export function providerMode(): ProviderMode {
  const requested = process.env.HYAN_PROVIDER_MODE;
  if (requested === "live" || requested === "fixture") return requested;
  return app.isPackaged ? "live" : "fixture";
}

export async function providersInfo(): Promise<ProvidersInfo> {
  const stored = await readStored();
  const providers: ProviderStatus[] = PROVIDERS.map((id) => {
    const source = process.env[ENV_NAMES[id]]
      ? "env"
      : stored[id]
        ? "stored"
        : bundledKey(id)
          ? "bundled"
          : null;
    return { id, configured: source !== null, source };
  });
  return { mode: providerMode(), canStoreKeys: safeStorage.isEncryptionAvailable(), providers };
}

export async function setKey(id: ProviderId, key: string): Promise<ProvidersInfo> {
  if (!PROVIDERS.includes(id)) throw new Error(`Unknown provider: ${id}`);
  if (!safeStorage.isEncryptionAvailable()) throw new Error("OS encryption is unavailable");
  const trimmed = key.trim();
  if (!trimmed) throw new Error("Key is empty");
  storedKeysInUse.add(trimmed);
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

function refuseClientInFixtureMode(provider: string) {
  if (providerMode() === "fixture") {
    throw new Error(`${provider} is disabled in fixture mode (set HYAN_PROVIDER_MODE=live)`);
  }
}

export async function falClient() {
  refuseClientInFixtureMode("fal");
  const credentials = await getKey("fal");
  if (!credentials) throw new Error("Chưa có khóa fal. Thêm khóa trong Cài đặt.");
  const { createFalClient } = await import("@fal-ai/client");
  return createFalClient({ credentials });
}

export async function elevenLabsClient() {
  refuseClientInFixtureMode("ElevenLabs");
  const apiKey = await getKey("elevenlabs");
  if (!apiKey) throw new Error("Chưa có khóa ElevenLabs. Thêm khóa trong Cài đặt.");
  const { ElevenLabsClient } = await import("@elevenlabs/elevenlabs-js");
  return new ElevenLabsClient({ apiKey });
}
