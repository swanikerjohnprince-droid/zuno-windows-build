/**
 * Self-check for `isEmbedRestrictedPlaybackError`, the switch that decides whether an IFrame
 * playback failure is the one kind worth retrying on native audio (owner disabled embedding)
 * versus every other kind (network hiccup, removed video, ...) where retrying elsewhere would
 * just fail the same way. Run via `npm run check`.
 */
export {};

import { deckSpeed, deckTempoTargets, isEmbedRestrictedPlaybackError } from "./AudioEngine";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

function sameTargets(actual: string[], expected: string[], message: string): void {
  check(
    actual.length === expected.length && actual.every((target, index) => target === expected[index]),
    `${message} (got ${actual.join(",") || "none"}, wanted ${expected.join(",") || "none"})`,
  );
}

check(
  isEmbedRestrictedPlaybackError(new Error("YouTube player error 150")),
  "150 is the owner-disabled-embedding code",
);
check(
  isEmbedRestrictedPlaybackError(new Error("YouTube player error 101")),
  "101 is 150's alias",
);
check(
  !isEmbedRestrictedPlaybackError(new Error("YouTube player error 100")),
  "100 (video removed/private) is not embed-restriction and should not be retried",
);
check(
  !isEmbedRestrictedPlaybackError(new Error("YouTube player error 2")),
  "2 (invalid parameter) is not embed-restriction",
);
check(
  !isEmbedRestrictedPlaybackError(new Error("Some other failure")),
  "unrelated error messages don't match",
);
check(!isEmbedRestrictedPlaybackError("YouTube player error 150"), "non-Error values don't match");
check(!isEmbedRestrictedPlaybackError(null), "null doesn't throw or match");

/*
 * The tempo fader. The bug this guards against: the fader was only ever sent to the Rust deck,
 * so on a track Rust refused — which plays on the YouTube IFrame deck instead — the slider moved
 * a number and the track played on at its own speed.
 */
const noDecks = { rustActive: false, rustStandby: false, native: false, iframe: false };

sameTargets(deckTempoTargets(noDecks), [], "with nothing loaded there is no deck to tell");
sameTargets(
  deckTempoTargets({ ...noDecks, rustActive: true }),
  ["rust"],
  "a track on the Rust deck is told through Rust",
);
sameTargets(
  deckTempoTargets({ ...noDecks, rustStandby: true }),
  ["rust"],
  "a track cued on the Rust standby deck is told through Rust",
);
sameTargets(
  deckTempoTargets({ ...noDecks, native: true }),
  ["native"],
  "a track on the <audio> element is told through the element",
);
sameTargets(
  deckTempoTargets({ ...noDecks, iframe: true }),
  ["iframe"],
  "a track on the YouTube deck is told through the player",
);
sameTargets(
  deckTempoTargets({ ...noDecks, iframe: true, rustStandby: true }),
  ["rust", "iframe"],
  "a fallback track on the YouTube deck and a cued Rust track are both told",
);

/* The speed a deck plays at: the global rate with the fader on top of it, as Rust computes it. */
check(deckSpeed(1, 1) === 1, "a deck at 1 with the rate at 1 plays at 1");
check(Math.abs(deckSpeed(1, 1.05) - 1.05) < 1e-9, "the fader multiplies the global rate");
check(Math.abs(deckSpeed(1.5, 1.05) - 1.575) < 1e-9, "the global rate multiplies the fader");
check(deckSpeed(0.1, 0.5) === 0.25, "the speed is clamped at the bottom");
check(deckSpeed(4, 2) === 4, "the speed is clamped at the top");

// eslint-disable-next-line no-console
console.log("AudioEngine.check.ts passed");
