import type { Playlist, Track } from "../datasource/types";
import {
  getLocalPlaylists,
  localPlaylistToPlaylist,
  scanLocalAudioPaths,
  subscribeToLocalPlaylists,
  type LocalPlaylist,
} from "./localPlaylists";
import {
  filesTabSourcePaths,
  getFilesTabSources,
  subscribeFilesTabSources,
} from "../ui/pages/filesTabSources";

/**
 * Search over the user's own audio files: everything behind the Files tab's sources plus every
 * folder assigned to a local playlist, scanned through the same Rust `local_audio_scan` the
 * Files page uses. The scan result is cached and rescanned when the set of paths changes (or,
 * debounced, when the OS file watcher reports a change inside a watched folder).
 */

export const LOCAL_SEARCH_LIMIT = 8;

let cachedTracks: Track[] | null = null;
let scanInFlight: Promise<void> | null = null;
let lastPathsSignature = "";
let rescanTimer: number | null = null;

function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function normalizeKey(value: string): string {
  return normalizeText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Same ranking the search overlay uses for its preview (exact > prefix > substring > reverse),
 * so local results interleave with remote ones on the same scale.
 */
export function localMatchScore(value: string, query: string): number {
  const v = normalizeText(value);
  const vk = normalizeKey(value);
  const q = normalizeText(query);
  const qk = normalizeKey(query);
  if (!v || !q) return 0;
  if (v === q || (vk !== "" && qk !== "" && vk === qk)) return 4;
  if (v.startsWith(q) || (vk !== "" && qk !== "" && vk.startsWith(qk))) return 3;
  if (v.includes(q) || (vk !== "" && qk !== "" && vk.includes(qk))) return 2;
  if (q.includes(v) || (qk !== "" && vk !== "" && qk.includes(vk))) return 1;
  return 0;
}

function fileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/**
 * Pure matcher, exported so the self-check can drive it without the Tauri scan. Matches against
 * title, artist, album and the file name (a file with no tags still answers to its name).
 */
export function matchLocalTracks(
  tracks: readonly Track[],
  query: string,
  limit = LOCAL_SEARCH_LIMIT,
): Track[] {
  const q = query.trim();
  if (!q) return [];
  const scored: Array<{ track: Track; score: number }> = [];
  for (const track of tracks) {
    const score = Math.max(
      localMatchScore(track.title, q),
      track.artist ? localMatchScore(track.artist, q) : 0,
      track.album ? localMatchScore(track.album, q) : 0,
      track.localPath ? localMatchScore(fileName(track.localPath), q) : 0,
    );
    if (score > 0) scored.push({ track, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((entry) => entry.track);
}

export const LOCAL_PLAYLIST_SEARCH_LIMIT = 4;

/**
 * Pure matcher for local playlists, exported so the self-check can drive it. A local playlist
 * answers to its name only — it has no artist or album to match against. Results come back as
 * full `Playlist` objects (kind "local"), so every surface can badge them via isLocalPlaylist.
 */
export function matchLocalPlaylists(
  playlists: readonly LocalPlaylist[],
  query: string,
  limit = LOCAL_PLAYLIST_SEARCH_LIMIT,
): Playlist[] {
  const q = query.trim();
  if (!q) return [];
  const scored = playlists
    .map((playlist) => ({ playlist, score: localMatchScore(playlist.name, q) }))
    .filter((entry) => entry.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((entry) => localPlaylistToPlaylist(entry.playlist));
}

/** Local playlists live in memory, so this needs no scan and answers synchronously. */
export function searchLocalPlaylists(query: string): Playlist[] {
  const q = query.trim();
  if (!q) return [];
  return matchLocalPlaylists(getLocalPlaylists(), q);
}

function collectPaths(): string[] {
  const fromFilesTab = filesTabSourcePaths(getFilesTabSources());
  const fromPlaylists = getLocalPlaylists().flatMap((playlist) => playlist.paths);
  return Array.from(new Set([...fromFilesTab, ...fromPlaylists]));
}

async function rescan(): Promise<void> {
  const paths = collectPaths();
  // Recorded before the scan so a change notification arriving mid-scan cannot retrigger it.
  lastPathsSignature = paths.join("\n");
  if (!paths.length) {
    cachedTracks = [];
    return;
  }
  try {
    cachedTracks = await scanLocalAudioPaths(paths);
  } catch {
    // A failed scan (unplugged drive, unreadable file) keeps the previous cache rather than
    // wiping search results; the next notification retries.
  }
}

async function ensureScanned(): Promise<void> {
  if (cachedTracks) return;
  if (!scanInFlight) {
    scanInFlight = rescan().finally(() => {
      scanInFlight = null;
    });
  }
  await scanInFlight;
}

export async function searchLocalTracks(query: string): Promise<Track[]> {
  const q = query.trim();
  if (!q) return [];
  await ensureScanned();
  return matchLocalTracks(cachedTracks ?? [], q);
}

function scheduleRescan(): void {
  if (typeof window === "undefined") return;
  if (rescanTimer !== null) return;
  rescanTimer = window.setTimeout(() => {
    rescanTimer = null;
    void rescan();
  }, 1500);
}

/**
 * Warms the index and keeps it fresh. Call once at app startup. Path changes (a folder added
 * or removed in the Files tab or a local playlist) rescan immediately; everything else the
 * subscriptions report — the OS watcher noticing new files, playlist track edits — only
 * triggers a debounced rescan, and only when the path set actually differs from the last scan.
 */
export function initLocalSearchIndex(): void {
  void rescan();
  const onSourcesChanged = () => {
    if (collectPaths().join("\n") !== lastPathsSignature) {
      void rescan();
    } else {
      scheduleRescan();
    }
  };
  subscribeFilesTabSources(onSourcesChanged);
  subscribeToLocalPlaylists(onSourcesChanged);
}
