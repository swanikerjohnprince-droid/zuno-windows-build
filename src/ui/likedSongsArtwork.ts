import likedSongsCover from "../../assets/img/liked.jpg";

/**
 * Cover art for the Liked Songs collection.
 *
 * YouTube Music does not return artwork for it, so every surface used to draw its own heart
 * glyph on a tinted square. Importing the asset once means the sidebar rail and the playlist
 * header cannot drift apart, and Vite fingerprints and bundles it like any other asset.
 */
export { likedSongsCover };

/** True for the Liked Songs collection, which the API identifies inconsistently. */
export function isLikedSongsId(id?: string, kind?: string): boolean {
  return kind === "liked-songs" || id === "LM";
}
