import { useSyncExternalStore } from "react";
import {
  hydrateLocalJsonSetting,
  readLocalJsonSetting,
  writeLocalJsonSetting,
} from "../../internal/durableLocalSetting";

/**
 * How much room the library rail takes.
 *
 * - `collapsed` — artwork only, permanently. Maximum space for the content column.
 * - `expanded` — names and owners always visible. The default.
 * - `hover` — collapsed until pointed at, then expanded. Keeps the width of `collapsed` while
 *   still letting you read the list without committing a click to it.
 */
export type SidebarMode = "collapsed" | "expanded" | "hover";

const STORAGE_KEY = "sidebar-mode";
const CHANGE_EVENT = "sidebar-mode-change";
const DEFAULT_MODE: SidebarMode = "expanded";

/** Rail width when collapsed. Wide enough for a 40px tile plus its padding. */
export const SIDEBAR_COLLAPSED_WIDTH = 62;
export const SIDEBAR_EXPANDED_WIDTH = 240;

export const SIDEBAR_MODES: ReadonlyArray<{ value: SidebarMode; label: string; hint: string }> = [
  { value: "expanded", label: "Always expanded", hint: "Names always visible" },
  { value: "hover", label: "Expand on hover", hint: "Collapsed until you point at it" },
  { value: "collapsed", label: "Always collapsed", hint: "Artwork only" },
];

function isSidebarMode(value: unknown): value is SidebarMode {
  return value === "collapsed" || value === "expanded" || value === "hover";
}

function readSidebarMode(): SidebarMode {
  return readLocalJsonSetting(STORAGE_KEY, isSidebarMode) ?? DEFAULT_MODE;
}

function subscribe(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);

  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function setSidebarMode(mode: SidebarMode) {
  writeLocalJsonSetting(STORAGE_KEY, mode);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function getSidebarMode(): SidebarMode {
  return readSidebarMode();
}

export async function hydrateSidebarSettings() {
  await hydrateLocalJsonSetting(STORAGE_KEY, isSidebarMode);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useSidebarMode(): SidebarMode {
  return useSyncExternalStore(subscribe, readSidebarMode, () => DEFAULT_MODE);
}

/**
 * The width a mode resolves to.
 *
 * `hover` only counts as hovered when the pointer is actually over the rail — a keyboard user
 * tabbing through the list never triggers it, which is why focus widens it too at the call site.
 */
export function resolveSidebarWidth(mode: SidebarMode, isHovered: boolean): number {
  if (mode === "expanded") return SIDEBAR_EXPANDED_WIDTH;
  if (mode === "collapsed") return SIDEBAR_COLLAPSED_WIDTH;
  return isHovered ? SIDEBAR_EXPANDED_WIDTH : SIDEBAR_COLLAPSED_WIDTH;
}
