/**
 * Shallow prop comparison that ignores handler identity.
 *
 * For `memo` on components that are handed inline arrows by every call site. Comparing those
 * with `Object.is` means the memo never returns true and does nothing at all — which is what
 * `TrackRow` did for its whole life, rebuilding 500 rows to repaint two of them.
 *
 * Only safe for a component that invokes its handlers through a ref refreshed each render.
 * Skipping the comparison without that would leave a skipped row calling a closure over stale
 * state. The two halves of the pattern only work together.
 *
 * A function becoming `undefined` (or vice versa) is still a change: presence usually decides
 * whether an affordance renders at all.
 */
export function propsEqualIgnoringHandlers<P extends Record<string, unknown>>(
  previous: P,
  next: P,
): boolean {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);

  for (const key of keys) {
    const before = previous[key];
    const after = next[key];
    if (typeof before === "function" && typeof after === "function") continue;
    if (!Object.is(before, after)) return false;
  }
  return true;
}
