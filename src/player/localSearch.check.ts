/**
 * Self-check for local-file search matching. No test runner in this project, so:
 *
 *   npm run check
 *
 * The point of the matcher is that a local file answers to its tags *and* its file name —
 * a file with no tags must still be findable, and diacritics in either side must not hide it.
 */
export {};

import {
  LOCAL_PLAYLIST_SEARCH_LIMIT,
  LOCAL_SEARCH_LIMIT,
  localMatchScore,
  matchLocalPlaylists,
  matchLocalTracks,
} from "./localSearch";
import type { Track } from "../datasource/types";
import type { LocalPlaylist } from "./localPlaylists";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  check(actual === expected, `${message}: expected ${String(expected)}, got ${String(actual)}`);
}

function localTrack(
  id: string,
  title: string,
  artist = "Some Artist",
  album?: string,
  path?: string,
): Track {
  return {
    id,
    source: "local",
    title,
    artist,
    album,
    localPath: path ?? `C:\\Music\\${id}.mp3`,
  };
}

const tracks = [
  localTrack("a", "Midnight City", "M83", "Hurry Up, We're Dreaming"),
  localTrack("b", "Café del Mar", "Energy 52"),
  localTrack("c", "Around the World", "Daft Punk", "Homework"),
  localTrack("d", "Sandstorm", "Darude"),
  localTrack("e", "track01", "Unknown artist", undefined, "D:\\Downloads\\cool-song-2024.mp3"),
];

// --- field coverage ------------------------------------------------------------

equal(matchLocalTracks(tracks, "midnight").map((t) => t.id).join(","), "a", "title match");
equal(matchLocalTracks(tracks, "daft punk").map((t) => t.id).join(","), "c", "artist match");
equal(matchLocalTracks(tracks, "homework").map((t) => t.id).join(","), "c", "album match");
equal(
  matchLocalTracks(tracks, "cool song").map((t) => t.id).join(","),
  "e",
  "file-name match for an untagged file",
);

// --- diacritics ----------------------------------------------------------------

equal(
  matchLocalTracks(tracks, "cafe del mar").map((t) => t.id).join(","),
  "b",
  "query without the accent still matches the accented title",
);
check(localMatchScore("Café", "cafe") === 4, "accent-stripped exact match scores 4");

// --- ranking -------------------------------------------------------------------

const ranked = matchLocalTracks(
  [localTrack("x", "Song"), localTrack("y", "Song 2"), localTrack("z", "A Song About Songs")],
  "song",
);
equal(ranked[0].id, "x", "exact match ranks first");
equal(ranked[1].id, "y", "prefix match ranks second");

// --- guards --------------------------------------------------------------------

equal(matchLocalTracks(tracks, "   ").length, 0, "blank query matches nothing");
equal(matchLocalTracks(tracks, "zzzz-nothing").length, 0, "no match returns empty");
equal(matchLocalTracks([], "midnight").length, 0, "empty index returns empty");

const many = Array.from({ length: 20 }, (_, i) => localTrack(`t${i}`, `Song number ${i}`));
equal(matchLocalTracks(many, "song").length, LOCAL_SEARCH_LIMIT, "results are capped at the limit");
equal(LOCAL_SEARCH_LIMIT, 8, "the cap is 8");

// --- local playlists -------------------------------------------------------------

const playlists: LocalPlaylist[] = [
  { id: "local:1", name: "Road trip", paths: [] },
  { id: "local:2", name: "Café mornings", paths: [] },
  { id: "local:3", name: "Gym", paths: [] },
];

equal(matchLocalPlaylists(playlists, "road").map((p) => p.id).join(","), "local:1", "playlist name match");
equal(matchLocalPlaylists(playlists, "cafe").map((p) => p.id).join(","), "local:2", "diacritics-insensitive playlist match");
equal(matchLocalPlaylists(playlists, "road trip")[0].kind, "local", "converted playlist carries kind local");
equal(matchLocalPlaylists(playlists, "   ").length, 0, "blank playlist query matches nothing");
equal(matchLocalPlaylists([], "road").length, 0, "no playlists returns empty");
equal(LOCAL_PLAYLIST_SEARCH_LIMIT, 4, "the playlist cap is 4");
