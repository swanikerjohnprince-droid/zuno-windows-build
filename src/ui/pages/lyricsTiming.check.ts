/**
 * Self-check for lyric line timing. No test runner in this project, so:
 *
 *   npx esbuild src/ui/pages/lyricsTiming.check.ts --bundle --platform=node --format=esm
 *     --outfile=check.mjs && node check.mjs
 *
 * This is the logic that decides which line is lit, and it runs on every animation frame
 * against provider data that is routinely half-formed. The cases below are the ones that
 * actually show up: unsynced text, a gap before the first line, and the last line running
 * to the end of the song.
 */
export {};

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  check(actual === expected, `${message}: expected ${String(expected)}, got ${String(actual)}`);
}

const { findActiveLineIndex, getLineProgress, isSyncedLyrics } = await import("./lyricsTiming");

const LINES = [
  { text: "first", startTimeSec: 10 },
  { text: "second", startTimeSec: 20 },
  { text: "third", startTimeSec: 30 },
];

equal(findActiveLineIndex(LINES, 0), -1, "before the first line nothing is lit");
equal(findActiveLineIndex(LINES, 9.99), -1, "still nothing a hair before the first start");
equal(findActiveLineIndex(LINES, 10), 0, "the first line lights exactly on its start");
equal(findActiveLineIndex(LINES, 19.9), 0, "it stays lit until the next one starts");
equal(findActiveLineIndex(LINES, 25), 1, "mid-song lands on the line that started last");
equal(findActiveLineIndex(LINES, 9_999), 2, "the last line holds to the end of the song");
equal(findActiveLineIndex([], 5), -1, "no lines means no active line");

// A line missing a start time stops the scan: past it the timings are meaningless, and
// guessing would slide the highlight onto the wrong words.
equal(
  findActiveLineIndex([{ text: "a", startTimeSec: 1 }, { text: "b" }, { text: "c", startTimeSec: 3 }], 5),
  0,
  "the scan stops at the first untimed line",
);

check(isSyncedLyrics({ lines: LINES, timing: "synced" }), "fully timed lines are synced");
check(
  isSyncedLyrics({ lines: LINES, timing: "estimated" }),
  "estimated timings still drive the highlight",
);
check(!isSyncedLyrics(null), "no lyrics are not synced");
check(!isSyncedLyrics({ lines: [], timing: "synced" }), "an empty line list is not synced");
check(
  !isSyncedLyrics({ lines: [{ text: "a" }, { text: "b" }], timing: "none" }),
  "plain text lyrics are not synced",
);
check(
  !isSyncedLyrics({ lines: [{ text: "a", startTimeSec: 1 }, { text: "b" }], timing: "synced" }),
  "one untimed line disqualifies the whole set, whatever the provider claims",
);

equal(getLineProgress(LINES, 0, 10), 0, "a line starts empty");
equal(getLineProgress(LINES, 0, 15), 0.5, "halfway to the next start is halfway through");
equal(getLineProgress(LINES, 0, 20), 1, "the next line's start fills the previous one");
equal(getLineProgress(LINES, 0, 5), 0, "before the start the sweep stays parked at zero");
equal(getLineProgress(LINES, 0, 99), 1, "and never runs past full");

// The last line has no successor: the track duration is what stops it finishing in four
// seconds and then sitting dead through a long outro.
equal(getLineProgress(LINES, 2, 60, 90), 0.5, "the final line spans to the end of the track");
equal(getLineProgress(LINES, 2, 32, undefined), 0.5, "without a duration it falls back to 4s");

equal(
  getLineProgress([{ text: "a", startTimeSec: 4, endTimeSec: 8 }], 0, 6),
  0.5,
  "an explicit end time wins over every fallback",
);
equal(
  getLineProgress([{ text: "a", startTimeSec: 5, endTimeSec: 5 }], 0, 5),
  1,
  "a zero-length line is already finished, not a divide by zero",
);
equal(getLineProgress([{ text: "a" }], 0, 5), 0, "an untimed line never sweeps");

console.log("lyricsTiming self-check passed");
