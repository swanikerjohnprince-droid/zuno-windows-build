/**
 * Self-check for removing a song from a local playlist. Run with the whole suite:
 *
 *   npm run check
 *
 * `paths` is a mixed list of assigned folders and individually added files, so removal that
 * only filtered that list worked for the second kind and silently did nothing for the first —
 * the song vanished from the view and came back on the next scan. Both halves are asserted
 * here because either one alone reintroduces that.
 */
export {};

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  },
  window: { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} },
});

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

const {
  addLocalPlaylistPath,
  createLocalPlaylist,
  getLocalPlaylist,
  removeLocalPlaylistPath,
  removeLocalPlaylistTrack,
} = (await import("./localPlaylists")) as typeof import("./localPlaylists");

const FOLDER = "C:/Music/Album";
const SONG = "C:/Music/Album/01 - Song.mp3";
const LOOSE = "C:/Music/Loose.mp3";

const playlist = createLocalPlaylist("Checks");
addLocalPlaylistPath(playlist.id, FOLDER);
addLocalPlaylistPath(playlist.id, LOOSE);

const read = () => getLocalPlaylist(playlist.id);

check(read()?.paths.includes(FOLDER) === true, "an assigned folder is stored");

/*
 * The case that was broken. The song is inside an assigned folder and is not itself in
 * `paths`, so only an exclusion can keep the scan from handing it back.
 */
removeLocalPlaylistTrack(playlist.id, SONG);
check(
  read()?.excludedPaths?.includes(SONG) === true,
  "a song from a scanned folder is excluded",
);
check(read()?.paths.includes(FOLDER) === true, "removing one song leaves its folder assigned");

// The other kind: a file added on its own leaves `paths` as well, or it would still be scanned.
removeLocalPlaylistTrack(playlist.id, LOOSE);
check(read()?.paths.includes(LOOSE) === false, "an individually added file leaves paths");
check(read()?.excludedPaths?.includes(LOOSE) === true, "and is excluded too");

// Adding a song back has to undo the exclusion, or it stays invisible forever.
addLocalPlaylistPath(playlist.id, SONG);
check(read()?.excludedPaths?.includes(SONG) === false, "re-adding a song clears its exclusion");
check(read()?.paths.includes(SONG) === true, "re-adding a song stores its path");

// Unassigning a folder is a different action and must not touch the exclusions.
const excludedBefore = read()?.excludedPaths?.length ?? 0;
removeLocalPlaylistPath(playlist.id, FOLDER);
check(read()?.paths.includes(FOLDER) === false, "removing a folder unassigns it");
check(
  (read()?.excludedPaths?.length ?? 0) === excludedBefore,
  "removing a folder leaves the exclusion list alone",
);

// Exclusions must survive a reload, or a removed song returns on the next launch.
const raw = store.get("ytc-local-playlists-v1") ?? "[]";
check(raw.includes(LOOSE), "exclusions are persisted, not held in memory");

console.log("localPlaylistTracks: ok");
