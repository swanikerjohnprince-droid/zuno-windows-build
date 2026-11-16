/**
 * Self-check for premature-end detection. Run with the whole suite:
 *
 *   npm run check
 *
 * Both directions of this are user-visible and neither reports itself. Too strict and a track
 * that really finished gets reloaded and replayed from near its end; too loose and the bug it
 * exists to catch comes back — every song playing for a few seconds and skipping, because a
 * preloaded deck held only its first chunk and the queue read the short audio as a finish.
 */
export {};

import { isPrematureEnd } from "./prematureEnd";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

const TOLERANCE = 5;

function premature(
  durationSec: number,
  positionSec: number,
  crossfadeSec = 0,
): boolean {
  return isPrematureEnd({ durationSec, positionSec, crossfadeSec, toleranceSec: TOLERANCE });
}

// The observed failure: 167.9s track, audio exhausted at 8s.
check(premature(167.901, 8), "a track that stopped 160s short is a failure, not a finish");

// The ordinary case, and the one that must never trigger a reload.
check(!premature(167.901, 167.9), "a track that reached its end is a finish");
check(!premature(167.901, 166), "ending a second or two short is still a finish");
check(!premature(167.901, 163), "exactly at the tolerance is still a finish");
check(premature(167.901, 162.8), "just past the tolerance is a failure");

/*
 * Crossfade hands over early by design. Without its length in the allowance, every single
 * transition on a crossfaded queue would be read as a failed stream and reloaded — turning a
 * working feature into an unplayable one.
 */
check(!premature(200, 188, 12), "a 12s crossfade ending 12s early is a finish");
check(premature(200, 180, 12), "past crossfade plus tolerance is still a failure");
check(!premature(200, 195, 0), "no crossfade, ended within tolerance");

/*
 * Unknown or nonsense durations. An engine mid-swap and a live stream both land here, and
 * guessing "failed" would reload a track that was playing fine.
 */
check(!premature(0, 8), "an unknown duration is not evidence of failure");
check(!premature(Number.NaN, 8), "NaN duration is not evidence of failure");
check(!premature(Number.POSITIVE_INFINITY, 8), "an endless stream never ends prematurely");
check(!premature(-1, 0), "a negative duration is not evidence of failure");
check(!premature(167.901, Number.NaN), "NaN position is not evidence of failure");
check(!premature(167.901, -3), "a negative position is not evidence of failure");

// A position past the end reports a negative remaining, which must read as finished.
check(!premature(167.901, 180), "a position past the end is a finish");

console.log("prematureEnd: ok");
