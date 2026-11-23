import { createContext, useContext, type CSSProperties } from "react";

/**
 * Geometry of the "browse half" while Split Mode is on: the left/top section that holds the
 * search bar and the YouTube Music / files pages, as opposed to the DJ panel half.
 *
 * Popups that belong to the browse half (search overlay, dialogs, scrims) read this through
 * `usePopupBounds` and confine themselves to this rect instead of covering the whole window —
 * in Split Mode a full-window scrim would paint over the DJ decks, which have nothing to do
 * with the search. Null whenever Split Mode is off, in which case popups use the full window
 * exactly as before.
 */
export interface PopupBounds {
  top: number;
  left: number;
  width: number;
  height: number;
}

export const PopupBoundsContext = createContext<PopupBounds | null>(null);

export function usePopupBounds(): PopupBounds | null {
  return useContext(PopupBoundsContext);
}

/**
 * Inline style for a `fixed inset-0` scrim, confined to the browse half when Split Mode is on.
 *
 * The class sets all four offsets to 0; the inline `top/left/width/height` win, and `right`/
 * `bottom` are reset to auto so the box is not left over-constrained (which browsers resolve
 * by ignoring `right`/`bottom` in LTR anyway — explicit is just clearer).
 */
export function popupScrimStyle(bounds: PopupBounds | null): CSSProperties | undefined {
  if (!bounds) return undefined;
  return {
    top: bounds.top,
    left: bounds.left,
    width: bounds.width,
    height: bounds.height,
    right: "auto",
    bottom: "auto",
  };
}

interface PopupRegion {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function toRegion(rect: { left: number; top: number; width: number; height: number }): PopupRegion {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
  };
}

/**
 * The two halves of Split Mode, read straight off the DOM. The Layout tags the browse section
 * with `data-split-browse` and the DJ panel with `data-split-panel`; App mirrors the mode on
 * `documentElement.dataset.splitMode` so this works outside React too (clamp callbacks).
 */
function splitRegions(): { browse: PopupRegion; panel: PopupRegion } | null {
  if (typeof document === "undefined") return null;
  if (document.documentElement.dataset.splitMode !== "true") return null;
  const browse = document.querySelector<HTMLElement>("[data-split-browse]");
  const panel = document.querySelector<HTMLElement>("[data-split-panel]");
  if (!browse || !panel) return null;
  return { browse: toRegion(browse.getBoundingClientRect()), panel: toRegion(panel.getBoundingClientRect()) };
}

/**
 * Clamps a pointer-anchored popup (context menu) so it stays inside the half it was opened in:
 * inside the DJ panel rect it stays in the DJ panel, anywhere else in Split Mode it stays in
 * the browse half, and with Split Mode off it is clamped to the window as before.
 */
export function clampPopupPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  margin = 8,
): { x: number; y: number } {
  const regions = splitRegions();
  let region: PopupRegion;
  if (regions) {
    const inPanel =
      x >= regions.panel.left - margin
      && x <= regions.panel.right + margin
      && y >= regions.panel.top - margin
      && y <= regions.panel.bottom + margin;
    region = inPanel ? regions.panel : regions.browse;
  } else {
    region = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  }
  const clampedX = Math.max(
    region.left + margin,
    Math.min(x, region.right - width - margin),
  );
  const clampedY = Math.max(
    region.top + margin,
    Math.min(y, region.bottom - height - margin),
  );
  return { x: clampedX, y: clampedY };
}

/**
 * Position for a bottom-centred toast, moved into the browse half in Split Mode. Without
 * bounds the `left-1/2 bottom-28` classes apply unchanged.
 */
export function popupToastStyle(bounds: PopupBounds | null): CSSProperties | undefined {
  if (!bounds) return undefined;
  return {
    left: bounds.left + bounds.width / 2,
    bottom: Math.max(24, window.innerHeight - bounds.top - bounds.height + 24),
  };
}

/**
 * Position for a bottom-right toast (the update notice), moved into the browse half in Split
 * Mode. Without bounds the `right-5 bottom-28` classes apply unchanged.
 */
export function popupCornerToastStyle(bounds: PopupBounds | null): CSSProperties | undefined {
  if (!bounds) return undefined;
  return {
    right: Math.max(20, window.innerWidth - bounds.left - bounds.width + 20),
    bottom: Math.max(24, window.innerHeight - bounds.top - bounds.height + 24),
  };
}
