/**
 * Self-check for whole-playlist paging. No test runner in this project, so:
 *
 *   npx esbuild src/ui/pages/collectTrackPages.check.ts --bundle --platform=node --format=esm
 *     --outfile=check.mjs && node check.mjs
 *
 * This loop backs "download this playlist". Every failure mode it has is silent: a cursor that
 * stops advancing spins until the cap, a bad dedupe drops songs from the download, and a missed
 * staleness check appends another playlist's songs to the one on screen.
 */
export {};

import type { Track } from "../../datasource/types";
import { collectTrackPages, type TrackPage } from "./collectTrackPages";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  check(actual === expected, `${message}: expected ${String(expected)}, got ${String(actual)}`);
}

const track = (id: string) => ({ id, title: id, artists: [] }) as unknown as Track;
const ids = (tracks: Track[]) => tracks.map((item) => item.id).join(",");

// --- the ordinary case: walk to the end -------------------------------------------------

{
  const pages: Record<string, TrackPage> = {
    p1: { tracks: [track("c"), track("d")], hasMore: true, nextPageKey: "p2" },
    p2: { tracks: [track("e")], hasMore: false },
  };
  let requests = 0;
  const all = await collectTrackPages({
    initial: [track("a"), track("b")],
    hasMore: true,
    nextPageKey: "p1",
    maxPages: 10,
    fetchPage: async (key) => {
      requests += 1;
      return pages[key];
    },
  });
  equal(ids(all), "a,b,c,d,e", "collects every page in order");
  equal(requests, 2, "stops requesting once hasMore is false");
}

// --- nothing left to fetch ---------------------------------------------------------------

{
  const all = await collectTrackPages({
    initial: [track("a")],
    hasMore: false,
    maxPages: 10,
    fetchPage: async () => {
      throw new Error("must not fetch when hasMore is false");
    },
  });
  equal(ids(all), "a", "returns what it has when there is no next page");
}

// --- duplicates across pages -------------------------------------------------------------

{
  const pages: Record<string, TrackPage> = {
    p1: { tracks: [track("a"), track("b")], hasMore: true, nextPageKey: "p2" },
    p2: { tracks: [track("b"), track("c")], hasMore: false },
  };
  const all = await collectTrackPages({
    initial: [track("a")],
    hasMore: true,
    nextPageKey: "p1",
    maxPages: 10,
    fetchPage: async (key) => pages[key],
  });
  equal(ids(all), "a,b,c", "a song repeated across pages is kept once");
}

// --- a cursor that never advances ---------------------------------------------------------

{
  let requests = 0;
  const all = await collectTrackPages({
    initial: [track("a")],
    hasMore: true,
    nextPageKey: "stuck",
    maxPages: 50,
    fetchPage: async () => {
      requests += 1;
      // Same rows, same cursor, still claiming more: the shape that would spin forever.
      return { tracks: [track("a")], hasMore: true, nextPageKey: "stuck" };
    },
  });
  equal(requests, 1, "a repeating page is requested once, not until the cap");
  equal(ids(all), "a", "and adds nothing");
}

// --- a source that always reports more -----------------------------------------------------

{
  let requests = 0;
  let counter = 0;
  await collectTrackPages({
    initial: [],
    hasMore: true,
    nextPageKey: "k0",
    maxPages: 5,
    fetchPage: async () => {
      requests += 1;
      counter += 1;
      // Fresh rows and a fresh cursor every time — only the cap can stop this.
      return { tracks: [track(`t${counter}`)], hasMore: true, nextPageKey: `k${counter}` };
    },
  });
  equal(requests, 5, "maxPages bounds an endless source");
}

// --- navigating away mid-sweep ---------------------------------------------------------------

{
  let stale = false;
  const all = await collectTrackPages({
    initial: [track("a")],
    hasMore: true,
    nextPageKey: "p1",
    maxPages: 10,
    fetchPage: async () => {
      stale = true; // the user switched playlists while this request was in flight
      return { tracks: [track("wrong-playlist")], hasMore: true, nextPageKey: "p2" };
    },
    isStale: () => stale,
  });
  equal(ids(all), "a", "a stale page is discarded rather than appended");
}

// --- progress reporting ------------------------------------------------------------------

{
  const pages: Record<string, TrackPage> = {
    p1: { tracks: [track("b")], hasMore: true, nextPageKey: "p2" },
    p2: { tracks: [track("c")], hasMore: false },
  };
  const seen: string[] = [];
  await collectTrackPages({
    initial: [track("a")],
    hasMore: true,
    nextPageKey: "p1",
    maxPages: 10,
    fetchPage: async (key) => pages[key],
    onPage: (tracks) => seen.push(ids(tracks)),
  });
  equal(seen.join(" | "), "a,b | a,b,c", "reports cumulative progress after each page");
}

console.log("collectTrackPages: ok");
