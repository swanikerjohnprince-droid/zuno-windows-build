import { useSyncExternalStore } from "react";
import {
  hydrateLocalBooleanSetting,
  readLocalBooleanSetting,
  writeLocalBooleanSetting,
} from "../../internal/durableLocalSetting";

/**
 * Closing the window hides it to the tray instead of quitting, so playback keeps going.
 *
 * The Rust side reads this same key straight out of settings-v1.json rather than being told
 * over IPC — the close handler has to answer correctly even if the webview is gone or was
 * never ready, and a message that arrives too late would quit an app the user meant to keep.
 */
const MINIMIZE_TO_TRAY_STORAGE_KEY = "minimize-to-tray";
const CHANGE_EVENT = "tray-settings-change";

function readMinimizeToTray() {
  return readLocalBooleanSetting(MINIMIZE_TO_TRAY_STORAGE_KEY, false);
}

function subscribe(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);

  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function setMinimizeToTray(enabled: boolean) {
  writeLocalBooleanSetting(MINIMIZE_TO_TRAY_STORAGE_KEY, enabled, CHANGE_EVENT);
}

export async function hydrateTraySettings() {
  await hydrateLocalBooleanSetting(MINIMIZE_TO_TRAY_STORAGE_KEY, false, CHANGE_EVENT);
}

export function useMinimizeToTray() {
  return useSyncExternalStore(subscribe, readMinimizeToTray, () => false);
}
