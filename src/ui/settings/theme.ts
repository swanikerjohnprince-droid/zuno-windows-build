import { useSyncExternalStore } from "react";
import { getAppSetting, setAppSetting } from "../../internal/appSettings";

/**
 * Colour theme. `system` follows the OS and keeps following it — it is not resolved
 * once at startup, so a user flipping their OS theme sees the app change with it.
 */
export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "theme";
const CHANGE_EVENT = "theme-change";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isThemePreference(stored) ? stored : "dark";
  } catch {
    // Default to the app's original identity rather than the OS when storage is unavailable.
    return "dark";
  }
}

function systemTheme(): ResolvedTheme {
  return typeof window !== "undefined" && window.matchMedia(DARK_QUERY).matches
    ? "dark"
    : "light";
}

export function resolveTheme(preference = readThemePreference()): ResolvedTheme {
  return preference === "system" ? systemTheme() : preference;
}

/**
 * Writes `data-theme` on <html>. Called before React mounts so the first paint is
 * already correct — a flash of the wrong theme is the classic failure here.
 */
export function applyTheme(preference = readThemePreference()): void {
  document.documentElement.setAttribute("data-theme", resolveTheme(preference));
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Durable app settings still get the write below.
  }
  applyTheme(preference);
  window.dispatchEvent(new Event(CHANGE_EVENT));
  void setAppSetting(STORAGE_KEY, preference);
}

export async function hydrateTheme(): Promise<void> {
  const stored = await getAppSetting<unknown>(STORAGE_KEY);
  const preference = isThemePreference(stored) ? stored : readThemePreference();

  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // The apply below still reflects the hydrated value.
  }

  applyTheme(preference);
  window.dispatchEvent(new Event(CHANGE_EVENT));

  if (!isThemePreference(stored)) void setAppSetting(STORAGE_KEY, preference);
}

/** Re-applies on OS theme change, but only while the preference is `system`. */
export function watchSystemTheme(): () => void {
  const query = window.matchMedia(DARK_QUERY);
  const handle = () => {
    if (readThemePreference() !== "system") return;
    applyTheme("system");
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };
  query.addEventListener("change", handle);
  return () => query.removeEventListener("change", handle);
}

function subscribe(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, readThemePreference, () => "dark" as const);
}
