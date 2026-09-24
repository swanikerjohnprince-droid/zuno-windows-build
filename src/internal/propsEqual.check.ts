/**
 * Self-check for the handler-ignoring prop comparison. Run with the whole suite:
 *
 *   npm run check
 *
 * This decides whether a row re-renders. Too loose and lists go stale in ways nobody
 * connects back to a comparator; too strict and the memo it exists to enable does nothing
 * again. Both failures are silent, so the edges are pinned here.
 */
export {};

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

const { propsEqualIgnoringHandlers } = await import("./propsEqual");

const track = { id: "a", title: "Song" };

check(propsEqualIgnoringHandlers({}, {}), "no props is no difference");
check(propsEqualIgnoringHandlers({ index: 3 }, { index: 3 }), "equal primitives are equal");
check(!propsEqualIgnoringHandlers({ index: 3 }, { index: 4 }), "changed primitives are not");

// The whole point: a fresh arrow every render must not count as a change.
check(
  propsEqualIgnoringHandlers(
    { track, isCurrent: true, onSelect: () => {} },
    { track, isCurrent: true, onSelect: () => {} },
  ),
  "two different arrow instances compare as equal — this is what makes the memo work",
);

// ...but only their identity is ignored, never their presence.
check(
  !propsEqualIgnoringHandlers({ onQuickAdd: () => {} }, { onQuickAdd: undefined }),
  "a handler disappearing is a real change: presence decides whether an affordance renders",
);
check(
  !propsEqualIgnoringHandlers({ onQuickAdd: undefined }, { onQuickAdd: () => {} }),
  "and so is one appearing",
);

// Real props still gate the render.
check(
  !propsEqualIgnoringHandlers(
    { track, isPlaying: false, onSelect: () => {} },
    { track, isPlaying: true, onSelect: () => {} },
  ),
  "a state change still gets through alongside handlers",
);
check(
  !propsEqualIgnoringHandlers(
    { track, onSelect: () => {} },
    { track: { id: "b", title: "Other" }, onSelect: () => {} },
  ),
  "a different track object is a change",
);

// Keys present on only one side, in either direction.
check(!propsEqualIgnoringHandlers({ a: 1 }, { a: 1, b: 2 }), "an added prop is a change");
check(!propsEqualIgnoringHandlers({ a: 1, b: 2 }, { a: 1 }), "a removed prop is a change");

// Content props are deliberately still compared: fresh JSX means a real re-render.
check(
  !propsEqualIgnoringHandlers({ trailing: { type: "span" } }, { trailing: { type: "span" } }),
  "equal-looking elements are not equal — content is compared by reference, not skipped",
);

check(propsEqualIgnoringHandlers({ v: Number.NaN }, { v: Number.NaN }), "NaN equals NaN");
check(!propsEqualIgnoringHandlers({ v: 0 }, { v: -0 }), "0 and -0 are distinguished");

console.log("propsEqual self-check passed");
