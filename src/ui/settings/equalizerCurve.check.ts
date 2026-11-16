// Self-check for the equaliser curve maths (`npm run check`). A wrong coefficient draws a plausible, wrong curve.
import {
  autoPreampDb,
  CURVE_HZ,
  EQUALIZER_BANDS_HZ,
  EQUALIZER_PRESETS,
  EQUALIZER_STEP_DB,
  frequencyPosition,
  responseCurveDb,
  sameEqualizerCurve,
  snapGain,
} from "./equalizerCurve";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  check(Object.is(actual, expected), `${message}: expected ${String(expected)}, got ${String(actual)}`);
}

const LAST_POINT = CURVE_HZ.length - 1;
const pointAt = (hz: number) => Math.round(frequencyPosition(hz) * LAST_POINT);
const onlyBand = (band: number, gain: number) =>
  EQUALIZER_BANDS_HZ.map((_, index) => (index === band ? gain : 0));
const peakOf = (bandsDb: number[]) => Math.max(...responseCurveDb(bandsDb));

equal(snapGain(0.3), 0.5, "an off-step gain snaps to the nearest half");
equal(snapGain(0.2), 0, "and down as well as up");
equal(snapGain(99), 12, "a huge boost clamps to the ceiling");
equal(snapGain(-99), -12, "and a huge cut to the floor");
equal(snapGain(Number.NaN), 0, "NaN cannot reach Rust");
equal(snapGain(Number.POSITIVE_INFINITY), 0, "nor can Infinity");

// The pointer maths finds a band with `floor(x * 10)`, so each band must sit mid-column.
EQUALIZER_BANDS_HZ.forEach((hz, band) => {
  const offset = Math.abs(frequencyPosition(hz) - (band + 0.5) / EQUALIZER_BANDS_HZ.length);
  check(offset < 0.002, `${hz} Hz sits in the middle of column ${band} (off by ${offset})`);
});

check(
  responseCurveDb(EQUALIZER_BANDS_HZ.map(() => 0)).every((db) => db === 0),
  "a flat curve is exactly 0 dB everywhere, not merely close",
);

EQUALIZER_BANDS_HZ.forEach((hz, band) => {
  const boosted = responseCurveDb(onlyBand(band, 12));
  const atCentre = boosted[pointAt(hz)];
  check(Math.abs(atCentre - 12) < 0.05, `+12 dB at ${hz} Hz reads +12 at its centre, got ${atCentre}`);

  // A cut is the exact inverse filter, so its curve is the boost's mirror image.
  const cut = responseCurveDb(onlyBand(band, -12));
  check(
    cut.every((db, index) => Math.abs(db + boosted[index]) < 1e-9),
    `-12 dB at ${hz} Hz mirrors +12`,
  );
});

// One band must not move the far end of the spectrum.
const midBoost = responseCurveDb(onlyBand(5, 12));
check(midBoost[pointAt(62)] < 0.2, `1 kHz leaves 62 Hz alone, got ${midBoost[pointAt(62)]}`);
check(midBoost[pointAt(16000)] < 0.2, `1 kHz leaves 16 kHz alone, got ${midBoost[pointAt(16000)]}`);

// Overlap is why the real curve is drawn: two neighbours at +6 stack past +6.
check(peakOf(onlyBand(4, 6).map((db, band) => (band === 5 ? 6 : db))) > 7, "neighbouring boosts stack");

equal(autoPreampDb(EQUALIZER_BANDS_HZ.map(() => 0)), 0, "a flat curve needs no trim");
equal(autoPreampDb(onlyBand(3, 12)), -12, "a lone +12 is trimmed by exactly 12");
equal(autoPreampDb(EQUALIZER_BANDS_HZ.map(() => 12)), -12, "the trim clamps like any other gain");

for (const bandsDb of [
  [3, 1.5, 0, 0, 2, 0, 0, 0, 4.5, 1],
  [-6, -6, -6, -6, -6, -6, -6, -6, -6, -6],
  [0, 0, 0, -3, 0, 0, 0, 0, 0, 0],
]) {
  const preamp = autoPreampDb(bandsDb);
  const netPeak = peakOf(bandsDb) + preamp;
  equal(Math.abs(preamp % EQUALIZER_STEP_DB), 0, `auto preamp for [${bandsDb}] lands on a step`);
  check(netPeak <= 1e-9 && netPeak > -EQUALIZER_STEP_DB, `[${bandsDb}] peaks at 0 dB after trim, got ${netPeak}`);
}

// Built-ins: headroom-safe, on the grid, and uniquely named.
equal(EQUALIZER_PRESETS[0].name, "Flat", "Flat comes first");
check(
  EQUALIZER_PRESETS[0].settings.bandsDb.every((db) => db === 0) && EQUALIZER_PRESETS[0].settings.preampDb === 0,
  "Flat is flat",
);
check(
  new Set(EQUALIZER_PRESETS.map((preset) => preset.name.toLowerCase())).size === EQUALIZER_PRESETS.length,
  "built-in names are unique",
);
for (const { name, settings } of EQUALIZER_PRESETS) {
  check(settings.bandsDb.length === EQUALIZER_BANDS_HZ.length, `${name} has a gain per band`);
  check(settings.bandsDb.every((db) => snapGain(db) === db), `${name} sits on the gain grid`);
  const netPeak = peakOf(settings.bandsDb) + settings.preampDb;
  check(netPeak <= 1e-9, `${name} stays out of the limiter (peaks at ${netPeak.toFixed(2)} dB)`);
}

check(sameEqualizerCurve(EQUALIZER_PRESETS[1].settings, { ...EQUALIZER_PRESETS[1].settings }), "same curve");
check(
  !sameEqualizerCurve(EQUALIZER_PRESETS[1].settings, { ...EQUALIZER_PRESETS[1].settings, preampDb: 0 }),
  "a different preamp is a different curve",
);

console.log("equalizerCurve self-check passed");
