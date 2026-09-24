import { useSyncExternalStore } from "react";
import {
  hydrateLocalJsonSetting,
  readLocalJsonSetting,
  writeLocalJsonSetting,
} from "../../internal/durableLocalSetting";

/**
 * Playlist ids hidden from the Library page's Playlists tab.
 *
 * A display filter only — the playlist itself is untouched on YouTube's side, so hiding one is
 * always reversible and never touches the network. Local playlists and Liked Songs can be
 * hidden the same way as any other; nothing here is specific to a playlist kind.
 */
const STORAGE_KEY = "library-hidden-playlists";
const CHANGE_EVENT = "hidden-playlists-change";
const EMPTY: string[] = [];

function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/*
 * Cached for the same reason as the equaliser settings: `readLocalJsonSetting` parses fresh
 * JSON on every call, and a new array reference on every render is what makes
 * `useSyncExternalStore` believe the store changed and re-render forever.
 */
let cached: string[] | null = null;

function readIds(): string[] {
  if (cached === null) {
    cached = readLocalJsonSetting<string[]>(STORAGE_KEY, isIdList) ?? EMPTY;
  }
  return cached;
}

function writeIds(ids: string[]): void {
  cached = ids;
  writeLocalJsonSetting(STORAGE_KEY, ids);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", () => {
    cached = null;
  });
}

export function isPlaylistHidden(playlistId: string): boolean {
  return readIds().includes(playlistId);
}

export function hidePlaylist(playlistId: string): void {
  const current = readIds();
  if (current.includes(playlistId)) return;
  writeIds([...current, playlistId]);
}

export function unhidePlaylist(playlistId: string): void {
  const current = readIds();
  if (!current.includes(playlistId)) return;
  writeIds(current.filter((id) => id !== playlistId));
}

export async function hydrateHiddenPlaylists(): Promise<void> {
  await hydrateLocalJsonSetting(STORAGE_KEY, isIdList);
  cached = null;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useHiddenPlaylistIds(): string[] {
  return useSyncExternalStore(subscribe, readIds, () => EMPTY);
}
