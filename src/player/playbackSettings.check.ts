/**
 * Self-check for playback settings persistence. Run with the whole suite:
 *
 *   npm run check
 *
 * `savePlaybackSettings` normalizes with `?? default`, which means an absent field is written
 * as its default rather than left alone — a partial save is a silent reset of everything it
 * did not mention. Three call sites in `PlayerController` passed `{ volume, muted }`, so
 * nudging the volume slider wrote playbackRate 1, crossfade 0 and gapless true over whatever
 * the listener had chosen, and nothing anywhere reported it.
 *
 * This pins the behaviour that makes that a trap, so the next person to add a call site finds
 * it written down instead of discovering it through a support thread.
 */
export {};

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  },
  window: { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} },
});

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  check(actual === expected, `${message}: expected ${String(expected)}, got ${String(actual)}`);
}

const { readPlaybackSettings, savePlaybackSettings } =
  (await import("./playbackSettings")) as typeof import("./playbackSettings");

// A listener who has set up crossfade and a slower playback rate.
savePlaybackSettings({
  volume: 0.8,
  muted: false,
  playbackRate: 1.25,
  crossfadeSec: 6,
  gaplessEnabled: false,
});

const stored = readPlaybackSettings();
equal(stored.volume, 0.8, "volume round-trips");
equal(stored.playbackRate, 1.25, "playbackRate round-trips");
equal(stored.crossfadeSec, 6, "crossfadeSec round-trips");
equal(stored.gaplessEnabled, false, "gaplessEnabled round-trips");

/*
 * The trap itself. This is asserted as *current behaviour*, not as desirable behaviour: the
 * fix was to stop calling it this way, not to make an absent field mean "keep". If this ever
 * changes to a merge, this check should fail loudly enough to be reconsidered on purpose.
 */
savePlaybackSettings({ volume: 0.3, muted: false });
const clobbered = readPlaybackSettings();
equal(clobbered.playbackRate, 1, "a partial save resets playbackRate to the default");
equal(clobbered.crossfadeSec, 0, "a partial save resets crossfadeSec to the default");
equal(clobbered.gaplessEnabled, true, "a partial save resets gaplessEnabled to the default");

// The shape every caller is expected to build: read, spread, override.
savePlaybackSettings({ ...readPlaybackSettings(), crossfadeSec: 9 });
savePlaybackSettings({ ...readPlaybackSettings(), volume: 0.5 });
const merged = readPlaybackSettings();
equal(merged.volume, 0.5, "the read-spread-override shape keeps the new value");
equal(merged.crossfadeSec, 9, "the read-spread-override shape keeps the older value");

// Out-of-range input is clamped rather than stored: volume feeds the engine directly.
savePlaybackSettings({ ...readPlaybackSettings(), volume: 4 });
equal(readPlaybackSettings().volume, 1, "volume is clamped to 1");
savePlaybackSettings({ ...readPlaybackSettings(), volume: -2 });
equal(readPlaybackSettings().volume, 0, "volume is clamped to 0");

console.log("playbackSettings: ok");
