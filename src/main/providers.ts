import { readFile } from "node:fs/promises";
import { app, safeStorage } from "electron";
import type {
  ProductKeySaveResult,
  ProductKeySource,
  ProductKeyStatus,
  ProviderMode,
} from "../shared/ipc";
import { devFeatures } from "./dev";
import { fetchBalance } from "./fal-balance";
import { dataFile, writeJsonAtomic } from "./paths";
import {
  cleanPastedKey,
  type KeyVerdict,
  maskedTail,
  verdictOfBalanceStatus,
} from "./product-key-rules";

const ENV_NAME = "FAL_KEY";
const SECRETS_FILE = "secrets.json";

type Base64Ciphertext = string;
type StoredSecrets = { fal?: Base64Ciphertext };

async function readStored(): Promise<StoredSecrets> {
  try {
    return JSON.parse(await readFile(dataFile(SECRETS_FILE), "utf8"));
  } catch {
    return {};
  }
}

const storedKeysInUse = new Set<string>();

export function knownKeyValues(): string[] {
  return [process.env[ENV_NAME] ?? "", ...storedKeysInUse];
}

const envKeyIgnored = () => devFeatures() && process.env.HYAN_FAKE_PRODUCT_KEY === "missing";

const envKey = (): string | null => (envKeyIgnored() ? null : process.env[ENV_NAME] || null);

async function storedKey(): Promise<string | null> {
  const stored = (await readStored()).fal;
  if (!stored || !safeStorage.isEncryptionAvailable()) return null;
  try {
    const key = safeStorage.decryptString(Buffer.from(stored, "base64"));
    if (!key) return null;
    storedKeysInUse.add(key);
    return key;
  } catch {
    return null;
  }
}

async function currentKey(): Promise<{ key: string; source: ProductKeySource } | null> {
  const fromEnv = envKey();
  if (fromEnv) return { key: fromEnv, source: "env" };
  const stored = await storedKey();
  return stored ? { key: stored, source: "stored" } : null;
}

export async function getKey(): Promise<string | null> {
  return (await currentKey())?.key ?? null;
}

export function providerMode(): ProviderMode {
  const requested = process.env.HYAN_PROVIDER_MODE;
  if (requested === "live" || requested === "fixture") return requested;
  return app.isPackaged ? "live" : "fixture";
}

export async function productKeyStatus(): Promise<ProductKeyStatus> {
  const current = await currentKey();
  return {
    mode: providerMode(),
    present: current !== null,
    source: current?.source ?? null,
    tail: current ? maskedTail(current.key) : null,
    canStore: safeStorage.isEncryptionAvailable(),
  };
}

async function checkKey(key: string): Promise<KeyVerdict> {
  try {
    return verdictOfBalanceStatus((await fetchBalance(key)).status);
  } catch {
    return "unreachable";
  }
}

const VERDICT_ERRORS: Record<Exclude<KeyVerdict, "ok">, string> = {
  rejected: "Mã không đúng.",
  unreachable: "Không kiểm tra được mã. Kiểm tra mạng rồi thử lại.",
};

export async function saveKey(input: string): Promise<ProductKeySaveResult> {
  const key = cleanPastedKey(input);
  if (!key) return { ok: false, error: VERDICT_ERRORS.rejected };
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: "Máy này không lưu được mã." };
  }
  const verdict = await checkKey(key);
  if (verdict !== "ok") return { ok: false, error: VERDICT_ERRORS[verdict] };
  storedKeysInUse.add(key);
  const stored = await readStored();
  stored.fal = safeStorage.encryptString(key).toString("base64");
  await writeJsonAtomic(dataFile(SECRETS_FILE), stored);
  return { ok: true, status: await productKeyStatus() };
}

function refuseClientInFixtureMode(provider: string) {
  if (providerMode() === "fixture") {
    throw new Error(`${provider} is disabled in fixture mode (set HYAN_PROVIDER_MODE=live)`);
  }
}

export async function falClient() {
  refuseClientInFixtureMode("fal");
  const credentials = await getKey();
  if (!credentials) throw new Error("Chưa có mã sản phẩm. Nhập mã trong Cài đặt.");
  const { createFalClient } = await import("@fal-ai/client");
  return createFalClient({ credentials });
}
