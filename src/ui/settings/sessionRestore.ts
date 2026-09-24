import { useSyncExternalStore } from "react";
import {
  hydrateLocalBooleanSetting,
  readLocalBooleanSetting,
  writeLocalBooleanSetting,
} from "../../internal/durableLocalSetting";

/**
 * Whether tabs and their queues come back after a restart.
 *
 * On by default, because losing a 200-track queue to a restart is the kind of thing people
 * only discover the hard way. The opt-out exists for the opposite preference — some people
 * want a launch to be a clean slate, and clearing the queue by hand every time is worse than
 * a switch.
 *
 * Only governs *restoring*. Writing continues either way so the setting can be turned back on
 * without having lost the session that was open when it was turned off.
 */
const SESSION_RESTORE_STORAGE_KEY = "session-restore-enabled";
const CHANGE_EVENT = "session-restore-change";

export function readSessionRestoreEnabled(): boolean {
  return readLocalBooleanSetting(SESSION_RESTORE_STORAGE_KEY, true);
}

function subscribe(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);

  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function setSessionRestoreEnabled(enabled: boolean) {
  writeLocalBooleanSetting(SESSION_RESTORE_STORAGE_KEY, enabled, CHANGE_EVENT);
}

export async function hydrateSessionRestoreSetting() {
  await hydrateLocalBooleanSetting(SESSION_RESTORE_STORAGE_KEY, true, CHANGE_EVENT);
}

export function useSessionRestoreEnabled() {
  return useSyncExternalStore(subscribe, readSessionRestoreEnabled, () => true);
}
