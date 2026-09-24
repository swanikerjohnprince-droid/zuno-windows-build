/**
 * Self-check for the artwork cache. No test runner in this project, so:
 *
 *   npx esbuild src/internal/artworkCache.check.ts --bundle --platform=node --format=esm
 *     --outfile=check.mjs && node check.mjs
 *
 * Every bug this cache can have is invisible on screen. A missed dedupe just means twenty
 * identical downloads; a missed revoke just means leaked image bytes; a stale entry that is
 * never dropped just means one cover is permanently slower than the rest. The pictures still
 * appear, so nothing looks wrong.
 */
export {};

import {
  __artworkCacheForTest,
  forgetResolvedArtworkUrl,
  getResolvedArtworkUrl,
  hasArtworkFailed,
  rememberResolvedArtworkUrl,
  resolveArtworkThroughProxy,
} from "./artworkCache";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  check(actual === expected, `${message}: expected ${String(expected)}, got ${String(actual)}`);
}

// The cache calls into browser globals; stand them in so this runs under node.
const revoked: string[] = [];
let blobCounter = 0;
(globalThis as Record<string, unknown>).URL = {
  createObjectURL: () => `blob:fake-${(blobCounter += 1)}`,
  revokeObjectURL: (value: string) => revoked.push(value),
};
(globalThis as Record<string, unknown>).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
(globalThis as Record<string, unknown>).window = {
  setTimeout: () => 0,
  clearTimeout: () => {},
};

// --- resolution round trip ------------------------------------------------------------

__artworkCacheForTest.reset();
rememberResolvedArtworkUrl("source-a", "https://cdn/a-480.jpg");
equal(getResolvedArtworkUrl("source-a"), "https://cdn/a-480.jpg", "remembers what worked");
equal(getResolvedArtworkUrl("never-seen"), undefined, "unknown source is a miss");

// --- replacing an owned blob revokes the old one ---------------------------------------

__artworkCacheForTest.reset();
revoked.length = 0;
rememberResolvedArtworkUrl("source-b", "blob:old", { ownsObjectUrl: true });
rememberResolvedArtworkUrl("source-b", "blob:new", { ownsObjectUrl: true });
equal(revoked.join(","), "blob:old", "the replaced blob is revoked, not leaked");

// A plain URL is not ours to revoke — revoking a CDN URL would be meaningless.
__artworkCacheForTest.reset();
revoked.length = 0;
rememberResolvedArtworkUrl("source-c", "https://cdn/c.jpg");
rememberResolvedArtworkUrl("source-c", "https://cdn/c-2.jpg");
equal(revoked.length, 0, "plain URLs are never passed to revokeObjectURL");

// --- forgetting a stale entry ------------------------------------------------------------

__artworkCacheForTest.reset();
revoked.length = 0;
rememberResolvedArtworkUrl("source-d", "blob:dead", { ownsObjectUrl: true });
forgetResolvedArtworkUrl("source-d");
equal(getResolvedArtworkUrl("source-d"), undefined, "a forgotten entry is a miss again");
equal(revoked.join(","), "blob:dead", "forgetting revokes the blob it owned");
forgetResolvedArtworkUrl("source-d"); // must not throw or double-revoke
equal(revoked.length, 1, "forgetting twice revokes once");

// --- in-flight dedupe ---------------------------------------------------------------------

__artworkCacheForTest.reset();
{
  let fetches = 0;
  // Initialised to a no-op so its type is not narrowed to null by the deferred assignment.
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const fetchBlob = async () => {
    fetches += 1;
    await gate;
    return {} as Blob;
  };

  // Twenty rows showing the same cover, all mounting in the same frame.
  const waiting = Array.from({ length: 20 }, () =>
    resolveArtworkThroughProxy("shared-cover", fetchBlob),
  );
  equal(__artworkCacheForTest.inFlightSize(), 1, "one request is tracked, not twenty");

  release();
  const results = await Promise.all(waiting);
  equal(fetches, 1, "twenty callers issue exactly one fetch");
  equal(new Set(results).size, 1, "every caller receives the same object URL");
  equal(__artworkCacheForTest.inFlightSize(), 0, "the in-flight entry is cleared when settled");

  // A later caller reads the cache rather than fetching again.
  await resolveArtworkThroughProxy("shared-cover", fetchBlob);
  equal(fetches, 1, "a resolved cover is never re-fetched");
}

// --- failures are remembered ---------------------------------------------------------------

__artworkCacheForTest.reset();
{
  let fetches = 0;
  const failing = async () => {
    fetches += 1;
    throw new Error("404");
  };

  const result = await resolveArtworkThroughProxy("broken", failing);
  equal(result, null, "a failed proxy resolves to null rather than throwing");
  check(hasArtworkFailed("broken"), "the failure is recorded so the ladder is not re-walked");
  equal(fetches, 1, "one attempt");
}

// --- the byte budget, not just the entry count ------------------------------------------------

/*
 * The failure this catches is invisible: covers still appear, the entry count still looks
 * healthy, and memory climbs anyway because nothing was counting what the entries weighed.
 */
__artworkCacheForTest.reset();
revoked.length = 0;
{
  const oneMb = 1024 * 1024;
  const overBudget = Math.ceil(__artworkCacheForTest.maxBlobBytes / oneMb) + 4;
  for (let index = 0; index < overBudget; index += 1) {
    rememberResolvedArtworkUrl(`big-${index}`, `blob:big-${index}`, {
      ownsObjectUrl: true,
      byteLength: oneMb,
    });
  }

  check(
    __artworkCacheForTest.blobBytes() <= __artworkCacheForTest.maxBlobBytes,
    "blob bytes stay within the budget even though the entry count never reached its cap",
  );
  check(__artworkCacheForTest.resolvedSize() < overBudget, "over-budget entries were evicted");
  check(revoked.length > 0, "evicted blobs are revoked rather than merely forgotten");
  equal(
    getResolvedArtworkUrl(`big-${overBudget - 1}`),
    `blob:big-${overBudget - 1}`,
    "the entry just inserted is never the one evicted to make room for itself",
  );
  equal(getResolvedArtworkUrl("big-0"), undefined, "the coldest entry goes first");
}

// A plain URL costs no bytes, so it must not be counted against the budget.
__artworkCacheForTest.reset();
rememberResolvedArtworkUrl("plain", "https://cdn/plain.jpg");
equal(__artworkCacheForTest.blobBytes(), 0, "plain URLs weigh nothing");

// --- resolving clears a previous failure ----------------------------------------------------

__artworkCacheForTest.reset();
rememberResolvedArtworkUrl("flaky", "https://cdn/flaky.jpg");
check(!hasArtworkFailed("flaky"), "a source that resolves is no longer marked failed");

console.log("artworkCache: ok");
