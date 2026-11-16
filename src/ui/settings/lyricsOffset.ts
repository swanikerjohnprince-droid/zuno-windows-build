import { useSyncExternalStore } from "react";

/**
 * Per-track lyric timing offset, in seconds.
 *
 * LRCLIB matches on title, artist and a duration within two seconds, which is loose enough
 * to return a *different master* — a remaster, a radio edit, a live cut — whose words land a
 * second off. The data is fine; it just belongs to a slightly different recording. Rather
 * than throw the match away, let the listener nudge it and remember the nudge.
 *
 * Per track rather than global: this corrects a bad match, not device latency, so it must
 * not follow the listener onto the next song.
 */
const STORAGE_KEY = "lyrics-offset";

/** Nudge granularity. Sub-second, because that is the size of the error being corrected. */
export const OFFSET_STEP_SEC = 0.25;
const MAX_OFFSET_SEC = 5;
/** Beyond this the wrong lyrics are being forced onto a song; a fresh match would serve better. */
const MAX_ENTRIES = 200;

export function clampOffset(seconds: number): number {
  if (!Number.isFinite(seconds)) return 0;
  const clamped = Math.min(MAX_OFFSET_SEC, Math.max(-MAX_OFFSET_SEC, seconds));
  /* Snapped to the step so a run of nudges cannot accumulate binary float error into a
     stored 0.7500000000000001, which then renders as "+0.8s" and never returns to zero. */
  return Math.round(clamped / OFFSET_STEP_SEC) * OFFSET_STEP_SEC;
}

/**
 * Drops defaults and caps the table.
 *
 * Zeroes are the default, so storing them spends the budget on nothing. The cap keeps the
 * oldest entries out by relying on object key insertion order — which holds for the string
 * ids used here, but would not for keys that look like array indices.
 */
export function pruneOffsets(entries: Record<string, number>): Record<string, number> {
  const kept: Record<string, number> = {};
  const ids = Object.keys(entries).filter((id) => entries[id] !== 0);
  for (const id of ids.slice(Math.max(0, ids.length - MAX_ENTRIES))) {
    kept[id] = entries[id];
  }
  return kept;
}

let cache: Record<string, number> | null = null;
const listeners = new Set<() => void>();

function readAll(): Record<string, number> {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    cache = parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    // A corrupt or unreadable entry is not worth failing a screen over.
    cache = {};
  }
  return cache;
}

export function getLyricsOffset(trackId: string | undefined): number {
  if (!trackId) return 0;
  const value = readAll()[trackId];
  return typeof value === "number" ? value : 0;
}

export function setLyricsOffset(trackId: string, seconds: number): void {
  const next = { ...readAll() };
  const value = clampOffset(seconds);
  if (value === 0) delete next[trackId];
  else next[trackId] = value;

  cache = pruneOffsets(next);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Quota or a locked profile: the offset still applies for this session.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  const onChange = () => {
    // Another window wrote the key, so the in-memory copy is stale by definition.
    cache = null;
    listener();
  };
  listeners.add(listener);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onChange);
  };
}

export function useLyricsOffset(trackId: string | undefined): number {
  return useSyncExternalStore(
    subscribe,
    () => getLyricsOffset(trackId),
    () => 0,
  );
}
