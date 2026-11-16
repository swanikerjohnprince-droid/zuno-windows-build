/**
 * Self-check for DJ Mode's tempo maths (`npm run check`).
 *
 * The cases that matter are the ones where a plausible-looking answer is wrong: syncing a slow
 * track to a fast one by dragging the fader +100% instead of doubling, a tap tempo that one late
 * tap throws off, a BPM readout that forgets the global speed setting.
 */
export {};

import {
  beatTimes,
  clampPercent,
  doubleBpm,
  formatBpm,
  formatPercent,
  halveBpm,
  heardBpm,
  parseBpmOverrides,
  registerTap,
  resolveBpm,
  serializeBpmOverrides,
  syncPercent,
  tempoRatio,
} from "./djTempo";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}
function near(actual: number, expected: number, tolerance: number, message: string): void {
  check(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`);
}

// --- the fader and what is heard ---------------------------------------------------------------
near(tempoRatio(0), 1, 1e-12, "no offset is unity");
near(tempoRatio(5), 1.05, 1e-12, "+5% is 1.05");
near(tempoRatio(-8), 0.92, 1e-12, "-8% is 0.92");
near(clampPercent(20, 8), 8, 0, "clamps above the range");
near(clampPercent(-20, 8), -8, 0, "clamps below the range");
near(heardBpm(120, 5), 126, 1e-9, "+5% on 120 is 126");
near(heardBpm(120, 5, 1.25), 157.5, 1e-9, "the global speed setting multiplies with the fader");

// --- measured vs set by hand -------------------------------------------------------------------
check(resolveBpm(128, undefined) === 128, "the measurement is used when nothing was set");
check(resolveBpm(128, 64) === 64, "a BPM set by hand wins over the measurement");
check(resolveBpm(null, 90) === 90, "a BPM set by hand fills in when nothing was measured");
check(resolveBpm(null, undefined) === null, "nothing measured and nothing set is nothing");
near(halveBpm(174), 87, 0, "halves");
near(doubleBpm(87), 174, 0, "doubles");
near(halveBpm(50), 50, 0, "does not halve into a nonsense tempo");
near(doubleBpm(200), 200, 0, "does not double into a nonsense tempo");

// --- sync ---------------------------------------------------------------------------------------
const close = syncPercent(128, 126, 8);
check(close !== null && close.multiple === 1, "128 -> 126 matches directly");
near(close!.percent, (126 / 128 - 1) * 100, 1e-9, "128 -> 126 is about -1.56%");
check(close!.inRange, "a small move is in range");

const slow = syncPercent(70, 140, 8);
check(slow !== null && slow.multiple === 0.5, "70 against 140 matches at half the target, not by moving the fader 100%");
near(slow!.percent, 0, 1e-9, "70 against 140 needs no move at all");

const fast = syncPercent(174, 87, 8);
check(fast !== null && fast.multiple === 2, "174 against 87 matches at double the target");
near(fast!.percent, 0, 1e-9, "174 against 87 needs no move at all");

const far = syncPercent(100, 128, 8);
check(far !== null && !far.inRange, "100 -> 128 is out of an 8% range");
near(far!.percent, 8, 1e-9, "out of range gives the nearest the fader can reach");
const wide = syncPercent(100, 128, 50);
check(wide !== null && wide.inRange, "the same sync is in range on +-50%");
near(wide!.percent, 28, 1e-9, "100 -> 128 is +28%");

const withGlobal = syncPercent(120, 120, 50, 1.25);
near(withGlobal!.percent, -20, 1e-9, "a deck already running 1.25x is slowed to meet the other");
check(withGlobal!.inRange, "-20% is in range on +-50%");
const withGlobalNarrow = syncPercent(120, 120, 8, 1.25);
near(withGlobalNarrow!.percent, -8, 1e-9, "on +-8% the same sync stops at the end of the fader");
check(!withGlobalNarrow!.inRange, "and says it could not get there");
check(syncPercent(0, 120, 8) === null && syncPercent(120, 0, 8) === null, "no BPM, no sync");

// --- tap tempo ----------------------------------------------------------------------------------
let tap = registerTap([], 1000);
check(tap.bpm === null, "one tap says nothing");
tap = registerTap(tap.taps, 1500);
check(tap.bpm === null, "two taps say nothing");
tap = registerTap(tap.taps, 2000);
near(tap.bpm ?? 0, 120, 0.01, "taps 500 ms apart are 120 BPM");
tap = registerTap(tap.taps, 2500);
tap = registerTap(tap.taps, 3000);
near(tap.bpm ?? 0, 120, 0.01, "stays at 120 as the taps continue");
const wobble = registerTap(tap.taps, 3540);
// 40 ms late, spread across five gaps, is 8 ms per gap: 1.6%, i.e. 118.1. A per-gap average would
// have read the late gap as 108 and the next as 140.
near(wobble.bpm ?? 0, 120, 2.5, "one tap 40 ms late moves it by under two BPM");
const restarted = registerTap(wobble.taps, 3540 + 2500);
check(restarted.taps.length === 1 && restarted.bpm === null, "a pause of over two seconds starts a fresh count");
let long: number[] = [];
for (let i = 0; i < 20; i += 1) long = registerTap(long, i * 400).taps;
check(long.length === 8, "only the last eight taps are kept");
// The two-second reset means the slowest reachable tempo is 30 BPM; just inside it still counts.
let slowTaps = registerTap([], 0);
slowTaps = registerTap(slowTaps.taps, 1900);
slowTaps = registerTap(slowTaps.taps, 3800);
near(slowTaps.bpm ?? 0, 31.6, 0.05, "taps 1.9 s apart are a slow but real 31.6 BPM");
// Mashing the pad far faster than any music is a double-tap bounce, not a tempo.
let mashed = registerTap([], 0);
mashed = registerTap(mashed.taps, 100);
mashed = registerTap(mashed.taps, 200);
check(mashed.bpm === null, "taps 100 ms apart (600 BPM) are not offered as a tempo");

// --- the beat grid ------------------------------------------------------------------------------
const grid = beatTimes(0.25, 120, 10);
near(grid[0], 0.25, 0, "the grid starts at the first beat");
near(grid[1] - grid[0], 0.5, 1e-9, "120 BPM is a beat every half second");
check(grid.length === 20, "twenty beats fit in ten seconds from 0.25");
check(beatTimes(0, 0, 10).length === 0, "no grid without a tempo");
check(beatTimes(0, 128, 100000, 50).length === 50, "the grid is bounded");

// --- display ------------------------------------------------------------------------------------
check(formatBpm(127.96) === "128.0", "BPM shows one decimal");
check(formatBpm(null) === "—", "no BPM shows a dash");
check(formatPercent(1.234) === "+1.2%", "positive percent is signed");
check(formatPercent(-3) === "-3.0%", "negative percent keeps its sign");
check(formatPercent(0.01) === "0.0%", "a hair off zero reads as zero, not +0.0%");
check(formatPercent(-0.02) === "0.0%", "and not -0.0%");

// --- saved overrides ----------------------------------------------------------------------------
check(Object.keys(parseBpmOverrides(null)).length === 0, "nothing saved is nothing");
check(Object.keys(parseBpmOverrides("not json")).length === 0, "corrupt storage is ignored, not thrown");
check(Object.keys(parseBpmOverrides("[1,2]")).length === 0, "an array is not an override map");
const parsed = parseBpmOverrides('{"a":128,"b":"fast","c":5,"d":999,"e":null}');
check(parsed.a === 128 && Object.keys(parsed).length === 1, "only plausible numeric BPMs survive");
const many: Record<string, number> = {};
for (let i = 0; i < 700; i += 1) many[`t${i}`] = 100 + (i % 50);
const kept = parseBpmOverrides(serializeBpmOverrides(many));
check(Object.keys(kept).length === 500, "saved overrides are bounded");
check("t699" in kept && !("t0" in kept), "the most recent overrides are the ones kept");

console.log("djTempo checks passed");
