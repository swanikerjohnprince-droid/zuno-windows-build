/**
 * Self-check for the store-selector comparator. Run with the whole suite:
 *
 *   npm run check
 *
 * Every narrowed store subscription in the UI runs through this. Getting it wrong in one
 * direction is an infinite render loop; in the other it is a component that silently stops
 * updating. Neither announces itself, so the edges are pinned here.
 */
export {};

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

const { shallowEqual } = await import("./shallowEqual");

const track = { id: "a" };

check(shallowEqual(1, 1), "identical primitives are equal");
check(!shallowEqual(1, 2), "different primitives are not");
check(shallowEqual(null, null), "null equals null");
check(!shallowEqual(null, {}), "null is not an empty object");
check(!shallowEqual({}, null), "and the reverse");
check(shallowEqual(undefined, undefined), "undefined equals undefined");

check(shallowEqual({ a: 1, b: "x" }, { a: 1, b: "x" }), "matching fields are equal");
check(!shallowEqual({ a: 1 }, { a: 2 }), "a changed field is not");
check(!shallowEqual({ a: 1 }, { a: 1, b: 2 }), "an extra field is not");
check(!shallowEqual({ a: 1, b: 2 }, { a: 1 }), "nor a missing one");

// The real selector case: the state object is new, the selected track is the same reference.
check(
  shallowEqual({ currentTrack: track, status: "playing" }, { currentTrack: track, status: "playing" }),
  "a new wrapper around the same references is equal — this is what stops the re-render",
);
check(
  !shallowEqual({ currentTrack: track, status: "playing" }, { currentTrack: track, status: "paused" }),
  "but a real change still gets through",
);

// One level deep, on purpose: a nested object is compared by reference.
check(
  !shallowEqual({ track: { id: "a" } }, { track: { id: "a" } }),
  "equal-looking nested objects are not equal, because this does not recurse",
);

// NaN is the classic trap: `===` says no, `Object.is` says yes, and a position or volume
// field can genuinely be NaN.
check(shallowEqual({ v: Number.NaN }, { v: Number.NaN }), "NaN equals NaN");
check(!shallowEqual({ v: 0 }, { v: -0 }), "0 and -0 are distinguished");

// A key present but undefined is not the same shape as a key that is absent.
check(!shallowEqual({ a: undefined }, {}), "an explicit undefined is not an absent key");

check(!shallowEqual([1, 2], { 0: 1, 1: 2 }), "an array is never equal to a plain object");
check(shallowEqual([1, 2], [1, 2]), "arrays compare element-wise");
check(!shallowEqual([1, 2], [1, 2, 3]), "including their length");

console.log("shallowEqual self-check passed");
