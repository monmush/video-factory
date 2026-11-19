export const DEFAULT_PROFILE = "default";
export const DEFAULT_PROFILE_NAME = "Mặc định";

const MAX_NAME_LENGTH = 40;
const PROFILE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ProfileRegistry {
  active: string;
  names: Record<string, string>;
}

export interface NamedProfile {
  id: string;
  name: string;
}

export const isProfileId = (id: string) => PROFILE_ID.test(id) && id !== DEFAULT_PROFILE;

export function profileSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_NAME_LENGTH)
    .replace(/-+$/, "");
}

export function newProfile(rawName: string, existing: NamedProfile[]): NamedProfile {
  const name = rawName.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH);
  const id = profileSlug(name);
  if (!isProfileId(id)) throw new Error("Tên không hợp lệ");
  const taken = existing.some((profile) => profile.id === id || profileSlug(profile.name) === id);
  if (taken) throw new Error("Tên đã có");
  return { id, name };
}

export function parseRegistry(text: string | null): ProfileRegistry {
  const empty: ProfileRegistry = { active: DEFAULT_PROFILE, names: {} };
  if (!text) return empty;
  try {
    const value = JSON.parse(text) as Partial<ProfileRegistry> | null;
    const names: Record<string, string> = {};
    if (value?.names && typeof value.names === "object") {
      for (const [id, name] of Object.entries(value.names)) {
        if (isProfileId(id) && typeof name === "string" && name.trim()) names[id] = name;
      }
    }
    return { active: typeof value?.active === "string" ? value.active : DEFAULT_PROFILE, names };
  } catch {
    return empty;
  }
}

export const activeProfile = (registry: ProfileRegistry, folders: string[]): string =>
  isProfileId(registry.active) && folders.includes(registry.active)
    ? registry.active
    : DEFAULT_PROFILE;
