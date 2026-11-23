import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "electron";
import type { DevProfiles } from "../shared/ipc";
import { devFeatures } from "./dev";
import { writeJsonAtomic } from "./paths";
import {
  activeProfile,
  DEFAULT_PROFILE,
  DEFAULT_PROFILE_NAME,
  isProfileId,
  newProfile,
  type ProfileRegistry,
  parseRegistry,
} from "./profile-rules";
import { childPath } from "./safe-path";
import { finishWorkAndShutDown } from "./shutdown";
import { isMakingVideo } from "./video/runner";

const SUPERVISED_CHILD = "HYAN_PROFILE_CHILD";
const RESTART_EXIT_CODE = 75;

export const profilesEnabled = devFeatures;

const fixedByEnvironment = () => Boolean(process.env.HYAN_DATA_DIR);

interface Folders {
  defaultDir: string;
  profilesDir: string;
}

let folders: Folders | null = null;
let active = DEFAULT_PROFILE;

function locateFolders(): Folders {
  const root = process.env.HYAN_PROFILES_ROOT;
  if (root && profilesEnabled()) {
    return { defaultDir: join(root, "default"), profilesDir: join(root, "profiles") };
  }
  const base = app.getPath("userData");
  const defaultDir = app.isPackaged ? base : `${base} (dev)`;
  return { defaultDir, profilesDir: `${defaultDir} profiles` };
}

function requireFolders(): Folders {
  if (!profilesEnabled()) throw new Error("Không khả dụng");
  if (fixedByEnvironment() || !folders) throw new Error("Thư mục dữ liệu do HYAN_DATA_DIR đặt");
  return folders;
}

const registryFile = ({ profilesDir }: Folders) => join(profilesDir, "profiles.json");

function readRegistry(where: Folders): ProfileRegistry {
  try {
    return parseRegistry(readFileSync(registryFile(where), "utf8"));
  } catch {
    return parseRegistry(null);
  }
}

function profileFolders({ profilesDir }: Folders): string[] {
  try {
    return readdirSync(profilesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && isProfileId(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

const folderOf = (where: Folders, id: string) =>
  id === DEFAULT_PROFILE ? where.defaultDir : childPath(where.profilesDir, id);

export function chooseDataFolder() {
  if (process.env.HYAN_DATA_DIR) {
    app.setPath("userData", process.env.HYAN_DATA_DIR);
    return;
  }
  folders = locateFolders();
  active = profilesEnabled()
    ? activeProfile(readRegistry(folders), profileFolders(folders))
    : DEFAULT_PROFILE;
  const dir = folderOf(folders, active);
  mkdirSync(dir, { recursive: true });
  app.setPath("userData", dir);
}

export function superviseDevelopmentRestarts(): boolean {
  if (app.isPackaged || fixedByEnvironment() || process.env[SUPERVISED_CHILD]) return false;
  const ownFolder = mkdtempSync(join(tmpdir(), "hyan-dev-supervisor-"));
  app.setPath("userData", ownFolder);
  app.commandLine.removeSwitch("remote-debugging-port");
  app.dock?.hide();
  let child: ChildProcess;
  const start = () => {
    child = spawn(process.execPath, process.argv.slice(1), {
      stdio: "inherit",
      env: { ...process.env, [SUPERVISED_CHILD]: "1" },
    });
    child.once("exit", (code, signal) => {
      if (code === RESTART_EXIT_CODE) return start();
      rmSync(ownFolder, { recursive: true, force: true });
      app.exit(code ?? (signal ? 1 : 0));
    });
  };
  app.on("will-quit", () => child.kill());
  start();
  return true;
}

export function listProfiles(): DevProfiles | null {
  if (!profilesEnabled()) return null;
  if (fixedByEnvironment() || !folders) return { fixed: true, profiles: [] };
  const { names } = readRegistry(folders);
  return {
    fixed: false,
    profiles: [
      { id: DEFAULT_PROFILE, name: DEFAULT_PROFILE_NAME, isDefault: true },
      ...profileFolders(folders).map((id) => ({ id, name: names[id] ?? id, isDefault: false })),
    ].map((profile) => ({ ...profile, active: profile.id === active })),
  };
}

export async function createProfile(name: unknown): Promise<DevProfiles | null> {
  const where = requireFolders();
  if (typeof name !== "string") throw new Error("Tên không hợp lệ");
  const current = listProfiles()?.profiles ?? [];
  const profile = newProfile(name, current);
  await mkdir(childPath(where.profilesDir, profile.id), { recursive: true });
  const registry = readRegistry(where);
  await writeJsonAtomic(registryFile(where), {
    ...registry,
    names: { ...registry.names, [profile.id]: profile.name },
  });
  return listProfiles();
}

export async function deleteProfile(id: unknown): Promise<DevProfiles | null> {
  const where = requireFolders();
  if (typeof id !== "string" || !profileFolders(where).includes(id)) {
    throw new Error("Không tìm thấy hồ sơ");
  }
  if (id === active) throw new Error("Không xóa được hồ sơ đang dùng");
  await rm(childPath(where.profilesDir, id), { recursive: true, force: true });
  const registry = readRegistry(where);
  const names = Object.fromEntries(Object.entries(registry.names).filter(([key]) => key !== id));
  await writeJsonAtomic(registryFile(where), { ...registry, names });
  return listProfiles();
}

export async function switchProfile(id: unknown): Promise<null> {
  const where = requireFolders();
  if (typeof id !== "string" || (id !== DEFAULT_PROFILE && !profileFolders(where).includes(id))) {
    throw new Error("Không tìm thấy hồ sơ");
  }
  if (id === active) return null;
  if (isMakingVideo()) throw new Error("Đang tạo video. Dừng video trước khi đổi hồ sơ.");
  await writeJsonAtomic(registryFile(where), { ...readRegistry(where), active: id });
  setImmediate(() => void restartIntoActiveProfile());
  return null;
}

const FINISH_BEFORE_SWITCHING_MS = 10_000;

async function restartIntoActiveProfile() {
  await finishWorkAndShutDown(FINISH_BEFORE_SWITCHING_MS);
  if (process.env[SUPERVISED_CHILD]) {
    app.exit(RESTART_EXIT_CODE);
    return;
  }
  app.relaunch();
  app.exit(0);
}
