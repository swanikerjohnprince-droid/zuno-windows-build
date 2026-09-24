import { invoke } from "@tauri-apps/api/core";
import { clearArtworkCache } from "./artworkCache";
import { logInternalWarn } from "./logging";

export const DEFAULT_CACHE_SIZE_GB = 4;

export interface CacheStats {
  maxBytes: number;
  usedBytes: number;
  entryCount: number;
}

interface CacheWriteResult {
  changed: boolean;
}

export async function getCachedJson<T>(key: string): Promise<T | null> {
  try {
    const value = await invoke<string | null>("cache_get", { key });
    return value === null ? null : JSON.parse(value) as T;
  } catch (error) {
    logInternalWarn("cache.get failed", {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function setCachedJson<T>(key: string, value: T): Promise<boolean> {
  try {
    const result = await invoke<CacheWriteResult>("cache_set", {
      key,
      value: JSON.stringify(value),
    });
    return result.changed;
  } catch (error) {
    logInternalWarn("cache.set failed", {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export function getCacheStats(): Promise<CacheStats> {
  return invoke<CacheStats>("cache_stats");
}

export function setCacheMaxBytes(maxBytes: number): Promise<CacheStats> {
  return invoke<CacheStats>("cache_set_max_bytes", { maxBytes });
}

export function clearCache(): Promise<CacheStats> {
  // The in-memory artwork map holds object URLs; clearing the on-disk cache without it
  // would leave the UI serving blobs the user just asked to delete.
  clearArtworkCache();
  return invoke<CacheStats>("cache_clear");
}
