import { useSyncExternalStore } from "react";
import {
  MAX_CROSSFADE_SEC,
  readPlaybackSettings,
  savePlaybackSettings,
} from "../../player/playbackSettings";
import { tabManager } from "../../player/playerStore";

/**
 * The two settings that govern how one track becomes the next.
 *
 * They live in `playbackSettings` alongside volume rather than in their own durable key,
 * because the player already reads that blob on construction and pushes it to every tab. This
 * module is only the React-facing edge: read, write, notify.
 */
const CHANGE_EVENT = "playback-transitions-change";

export { MAX_CROSSFADE_SEC };

function subscribe(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function announce(): void {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function readCrossfadeSec(): number {
  return readPlaybackSettings().crossfadeSec ?? 0;
}

export function readGaplessEnabled(): boolean {
  return readPlaybackSettings().gaplessEnabled ?? true;
}

export function setCrossfadeSec(seconds: number): void {
  const clamped = Math.min(MAX_CROSSFADE_SEC, Math.max(0, Math.round(seconds)));
  savePlaybackSettings({ ...readPlaybackSettings(), crossfadeSec: clamped });
  // Every tab has its own player, and each keeps the setting on itself.
  tabManager.applyPlaybackSettings({ ...readPlaybackSettings(), crossfadeSec: clamped });
  announce();
}

export function setGaplessEnabled(enabled: boolean): void {
  savePlaybackSettings({ ...readPlaybackSettings(), gaplessEnabled: enabled });
  tabManager.applyPlaybackSettings({ ...readPlaybackSettings(), gaplessEnabled: enabled });
  announce();
}

export function useCrossfadeSec(): number {
  return useSyncExternalStore(subscribe, readCrossfadeSec, () => 0);
}

export function useGaplessEnabled(): boolean {
  return useSyncExternalStore(subscribe, readGaplessEnabled, () => true);
}
