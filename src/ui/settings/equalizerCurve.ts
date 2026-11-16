// The equaliser as numbers: bands, limits, presets and the frequency response. Pure, so it can be checked.

/** ISO octave centres. Matches `BAND_HZ` in `equalizer.rs`. */
export const EQUALIZER_BANDS_HZ = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

/** Matches `MAX_GAIN_DB` in `equalizer.rs`, which clamps to the same range on the way in. */
export const EQUALIZER_MAX_DB = 12;

/** Every stored gain is a multiple of this. Halves are exact in binary, so curves compare with `===`. */
export const EQUALIZER_STEP_DB = 0.5;

export type EqualizerSettings = {
  preampDb: number;
  bandsDb: number[];
};

export type EqualizerPreset = { name: string; settings: EqualizerSettings };

/** Clamped to the range and snapped to the step. Anything that is not a number is 0 dB. */
export function snapGain(db: number): number {
  if (!Number.isFinite(db)) return 0;
  const clamped = Math.min(EQUALIZER_MAX_DB, Math.max(-EQUALIZER_MAX_DB, db));
  return Math.round(clamped / EQUALIZER_STEP_DB) * EQUALIZER_STEP_DB;
}

export function sameEqualizerCurve(a: EqualizerSettings, b: EqualizerSettings): boolean {
  return a.preampDb === b.preampDb && a.bandsDb.every((gain, index) => gain === b.bandsDb[index]);
}

/** Matches `BAND_Q` in `equalizer.rs`, so the curve drawn is the curve heard. */
const BAND_Q = 1.414_213_6;

/** Display only: the shapes barely move between 44.1 and 48 kHz. */
const SAMPLE_RATE = 48_000;

// Ten octaves from half an octave below the lowest band, so each band sits mid-column at (i + 0.5) / 10.
const LOWEST_HZ = 1000 * 2 ** -5.5;
const OCTAVES = 10;
const POINTS_PER_OCTAVE = 12;

/** Semitone steps: close enough that the sampled peak is within a hair of the true one. */
export const CURVE_HZ: readonly number[] = Array.from(
  { length: OCTAVES * POINTS_PER_OCTAVE + 1 },
  (_, index) => LOWEST_HZ * 2 ** (index / POINTS_PER_OCTAVE),
);

/** 0 at the graph's left edge, 1 at its right, on the log axis `CURVE_HZ` is spaced along. */
export function frequencyPosition(hz: number): number {
  return Math.log2(hz / LOWEST_HZ) / OCTAVES;
}

/** One peaking biquad's gain at `hz`, from the same RBJ coefficients `Biquad::peaking` builds. */
function peakingDb(centreHz: number, gainDb: number, hz: number): number {
  const amplitude = 10 ** (gainDb / 40);
  const omega = (2 * Math.PI * centreHz) / SAMPLE_RATE;
  const alpha = Math.sin(omega) / (2 * BAND_Q);
  const a0 = 1 + alpha / amplitude;
  const b0 = (1 + alpha * amplitude) / a0;
  const b1 = (-2 * Math.cos(omega)) / a0; // a1 is the same value for a peaking filter
  const b2 = (1 - alpha * amplitude) / a0;
  const a2 = (1 - alpha / amplitude) / a0;

  // |H(e^jw)|²: both polynomials evaluated on the unit circle.
  const w = (2 * Math.PI * hz) / SAMPLE_RATE;
  const [cos1, sin1, cos2, sin2] = [Math.cos(w), Math.sin(w), Math.cos(2 * w), Math.sin(2 * w)];
  const numerator = (b0 + b1 * cos1 + b2 * cos2) ** 2 + (b1 * sin1 + b2 * sin2) ** 2;
  const denominator = (1 + b1 * cos1 + a2 * cos2) ** 2 + (b1 * sin1 + a2 * sin2) ** 2;
  return 10 * Math.log10(numerator / denominator);
}

/** The bands' combined gain in dB at each of `CURVE_HZ`. Neighbours overlap, so two +6s peak above 6. */
export function responseCurveDb(bandsDb: readonly number[]): number[] {
  return CURVE_HZ.map((hz) =>
    bandsDb.reduce(
      (sum, gain, band) => (gain === 0 ? sum : sum + peakingDb(EQUALIZER_BANDS_HZ[band], gain, hz)),
      0,
    ),
  );
}

/**
 * The preamp that puts the curve's peak at 0 dB. Floored to a step so rounding only ever leaves
 * headroom; the epsilon stops float noise (12.000000001) costing a whole step.
 */
export function autoPreampDb(bandsDb: readonly number[]): number {
  const peak = Math.max(...responseCurveDb(bandsDb));
  return snapGain(Math.floor(-peak / EQUALIZER_STEP_DB + 1e-6) * EQUALIZER_STEP_DB);
}

// Preamps are derived, not hand-picked: the old ones ignored neighbouring bands stacking, so Bass ran 3 dB into the limiter.
const preset = (name: string, bandsDb: number[]): EqualizerPreset => ({
  name,
  settings: { preampDb: autoPreampDb(bandsDb), bandsDb },
});

export const EQUALIZER_PRESETS: readonly EqualizerPreset[] = [
  preset("Flat", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  preset("Bass", [6, 5, 4, 2, 0, 0, 0, 0, 0, 0]),
  preset("Warm", [2, 3, 3, 2, 1, 0, -1, -1, -2, -2]),
  preset("Vocal", [-2, -2, -1, 1, 3, 4, 3, 1, 0, 0]),
  preset("Treble", [0, 0, 0, 0, 0, 1, 2, 4, 5, 5]),
  preset("Loudness", [5, 4, 2, 0, -1, -1, 0, 2, 4, 4]),
];

export const EQUALIZER_FLAT: EqualizerSettings = EQUALIZER_PRESETS[0].settings;
