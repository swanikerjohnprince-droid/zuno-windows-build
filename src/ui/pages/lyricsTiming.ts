import type { LyricLine, Lyrics } from "../../datasource/types";

/**
 * Whether a set of lines can drive a karaoke highlight.
 *
 * Derived from the lines themselves rather than trusting `timing`: providers disagree about
 * the field (LRCLIB says "synced", a TTML parse may leave gaps), and a single line without a
 * start time is enough to make the highlight jump backwards.
 */
export function isSyncedLyrics(lyrics: Lyrics | null): boolean {
  const lines = lyrics?.lines;
  if (!lines?.length) return false;
  if (lyrics?.timing === "none") return false;
  return lines.every((line) => typeof line.startTimeSec === "number");
}

/**
 * Index of the line that should be lit at `timeSec`, or -1 before the first one starts.
 *
 * A plain forward scan: lyric line counts are in the low hundreds and this runs once per
 * animation frame, so a binary search would buy nothing but an off-by-one to debug at 3am.
 */
/** Assumed length of a line with nothing after it to bound it. */
const FALLBACK_LINE_SEC = 4;

/**
 * How far playback is through line `index`, 0 to 1.
 *
 * Drives the sweep across the active line. The end is taken from whatever the provider
 * actually gave us, in descending order of trust: an explicit end, the next line's start,
 * the track duration for the final line, and only then a flat guess — the last line of a
 * song is routinely the one that has to hold for thirty seconds of outro.
 */
export function getLineProgress(
  lines: LyricLine[],
  index: number,
  timeSec: number,
  trackDurationSec?: number,
): number {
  const line = lines[index];
  const start = line?.startTimeSec;
  if (start === undefined) return 0;

  const isLast = index === lines.length - 1;
  const end = line.endTimeSec
    ?? lines[index + 1]?.startTimeSec
    ?? (isLast ? trackDurationSec : undefined)
    ?? start + FALLBACK_LINE_SEC;

  if (end <= start) return 1;
  return Math.min(1, Math.max(0, (timeSec - start) / (end - start)));
}

export function findActiveLineIndex(lines: LyricLine[], timeSec: number): number {
  let active = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const start = lines[index]?.startTimeSec;
    if (start === undefined || timeSec < start) break;
    active = index;
  }
  return active;
}
