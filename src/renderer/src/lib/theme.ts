import type { ThemePreference } from "@shared/ipc";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

const THEME_STORAGE_KEY_SHARED_WITH_THEME_INIT = "hyan:theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");

function read(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY_SHARED_WITH_THEME_INIT);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function apply(preference: ThemePreference) {
  const dark = preference === "dark" || (preference === "system" && media.matches);
  document.documentElement.classList.toggle("dark", dark);
}

const matchNativeWindowChrome = (preference: ThemePreference) =>
  void api.invoke("theme:set", preference);

export function useTheme() {
  const [preference, setPreferenceState] = useState(read);

  useEffect(() => {
    apply(preference);
    if (preference !== "system") return;
    const onChange = () => apply("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY_SHARED_WITH_THEME_INIT, next);
    } catch {}
    setPreferenceState(next);
    matchNativeWindowChrome(next);
  }, []);

  return { preference, setPreference };
}
