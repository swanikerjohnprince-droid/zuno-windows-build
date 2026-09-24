import { useSyncExternalStore } from "react";
import {
  hydrateLocalBooleanSetting,
  readLocalBooleanSetting,
  writeLocalBooleanSetting,
} from "../../internal/durableLocalSetting";

/**
 * Which optional sections the home page carries.
 *
 * Visibility only. "Made for you" shares its fetched suggestions with the surprise button and
 * the "More recommendations" strip, so hiding the carousel hides the carousel — it does not
 * stop the recommendations being fetched, and those other two keep working.
 */
const MADE_FOR_YOU_KEY = "home-made-for-you-visible";
const CHANGE_EVENT = "home-sections-change";

function subscribe(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  // Another window writes the same key.
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function readMadeForYouVisible(): boolean {
  return readLocalBooleanSetting(MADE_FOR_YOU_KEY, true);
}

export function setMadeForYouVisible(visible: boolean) {
  writeLocalBooleanSetting(MADE_FOR_YOU_KEY, visible, CHANGE_EVENT);
}

export function useMadeForYouVisible(): boolean {
  return useSyncExternalStore(subscribe, readMadeForYouVisible, () => true);
}

export async function hydrateHomeSectionSettings() {
  await hydrateLocalBooleanSetting(MADE_FOR_YOU_KEY, true, CHANGE_EVENT);
}
