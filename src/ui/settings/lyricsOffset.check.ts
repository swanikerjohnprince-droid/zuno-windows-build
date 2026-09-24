/**
 * Self-check for the lyric offset store. No test runner in this project, so:
 *
 *   npx esbuild src/ui/settings/lyricsOffset.check.ts --bundle --platform=node --format=esm
 *     --outfile=check.mjs && node check.mjs
 *
 * The two pure pieces are what can silently rot: a clamp that lets float error accumulate
 * turns "+0.75s" into "+0.7500000000000001s" and never returns to zero, and a prune that
 * counts wrong grows the stored table without bound.
 */
export {};

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  },
});

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  check(actual === expected, `${message}: expected ${String(expected)}, got ${String(actual)}`);
}

const { OFFSET_STEP_SEC, clampOffset, getLyricsOffset, pruneOffsets, setLyricsOffset } =
  await import("./lyricsOffset");

equal(clampOffset(0), 0, "zero stays zero");
equal(clampOffset(0.25), 0.25, "a single step survives untouched");
equal(clampOffset(9), 5, "a huge positive offset clamps to the ceiling");
equal(clampOffset(-9), -5, "and a huge negative one to the floor");
equal(clampOffset(0.3), 0.25, "an off-grid value snaps to the nearest step");
equal(clampOffset(Number.NaN), 0, "NaN cannot poison the stored table");
equal(clampOffset(Number.POSITIVE_INFINITY), 0, "nor can Infinity");

// Three nudges of 0.25 must land exactly on 0.75, and three back must land exactly on 0 —
// binary floats do not, which is the whole reason clampOffset snaps.
let drift = 0;
for (let i = 0; i < 3; i += 1) drift = clampOffset(drift + OFFSET_STEP_SEC);
equal(drift, 0.75, "three nudges up land on an exact value");
for (let i = 0; i < 3; i += 1) drift = clampOffset(drift - OFFSET_STEP_SEC);
equal(drift, 0, "and three back return exactly to zero");

equal(
  Object.keys(pruneOffsets({ a: 0.5, b: 0, c: -0.25 })).length,
  2,
  "a zero offset is the default and is not stored",
);

const overflowing: Record<string, number> = {};
for (let i = 0; i < 250; i += 1) overflowing[`track-${i}`] = 0.5;
const pruned = pruneOffsets(overflowing);
equal(Object.keys(pruned).length, 200, "the table is capped");
equal(pruned["track-0"], undefined, "the oldest entry is the one dropped");
equal(pruned["track-249"], 0.5, "the newest entry is kept");

setLyricsOffset("song-1", 0.5);
equal(getLyricsOffset("song-1"), 0.5, "an offset round-trips through storage");
equal(getLyricsOffset("song-2"), 0, "an untouched track has no offset");
equal(getLyricsOffset(undefined), 0, "and neither does no track at all");

setLyricsOffset("song-1", 0);
equal(getLyricsOffset("song-1"), 0, "resetting to zero clears the entry");
check(!JSON.parse(store.get("lyrics-offset") ?? "{}")["song-1"], "and removes it from storage");

console.log("lyricsOffset self-check passed");
