import { useSyncExternalStore } from "react";
import {
  hydrateLocalBooleanSetting,
  hydrateLocalJsonSetting,
  readLocalBooleanSetting,
  readLocalJsonSetting,
  writeLocalBooleanSetting,
  writeLocalJsonSetting,
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
  await hydrateLocalJsonSetting(QUEUE_PANEL_VIEW_STORAGE_KEY, isQueuePanelView);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useQueuePanelCollapsed() {
  return useSyncExternalStore(subscribe, readQueuePanelCollapsed, () => true);
}

/**
 * The panel shows either the upcoming queue or the history of what the queue has already
 * played (`PlayerSession.history`). Which one is a glance, not a navigation, so it persists.
 */
export type QueuePanelView = "queue" | "history";

const QUEUE_PANEL_VIEW_STORAGE_KEY = "queue-panel-view";

function isQueuePanelView(value: unknown): value is QueuePanelView {
  return value === "queue" || value === "history";
}

function readQueuePanelView(): QueuePanelView {
  return readLocalJsonSetting(QUEUE_PANEL_VIEW_STORAGE_KEY, isQueuePanelView) ?? "queue";
}

export function setQueuePanelView(view: QueuePanelView) {
  writeLocalJsonSetting(QUEUE_PANEL_VIEW_STORAGE_KEY, view);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useQueuePanelView() {
  return useSyncExternalStore(subscribe, readQueuePanelView, () => "queue" as QueuePanelView);
}
