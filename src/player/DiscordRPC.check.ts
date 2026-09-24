/**
 * Self-check for the presence dedupe key.
 *
 * `PlayerController.emit()` fires on every state change, most of which have nothing to do with
 * Discord. Getting the key wrong in either direction fails quietly: too narrow and a real track
 * change stops updating Discord, too wide and every queue reorder goes back to spamming an IPC
 * call for a payload that already matches what is showing.
 */
export {};

import { presenceDedupeKey, type DiscordPresenceData } from "./DiscordRPC";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

const base: DiscordPresenceData = {
  title: "Song",
  artist: "Artist",
  album: "Album",
  duration: 200,
  currentTime: 10,
  isPlaying: true,
};

// The whole point: currentTime alone must not change the key.
check(
  presenceDedupeKey(base) === presenceDedupeKey({ ...base, currentTime: 45 }),
  "currentTime is excluded from the key",
);

// Anything else changing has to produce a different key, or Discord never hears about it.
check(
  presenceDedupeKey(base) !== presenceDedupeKey({ ...base, title: "Other song" }),
  "title change is not deduped away",
);
check(
  presenceDedupeKey(base) !== presenceDedupeKey({ ...base, isPlaying: false }),
  "play/pause change is not deduped away",
);

console.log("DiscordRPC.check.ts passed");
