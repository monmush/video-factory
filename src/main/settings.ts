import { readFileSync } from "node:fs";
import type { ChatEffort, TextProvider, ThemePreference } from "../shared/ipc";
import { dataFile, writeJsonAtomic } from "./paths";

interface Settings {
  theme: ThemePreference;
  textProvider: TextProvider;
  /** Last model chosen in a session chat; new sessions start with it. */
  chatModel: string;
  chatEffort: ChatEffort | null;
}

const FILE = "settings.json";
const defaults: Settings = {
  theme: "system",
  textProvider: "fal",
  chatModel: "opus",
  chatEffort: "medium",
};

// Read synchronously: the theme must be known before the first window is created
// so the native background matches and there is no light/dark flash.
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
