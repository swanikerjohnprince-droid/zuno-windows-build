"use client";

import { useSyncExternalStore } from "react";

/**
 * Returns true only on devices that have a true hover (mouse / trackpad).
 * Touch devices fire phantom `:hover` on tap that sticks until tap-elsewhere
 * — gate hover-only effects (scale lifts, magnetic pulls) behind this.
 *
 * One `MediaQueryList` for the whole app, at module scope. This is called once per card, and
 * a grid of fifty albums was building fifty `matchMedia` objects with fifty `change`
 * listeners. The old shape also started at `false` and corrected itself in an effect, so every
 * one of those cards rendered twice on mount and any subtree gated on the result was built,
 * thrown away and built again. `useSyncExternalStore` reads the real value on the first render
 * instead.
 */
const QUERY = "(hover: hover) and (pointer: fine)";
const hoverQuery = typeof window !== "undefined" && window.matchMedia
  ? window.matchMedia(QUERY)
  : null;

function subscribe(callback: () => void) {
  hoverQuery?.addEventListener("change", callback);
  return () => hoverQuery?.removeEventListener("change", callback);
}

function getSnapshot() {
  return hoverQuery?.matches ?? false;
}

export function useHoverCapable() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
