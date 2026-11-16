import { useSyncExternalStore } from "react";
import {
  hydrateLocalBooleanSetting,
  readLocalBooleanSetting,
  writeLocalBooleanSetting,
} from "../../internal/durableLocalSetting";

/**
 * Collapsed shows the queue as a narrow rail of artwork, the way the sidebar does with icons.
 * It defaults to collapsed: the queue is mostly something you glance at, and the full list
 * costs 340px of page width to answer a question ("what's next?") that a stack of covers
 * answers just as well.
 */
const QUEUE_PANEL_COLLAPSED_STORAGE_KEY = "queue-panel-collapsed";
const CHANGE_EVENT = "queue-panel-change";

function readQueuePanelCollapsed() {
  return readLocalBooleanSetting(QUEUE_PANEL_COLLAPSED_STORAGE_KEY, true);
}

function subscribe(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);

  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function setQueuePanelCollapsed(collapsed: boolean) {
  writeLocalBooleanSetting(QUEUE_PANEL_COLLAPSED_STORAGE_KEY, collapsed, CHANGE_EVENT);
}

export function toggleQueuePanelCollapsed() {
  setQueuePanelCollapsed(!readQueuePanelCollapsed());
}

export async function hydrateQueuePanelSettings() {
  await hydrateLocalBooleanSetting(QUEUE_PANEL_COLLAPSED_STORAGE_KEY, true, CHANGE_EVENT);
}

export function useQueuePanelCollapsed() {
  return useSyncExternalStore(subscribe, readQueuePanelCollapsed, () => true);
}
