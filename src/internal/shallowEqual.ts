/**
 * Field-by-field comparison, one level deep.
 *
 * Exists for store selectors that build a fresh object on every call. `useSyncExternalStore`
 * compares snapshots with `Object.is` and calls the getter more than once per render, so
 * without this a selector returning `{ a, b }` would look changed every single time — an
 * infinite render loop, not merely a slow one.
 *
 * Its own module, free of imports, so it can be checked without dragging the player store —
 * and the entire data source behind it — into a Node process.
 */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  // Arrays and plain objects compare differently enough that mixing them is always a miss.
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;

  return keys.every(
    // `in` as well as the value: a missing key and a key set to undefined are not the same
    // object, and treating them as equal hides a selector that stopped selecting something.
    (key) => Object.prototype.hasOwnProperty.call(right, key) && Object.is(left[key], right[key]),
  );
}
