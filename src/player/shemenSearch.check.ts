/**
 * Self-check for the shemenmusic.com matcher and id/url mapping. No test runner in this
 * project, so:
 *
 *   npm run check
 *
 * The point of the matcher is that a song answers to its title, its artist *and* its tags,
 * that exact beats prefix beats substring, and that the download URL is derived from the id
 * the index and the site's /download/<id> endpoint share.
 */
export {};

import {
  SHEMEN_BASE_URL,
  SHEMEN_SEARCH_LIMIT,
  SHEMEN_TRACK_PREFIX,
  matchShemenSongs,
  parseShemenArtworkRows,
  shemenDownloadUrl,
  shemenSongToTrack,
  shemenTrackId,
  type ShemenIndexSong,
} from "./shemenSearch";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  check(actual === expected, `${message}: expected ${String(expected)}, got ${String(actual)}`);
}

function song(id: number, title: string, artist: string, plays = 0, tags: [string, number][] = []): ShemenIndexSong {
  return { id, n: plays, t: title, a: artist, p: 299, pw: 0, gr: "mm", g: tags };
}

const songs = [
  song(452, "Acoustic Breeze", "M83", 90000, [["acoustic", 3], ["chill", 2]]),
  song(101, "Café del Mar", "Energy 52", 500000, [["trance", 3]]),
  song(777, "Electric Dreams", "Dynatron", 120000, [["synthwave", 3], ["retro", 1]]),
  song(888, "Piano Morning", "Yiruma", 800000, [["piano", 3]]),
];

// --- field coverage ------------------------------------------------------------

equal(matchShemenSongs(songs, "acoustic breeze").map((s) => s.id).join(","), "452", "title match");
equal(matchShemenSongs(songs, "yiruma").map((s) => s.id).join(","), "888", "artist match");
equal(matchShemenSongs(songs, "synthwave").map((s) => s.id).join(","), "777", "tag match");
equal(
  matchShemenSongs(songs, "cafe del mar").map((s) => s.id).join(","),
  "101",
  "query without the accent still matches the accented title",
);

// --- ranking -------------------------------------------------------------------

const ranked = matchShemenSongs(
  [song(1, "Song", "A"), song(2, "Song 2", "B", 9999), song(3, "A Song About Songs", "C")],
  "song",
);
equal(ranked[0].id, 1, "exact match ranks first");
equal(ranked[1].id, 2, "prefix match ranks second, ahead of substring despite fewer plays");
equal(ranked[2].id, 3, "substring match ranks last");

const tie = matchShemenSongs([song(5, "Dream", "X", 10), song(6, "Dream", "Y", 500)], "dream");
equal(tie[0].id, 6, "equal scores break on play count");

// --- guards --------------------------------------------------------------------

equal(matchShemenSongs(songs, "   ").length, 0, "blank query matches nothing");
equal(matchShemenSongs(songs, "zzzz-nothing").length, 0, "no match returns empty");
equal(matchShemenSongs([], "dream").length, 0, "empty index returns empty");

const many = Array.from({ length: 30 }, (_, i) => song(1000 + i, `Track ${i}`, "Various"));
equal(matchShemenSongs(many, "track").length, SHEMEN_SEARCH_LIMIT, "results are capped at the limit");
equal(SHEMEN_SEARCH_LIMIT, 12, "the cap is 12");

// --- ids and urls ----------------------------------------------------------------

equal(shemenTrackId(452), "shemen:452", "track id carries the shemen: prefix");
equal(shemenTrackId("452"), "shemen:452", "string ids work too");
equal(
  shemenDownloadUrl("shemen:452"),
  `${SHEMEN_BASE_URL}/download/452`,
  "download url derives from the prefixed id",
);
equal(shemenDownloadUrl("452"), `${SHEMEN_BASE_URL}/download/452`, "bare numeric id also works");
check(SHEMEN_TRACK_PREFIX === "shemen:", "the prefix is shemen:");

// --- track mapping ----------------------------------------------------------------

const track = shemenSongToTrack(song(452, "Acoustic Breeze", "M83", 90000), "https://x/art/a-sm.jpg");
equal(track.id, "shemen:452", "mapped track id");
equal(track.source, "shemen", "mapped track source");
equal(track.title, "Acoustic Breeze", "mapped title");
equal(track.artist, "M83", "mapped artist");
equal(track.durationSec, 299, "duration comes from p (seconds)");
equal(track.artworkUrl, "https://x/art/a-sm.jpg", "artwork passes through");
check(!("localPath" in track), "a shemen track carries no localPath");

// --- artwork rows ------------------------------------------------------------------

const rows = parseShemenArtworkRows({
  rows: {
    "452": `<div class="row" data-slug="acoustic-breeze" data-id="452"><img src="/art/acoustic-breeze-202401-sm.jpg" alt=""></div>`,
    "101": `<div class="row" data-id="101">no image here</div>`,
    "bad": 42,
  },
});
equal(rows.get("452"), `${SHEMEN_BASE_URL}/art/acoustic-breeze-202401-sm.jpg`, "art row maps to absolute url");
equal(rows.get("101"), undefined, "row without art is skipped");
equal(rows.size, 1, "only art rows are kept");
equal(parseShemenArtworkRows(null).size, 0, "null payload yields empty map");
equal(parseShemenArtworkRows({}).size, 0, "missing rows key yields empty map");
