import type { Playlist, Track } from "../datasource/types";
import { getLocalTracksForPlaylist, isLocalPlaylist } from "./localPlaylists";

const STORAGE_KEY = "ytc-playlist-membership-v1";

/**
 * Bound on remembered tracks. Entries are tiny (an id and a handful of playlist ids), and
 * the list is pruned oldest-first, so this is only here to stop the key growing without end.
 */
const MAX_REMEMBERED_TRACKS = 1000;

/** trackId -> playlist ids we have seen the track in. Insertion-ordered, oldest first. */
type MembershipRecord = Record<string, string[]>;

let cachedRaw: string | null = null;
let cached: MembershipRecord = {};

function read(): MembershipRecord {
  if (typeof window === "undefined") return {};
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === cachedRaw) return cached;

  cachedRaw = raw;
  cached = {};
  if (!raw) return cached;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [trackId, playlistIds] of Object.entries(parsed)) {
        if (!Array.isArray(playlistIds)) continue;
        cached[trackId] = playlistIds.filter((id): id is string => typeof id === "string");
      }
    }
  } catch {
    // A corrupt key is not worth failing over — treat it as empty and let the next write fix it.
  }
  return cached;
}

function write(next: MembershipRecord): void {
  if (typeof window === "undefined") return;
  const trackIds = Object.keys(next);
  const pruned = trackIds.length > MAX_REMEMBERED_TRACKS
    ? Object.fromEntries(
        trackIds.slice(trackIds.length - MAX_REMEMBERED_TRACKS).map((id) => [id, next[id]]),
      )
    : next;

  cachedRaw = JSON.stringify(pruned);
  cached = pruned;
  localStorage.setItem(STORAGE_KEY, cachedRaw);
}

/**
 * True when this song is known to already be in this playlist.
 *
 * "Known" is doing real work here. Local playlists and local songs are stored on this machine,
 * so their membership is exact. A YouTube playlist's contents, though, are only knowable by
 * fetching every one of them — far too expensive to do just to draw a tick in a menu. So for
 * those we remember what we have been told: every add reports back "added" or "already-present",
 * and both answers prove membership. The indicator is therefore a "yes" you can trust and a
 * "no" that only means "not as far as we know" — which is why adding an already-added song is
 * still allowed, and still reports "Already in playlist".
 */
export function isTrackKnownInPlaylist(track: Track, playlist: Playlist): boolean {
  if (isLocalPlaylist(playlist)) {
    if (!track.localPath) return false;
    return (playlist.localPaths ?? []).includes(track.localPath);
  }
  if (track.source === "local") {
    return getLocalTracksForPlaylist(playlist).some((item) => item.localPath === track.localPath);
  }
  return read()[track.id]?.includes(playlist.id) ?? false;
}

/** Records a confirmed add. Local membership is derived from storage, so it is skipped. */
export function rememberTrackInPlaylist(track: Track, playlist: Playlist): void {
  if (track.source === "local" || isLocalPlaylist(playlist)) return;

  const current = read();
  const existing = current[track.id] ?? [];
  if (existing.includes(playlist.id)) return;

  // Re-inserting the key moves it to the end, which is what keeps pruning oldest-first.
  const { [track.id]: _dropped, ...rest } = current;
  write({ ...rest, [track.id]: [...existing, playlist.id] });
}

/** Forgets a membership so removing a song from a playlist clears its tick. */
export function forgetTrackInPlaylist(track: Track, playlist: Playlist): void {
  const current = read();
  const existing = current[track.id];
  if (!existing?.includes(playlist.id)) return;

  write({ ...current, [track.id]: existing.filter((id) => id !== playlist.id) });
}
