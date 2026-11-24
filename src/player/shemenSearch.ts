import type { Track } from "../datasource/types";
import { tauriFetch } from "../datasource/youtube/tauriFetch";
import { logInternalWarn } from "../internal/logging";
import { localMatchScore } from "./localSearch";

/**
 * shemenmusic.com as a track source: royalty-free instrumentals, served as plain mp3s from
 * `/download/<id>` and searchable through the site's own static index `/_search/index.json`
 * (no server-side search API exists — the site's search page tokenizes client-side).
 *
 * The index is fetched once through the generic Rust HTTP proxy (`tauriFetch`), cached in
 * memory and in localStorage for a day, and searched purely in the webview with the same
 * ranking the local-file search uses. Tracks carry `source: "shemen"` and ids `shemen:<id>`.
 */

export const SHEMEN_BASE_URL = "https://shemenmusic.com";
export const SHEMEN_TRACK_PREFIX = "shemen:";
export const SHEMEN_SEARCH_LIMIT = 12;

/** One entry of `/_search/index.json`. Field names are the site's own minified keys. */
export interface ShemenIndexSong {
  /** Numeric id — the same id `/download/<id>` serves. */
  id: number;
  /** Play count. */
  n: number;
  /** Title. */
  t: string;
  /** Artist. */
  a: string;
  /** Duration in seconds. */
  p: number;
  pw?: number;
  /** Genre group: "lws" | "flm" | "mm". */
  gr?: string;
  /** Tag pairs with weights: `[[tag, weight], ...]`. */
  g?: [string, number][];
}

export function shemenTrackId(numericId: number | string): string {
  return `${SHEMEN_TRACK_PREFIX}${numericId}`;
}

/** The directly playable mp3 for a shemen track id (or a bare numeric id). */
export function shemenDownloadUrl(trackId: string): string {
  const numeric = trackId.startsWith(SHEMEN_TRACK_PREFIX)
    ? trackId.slice(SHEMEN_TRACK_PREFIX.length)
    : trackId;
  return `${SHEMEN_BASE_URL}/download/${numeric}`;
}

export function shemenSongToTrack(song: ShemenIndexSong, artworkUrl?: string): Track {
  return {
    id: shemenTrackId(song.id),
    source: "shemen",
    title: song.t,
    artist: song.a,
    durationSec: song.p,
    artworkUrl,
  };
}

/**
 * Pure matcher, exported so the self-check can drive it. Scores title, artist and every tag
 * with the same scale as the local-file search, so shemen results interleave with both on
 * equal footing; ties break on play count, which is the site's own popularity signal.
 */
export function matchShemenSongs(
  songs: readonly ShemenIndexSong[],
  query: string,
  limit = SHEMEN_SEARCH_LIMIT,
): ShemenIndexSong[] {
  const q = query.trim();
  if (!q) return [];
  const scored: Array<{ song: ShemenIndexSong; score: number }> = [];
  for (const song of songs) {
    let score = Math.max(
      localMatchScore(song.t ?? "", q),
      localMatchScore(song.a ?? "", q),
    );
    for (const tag of song.g ?? []) {
      score = Math.max(score, localMatchScore(tag[0] ?? "", q));
    }
    if (score > 0) scored.push({ song, score });
  }
  scored.sort((a, b) => b.score - a.score || (b.song.n ?? 0) - (a.song.n ?? 0));
  return scored.slice(0, limit).map((entry) => entry.song);
}

/**
 * Pure parser for `/_search/rows-en.json`: each row's HTML carries one `/art/<slug>-...-sm.jpg`
 * image, which is the only artwork mapping the site exposes (the index itself has none).
 */
export function parseShemenArtworkRows(rowsJson: unknown): Map<string, string> {
  const map = new Map<string, string>();
  const rows = (rowsJson as { rows?: Record<string, unknown> } | null)?.rows;
  if (!rows || typeof rows !== "object") return map;
  for (const [id, html] of Object.entries(rows)) {
    if (typeof html !== "string") continue;
    const match = html.match(/\/art\/[^\s"']+/);
    if (match) map.set(id, `${SHEMEN_BASE_URL}${match[0]}`);
  }
  return map;
}

const INDEX_CACHE_KEY = "zuno-shemen-index-v1";
const INDEX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 30_000;

let cachedSongs: ShemenIndexSong[] | null = null;
let indexInFlight: Promise<ShemenIndexSong[]> | null = null;
let indexLastFailureAt = 0;
let artworkById: Map<string, string> | null = null;
let artworkInFlight: Promise<Map<string, string>> | null = null;
let artworkLastFailureAt = 0;

function isValidIndexSong(value: unknown): value is ShemenIndexSong {
  const song = value as ShemenIndexSong;
  return Boolean(
    song
    && typeof song.id === "number"
    && typeof song.t === "string"
    && typeof song.a === "string",
  );
}

function readCachedIndex(): ShemenIndexSong[] | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(INDEX_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { fetchedAt?: unknown; songs?: unknown };
    if (!parsed || typeof parsed.fetchedAt !== "number" || !Array.isArray(parsed.songs)) return null;
    if (Date.now() - parsed.fetchedAt > INDEX_CACHE_TTL_MS) return null;
    const songs = parsed.songs.filter(isValidIndexSong);
    return songs.length > 0 ? songs : null;
  } catch {
    return null;
  }
}

async function fetchIndex(): Promise<ShemenIndexSong[]> {
  const response = await tauriFetch(`${SHEMEN_BASE_URL}/_search/index.json`, { timeoutMs: 20_000 });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json() as { songs?: unknown };
  const songs = Array.isArray(json.songs) ? json.songs.filter(isValidIndexSong) : [];
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(INDEX_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), songs }));
    }
  } catch {
    // A full or blocked localStorage just means no disk cache; memory still works.
  }
  return songs;
}

/**
 * The index, loaded once per session and served from localStorage across launches. A failed
 * fetch keeps whatever cache exists and is retried at most once per {@link RETRY_MS}.
 */
export function ensureShemenIndex(): Promise<ShemenIndexSong[]> {
  if (cachedSongs && cachedSongs.length > 0) return Promise.resolve(cachedSongs);
  if (indexInFlight) return indexInFlight;
  if (indexLastFailureAt && Date.now() - indexLastFailureAt < RETRY_MS && cachedSongs) {
    return Promise.resolve(cachedSongs);
  }
  indexInFlight = (async () => {
    const diskCache = readCachedIndex();
    if (diskCache) cachedSongs = diskCache;
    try {
      const songs = await fetchIndex();
      cachedSongs = songs;
      indexLastFailureAt = 0;
      return songs;
    } catch (error) {
      indexLastFailureAt = Date.now();
      logInternalWarn("shemenSearch index fetch failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      cachedSongs = cachedSongs ?? [];
      return cachedSongs;
    }
  })().finally(() => {
    indexInFlight = null;
  });
  return indexInFlight;
}

async function fetchArtwork(): Promise<Map<string, string>> {
  const response = await tauriFetch(`${SHEMEN_BASE_URL}/_search/rows-en.json`, { timeoutMs: 30_000 });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseShemenArtworkRows(await response.json());
}

/** Artwork id → absolute URL, loaded in the background; never rejects. */
export function ensureShemenArtwork(): Promise<Map<string, string>> {
  if (artworkById) return Promise.resolve(artworkById);
  if (artworkInFlight) return artworkInFlight;
  if (artworkLastFailureAt && Date.now() - artworkLastFailureAt < RETRY_MS) {
    return Promise.resolve(artworkById ?? new Map());
  }
  artworkInFlight = fetchArtwork()
    .then((map) => {
      artworkById = map;
      artworkLastFailureAt = 0;
      return map;
    })
    .catch((error) => {
      artworkLastFailureAt = Date.now();
      logInternalWarn("shemenSearch artwork fetch failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return artworkById ?? new Map<string, string>();
    })
    .finally(() => {
      artworkInFlight = null;
    });
  return artworkInFlight;
}

/** Global search hook: shemen matches for a query, ranked like every other source. */
export async function searchShemenTracks(query: string): Promise<Track[]> {
  const q = query.trim();
  if (!q) return [];
  const songs = await ensureShemenIndex();
  if (songs.length === 0) return [];
  if (!artworkById) void ensureShemenArtwork();
  const artwork = artworkById;
  return matchShemenSongs(songs, q).map((song) =>
    shemenSongToTrack(song, artwork?.get(String(song.id))),
  );
}

/** Resolves a `shemen:<id>` track id back to its Track, for the player's metadata path. */
export async function getShemenTrackById(trackId: string): Promise<Track | null> {
  if (!trackId.startsWith(SHEMEN_TRACK_PREFIX)) return null;
  const songs = await ensureShemenIndex();
  const numeric = trackId.slice(SHEMEN_TRACK_PREFIX.length);
  const song = songs.find((entry) => String(entry.id) === numeric);
  if (!song) return null;
  if (!artworkById) void ensureShemenArtwork();
  return shemenSongToTrack(song, artworkById?.get(String(song.id)));
}

/** The tab's landing list: the site's most-played instrumentals. */
export async function popularShemenTracks(limit = 50): Promise<Track[]> {
  const songs = await ensureShemenIndex();
  if (!artworkById) void ensureShemenArtwork();
  const artwork = artworkById;
  return [...songs]
    .sort((a, b) => (b.n ?? 0) - (a.n ?? 0))
    .slice(0, limit)
    .map((song) => shemenSongToTrack(song, artwork?.get(String(song.id))));
}

/** Warms both caches at app startup so the first search is instant. */
export function initShemenIndex(): void {
  void ensureShemenIndex();
  void ensureShemenArtwork();
}
