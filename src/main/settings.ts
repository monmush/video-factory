import { readFileSync } from "node:fs";
import type { ChatEffort, TextProvider, ThemePreference } from "../shared/ipc";
import { devFeatures } from "./dev";
import { dataFile, writeJsonAtomic } from "./paths";
import { providerMode } from "./providers";

interface Settings {
  theme: ThemePreference;
  textProvider: TextProvider;
  chatModel: string;
  chatEffort: ChatEffort | null;
  onboarded: boolean;
}

const FILE = "settings.json";
const textProviderUntilChosen = (): TextProvider =>
  providerMode() === "live" ? "claude-code" : "fal";

const defaultSettings = (): Settings => ({
  theme: "system",
  textProvider: textProviderUntilChosen(),
  chatModel: "opus",
  chatEffort: "medium",
  onboarded: false,
});

function storedSettings(): Settings {
  try {
    return { ...defaultSettings(), ...JSON.parse(readFileSync(dataFile(FILE), "utf8")) };
  } catch {
    return { ...defaultSettings() };
  }
}

const paidTextIsOffered = devFeatures;

export function readSettings(): Settings {
  const stored = storedSettings();
  return paidTextIsOffered() ? stored : { ...stored, textProvider: "claude-code" };
}

export async function writeSettings(patch: Partial<Settings>): Promise<void> {
  await writeJsonAtomic(dataFile(FILE), { ...storedSettings(), ...patch });
}
