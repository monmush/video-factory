import { existsSync, readdirSync, renameSync, rmdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const FORMER_APP_NAMES = ["Hy An Video Factory"];

const holdsNothing = (folder: string) => !existsSync(folder) || readdirSync(folder).length === 0;

export function formerFolders(folder: string, appName: string): string[] {
  const name = basename(folder);
  if (!name.startsWith(appName)) return [];
  const suffix = name.slice(appName.length);
  return FORMER_APP_NAMES.map((former) => join(dirname(folder), `${former}${suffix}`));
}

export function adoptFormerFolder(folder: string, appName: string): void {
  if (!holdsNothing(folder)) return;
  const former = formerFolders(folder, appName).find((candidate) => existsSync(candidate));
  if (!former) return;
  if (existsSync(folder)) rmdirSync(folder);
  renameSync(former, folder);
}
