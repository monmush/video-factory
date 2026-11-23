import { readFileSync } from "node:fs";
import type { ChatEffort, TextProvider, ThemePreference } from "../shared/ipc";
import { devFeatures } from "./dev";
import { dataFile, writeJsonAtomic } from "./paths";

interface Settings {
  theme: ThemePreference;
  textProvider: TextProvider;
  chatModel: string;
  chatEffort: ChatEffort | null;
  onboarded: boolean;
  nativeVoice: boolean;
}

const FILE = "settings.json";
const defaults: Settings = {
  theme: "system",
  textProvider: "fal",
  chatModel: "opus",
  chatEffort: "medium",
  onboarded: false,
  nativeVoice: false,
};

export function readSettings(): Settings {
  try {
    return { ...defaults, ...JSON.parse(readFileSync(dataFile(FILE), "utf8")) };
  } catch {
    return { ...defaults };
  }
}

export async function writeSettings(patch: Partial<Settings>): Promise<void> {
  await writeJsonAtomic(dataFile(FILE), { ...readSettings(), ...patch });
}

export const nativeVoiceOn = () => devFeatures() && readSettings().nativeVoice === true;
