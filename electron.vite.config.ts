import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const BUNDLE_FILE = ".env.bundle";
const REQUIRED_KEYS = ["FAL_KEY", "ELEVENLABS_API_KEY"];
const OPTIONAL_KEYS = ["FAL_BILLING_KEY"];

function bundledKeys(command: "build" | "serve"): Record<string, string> {
  if (command !== "build" || process.env.HYAN_BUNDLE_KEYS !== "1") return {};
  const file = resolve(BUNDLE_FILE);
  if (!existsSync(file)) {
    throw new Error(`HYAN_BUNDLE_KEYS=1 needs ${BUNDLE_FILE} (copy ${BUNDLE_FILE}.example)`);
  }
  const parsed = parseEnv(readFileSync(file, "utf8"));
  const keys: Record<string, string> = {};
  for (const name of [...REQUIRED_KEYS, ...OPTIONAL_KEYS]) {
    const value = parsed[name]?.trim();
    if (value) keys[name] = value;
  }
  const missing = REQUIRED_KEYS.filter((name) => !keys[name]);
  if (missing.length > 0) throw new Error(`${BUNDLE_FILE} has no value for ${missing.join(", ")}`);
  return keys;
}

export default defineConfig(({ command }) => ({
  main: {
    define: { __BUNDLED_KEYS__: JSON.stringify(bundledKeys(command)) },
  },
  preload: {},
  renderer: {
    resolve: {
      alias: { "@": resolve("src/renderer/src"), "@shared": resolve("src/shared") },
    },
    plugins: [react(), tailwindcss()],
  },
}));
