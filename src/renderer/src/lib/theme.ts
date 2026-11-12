import type { ThemePreference } from "@shared/ipc";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

// Keep the key and logic in sync with public/theme-init.js, which applies the
// theme before React mounts.
const KEY = "hyan:theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");

function read(): ThemePreference {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function apply(preference: ThemePreference) {
  const dark = preference === "dark" || (preference === "system" && media.matches);
  document.documentElement.classList.toggle("dark", dark);
}

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
      localStorage.setItem(KEY, next);
    } catch {}
    setPreferenceState(next);
    // Keeps native chrome (traffic lights, window background) in step.
    void api.invoke("theme:set", next);
  }, []);

  return { preference, setPreference };
}
