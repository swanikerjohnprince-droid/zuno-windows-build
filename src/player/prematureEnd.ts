/**
 * Did this track finish, or did its stream die?
 *
 * The audio engine reports "ended" for both, and the queue treats both as a finish — which is
 * how a track whose audio ran out after eight seconds came to look exactly like a three-minute
 * song completing, and playback advanced. Everything the caller needs to tell them apart is
 * how far through the track the audio stopped.
 *
 * A pure function so the boundaries are testable: the cases that matter here are an unknown
 * duration, a position past the end, and a crossfade that legitimately ends a track early by
 * exactly its own length.
 */
export function isPrematureEnd({
  durationSec,
  positionSec,
  crossfadeSec,
  toleranceSec,
}: {
  durationSec: number;
  positionSec: number;
  crossfadeSec: number;
  toleranceSec: number;
}): boolean {
  /*
   * An unknown or nonsense duration is not evidence of failure.
   *
   * A live stream reports 0, and an engine mid-swap can report `Infinity` or `NaN` for a beat.
   * Treating any of those as "ended early" would put the player into a reload on a track that
   * was fine, which is a worse failure than the one this exists to catch.
   */
  if (!Number.isFinite(durationSec) || durationSec <= 0) return false;
  if (!Number.isFinite(positionSec) || positionSec < 0) return false;

  const remaining = durationSec - positionSec;
  // Crossfade hands over early by design, so its length is added to the allowance rather than
  // being treated as a shortfall.
  return remaining > toleranceSec + Math.max(0, crossfadeSec);
}
