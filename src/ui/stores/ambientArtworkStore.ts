import { useSyncExternalStore } from "react";

/**
 * Artwork the current page wants the app chrome tinted by.
 *
 * The wash has to start above the search bar, but the page that knows the artwork renders
 * *below* it, inside a scroll container that clips. Rather than drill the URL up through
 * Layout's props, the page publishes it here and Layout subscribes — the same
 * `useSyncExternalStore` pattern the player and settings stores already use.
 */
let ambientArtworkUrl: string | null = null;
const listeners = new Set<() => void>();

export function setAmbientArtwork(url: string | null): void {
  const next = url ?? null;
  if (next === ambientArtworkUrl) return;
  ambientArtworkUrl = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): string | null {
  return ambientArtworkUrl;
}

export function useAmbientArtwork(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
