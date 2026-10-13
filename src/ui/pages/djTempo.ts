/**
 * Tempo maths for DJ Mode, kept free of React and Tauri so it can be checked on its own
 * (`djTempo.check.ts`). Everything here is arithmetic on three numbers per deck: the track's own
 * BPM, the tempo fader's percent offset, and the global playback rate (Settings' speed control,
 * which multiplies with the fader).
 */

/** Pitch-fader ranges, ± percent. 8 is a turntable's default; 50 is for matching distant tempos. */
export const TEMPO_RANGES = [8, 16, 50] as const;
export type TempoRange = (typeof TEMPO_RANGES)[number];
export const DEFAULT_TEMPO_RANGE: TempoRange = 8;

/**
 * Below this a measured BPM is shown as a guess, not a reading. Against synthetic music with a
 * known tempo, real rhythm scored 0.6-0.8 and white noise 0.06.
 */
export const RELIABLE_CONFIDENCE = 0.5;

/** The tempos worth offering: outside this, a number is a mistake, not music. */
export const MIN_BPM = 30;
export const MAX_BPM = 300;

/** The multiplier the engine wants for a fader percent: +5% is 1.05. */
export function tempoRatio(percent: number): number {
  return 1 + percent / 100;
}

export function clampPercent(percent: number, range: number): number {
  return Math.max(-range, Math.min(range, percent));
}

/** The BPM actually heard: the track's own, scaled by the global rate and the deck's fader. */
export function heardBpm(bpm: number, percent: number, globalRate = 1): number {
  return bpm * globalRate * tempoRatio(percent);
}

/** A BPM the person set (tap, half, double) wins over the measured one. */
export function resolveBpm(measured: number | null, override: number | undefined): number | null {
  return override ?? measured;
}

/** For when the measurement landed an octave high; leaves the BPM alone if halving would go silly. */
export function halveBpm(bpm: number): number {
  const half = bpm / 2;
  return half >= MIN_BPM ? half : bpm;
}

/** For when the measurement landed an octave low. */
export function doubleBpm(bpm: number): number {
  const twice = bpm * 2;
  return twice <= MAX_BPM ? twice : bpm;
}

const TAP_RESET_MS = 2000;
const TAP_KEEP = 8;

/**
 * Tap tempo. Taps further apart than two seconds start a fresh count; the BPM is the average
 * over everything kept, end to end — one wobbly tap moves it by a fraction of itself, where
 * averaging each gap separately would let it swing. Needs three taps (two gaps) to say anything.
 */
export function registerTap(taps: number[], now: number): { taps: number[]; bpm: number | null } {
  const last = taps[taps.length - 1];
  const continuing = last !== undefined && now - last <= TAP_RESET_MS ? taps : [];
  const next = [...continuing, now].slice(-TAP_KEEP);
  if (next.length < 3) return { taps: next, bpm: null };
  const interval = (next[next.length - 1] - next[0]) / (next.length - 1);
  const bpm = 60000 / interval;
  if (!(bpm >= MIN_BPM && bpm <= MAX_BPM)) return { taps: next, bpm: null };
  return { taps: next, bpm: Math.round(bpm * 10) / 10 };
}

export interface SyncResult {
  /** The fader position that gets there, clamped to the range. */
  percent: number;
  /** Which multiple of the target it matched: a 70 BPM track syncs to a 140 BPM one at ×0.5. */
  multiple: 0.5 | 1 | 2;
  /** False when the exact match needs more than the range allows; `percent` is then the nearest. */
  inRange: boolean;
}

/**
 * The fader percent that makes a deck whose track is `ownBpm` sound at `targetHeardBpm`.
 *
 * Considers the target as it is, doubled and halved and takes whichever needs the smallest move:
 * matching 70 BPM to 140 by dragging the fader +100% is never what anyone wants when ×2 lines the
 * beats up with a nudge.
 */
export function syncPercent(
  ownBpm: number,
  targetHeardBpm: number,
  range: number,
  globalRate = 1,
): SyncResult | null {
  if (!(ownBpm > 0) || !(targetHeardBpm > 0) || !(globalRate > 0)) return null;
  let best: { percent: number; multiple: 0.5 | 1 | 2 } | null = null;
  for (const multiple of [1, 2, 0.5] as const) {
    const percent = ((targetHeardBpm * multiple) / (ownBpm * globalRate) - 1) * 100;
    if (best === null || Math.abs(percent) < Math.abs(best.percent)) best = { percent, multiple };
  }
  if (best === null) return null;
  return {
    percent: clampPercent(best.percent, range),
    multiple: best.multiple,
    inRange: Math.abs(best.percent) <= range,
  };
}

/** Beat times, in seconds, across the track — for drawing the grid. */
export function beatTimes(firstBeatSec: number, bpm: number, durationSec: number, limit = 6000): number[] {
  if (!(bpm > 0) || !(durationSec > 0)) return [];
  const spacing = 60 / bpm;
  const beats: number[] = [];
  for (let time = firstBeatSec; time <= durationSec && beats.length < limit; time += spacing) {
    beats.push(time);
  }
  return beats;
}

export function formatBpm(bpm: number | null): string {
  return bpm === null ? "—" : bpm.toFixed(1);
}

export function formatPercent(percent: number): string {
  if (Math.abs(percent) < 0.05) return "0.0%";
  return `${percent > 0 ? "+" : ""}${percent.toFixed(1)}%`;
}

const MAX_SAVED_OVERRIDES = 500;

/** Reads saved BPM overrides, ignoring anything that is not a plausible BPM for a track id. */
export function parseBpmOverrides(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const result: Record<string, number> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isFinite(value) && value >= MIN_BPM && value <= MAX_BPM) {
        result[id] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/** Keeps the most recently set overrides: insertion order is recency, and the list is bounded. */
export function serializeBpmOverrides(overrides: Record<string, number>): string {
  const entries = Object.entries(overrides).slice(-MAX_SAVED_OVERRIDES);
  return JSON.stringify(Object.fromEntries(entries));
}
