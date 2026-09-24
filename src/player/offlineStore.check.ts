/**
 * Self-check for download reconciliation. No test runner in this project, so:
 *
 *   npx esbuild src/player/offlineStore.check.ts --bundle --platform=node --format=esm
 *     --outfile=check.mjs && node check.mjs
 *
 * The branch worth pinning is the orphan sweep, because it deletes files and nothing undoes it.
 * A cleared manifest against a full disk has to be treated as a lost manifest, not as proof
 * that the user has no downloads.
 */
export {};

import { reconcileManifest, type OfflineEntry } from "./offlineStore";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  check(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

const entry = (id: string, byteLength: number): OfflineEntry => ({
  track: { id, title: id, artists: [], source: "youtube" } as unknown as OfflineEntry["track"],
  byteLength,
  downloadedAt: 1,
});

const manifest = { a: entry("a", 100), b: entry("b", 200) };

// Disk is the authority on size: a stale manifest length is corrected, not trusted.
const matched = reconcileManifest(manifest, [
  { trackId: "a", byteLength: 111 },
  { trackId: "b", byteLength: 200 },
]);
equal(Object.keys(matched.entries), ["a", "b"], "every downloaded track survives");
equal(matched.entries.a.byteLength, 111, "byte length comes from disk");
equal(matched.orphans, [], "nothing to sweep when the two agree");

// A file that vanished cannot be offered for playback.
const missingFile = reconcileManifest(manifest, [{ trackId: "a", byteLength: 100 }]);
equal(Object.keys(missingFile.entries), ["a"], "an entry with no file is dropped");
equal(missingFile.orphans, [], "and dropping it does not make the survivor an orphan");

// A file nobody tracks is unplayable — no title, no artist — so it goes.
const extraFile = reconcileManifest({ a: entry("a", 100) }, [
  { trackId: "a", byteLength: 100 },
  { trackId: "ghost", byteLength: 999 },
]);
equal(extraFile.orphans, ["ghost"], "an untracked file is swept when a manifest exists");

// The regression this exists for: local storage cleared, gigabytes still on disk. Sweeping
// here is what used to make a wiped manifest permanent.
const lostManifest = reconcileManifest({}, [
  { trackId: "a", byteLength: 100 },
  { trackId: "b", byteLength: 200 },
]);
equal(lostManifest.entries, {}, "no manifest means nothing is playable yet");
equal(lostManifest.orphans, [], "but the files are left alone to be recovered");

console.log("offlineStore.check passed");
