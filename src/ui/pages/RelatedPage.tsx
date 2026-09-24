import { useEffect, useState } from "react";
import { SpinnerSteps } from "@/components/motion/loader";
import type { Album, Artist, BrowseShelf, Playlist, Track } from "../../datasource/types";
import { libraryController, type PlayerControllerActions } from "../../player/playerStore";
import { BrowseShelves } from "../components/BrowseShelves";
import { TrackArtwork } from "../components/TrackArtwork";

/**
 * "Related" for a track: similar artists, playlists it appears on, more from the same album.
 *
 * A different endpoint from the up-next queue the player already uses. Up-next is what plays
 * after this song; this is what to listen to *instead*, which is a browsing question and so
 * gets a page rather than a rail in the queue.
 */
export function RelatedPage({
  track,
  playerController,
  onOpenAlbum,
  onOpenArtist,
  onOpenPlaylist,
}: {
  track: Track;
  playerController: PlayerControllerActions;
  onOpenAlbum: (album: Album) => void;
  onOpenArtist: (artist: Artist) => void;
  onOpenPlaylist: (playlist: Playlist) => void;
}) {
  const [shelves, setShelves] = useState<BrowseShelf[] | null>(null);

  useEffect(() => {
    let active = true;
    setShelves(null);
    void libraryController.getRelated(track)
      .then((fetched) => {
        if (active) setShelves(fetched);
      })
      .catch(() => {
        // getRelated already answers [] for a track with no related tab; this covers the rest.
        if (active) setShelves([]);
      });

    return () => {
      active = false;
    };
  }, [track]);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-center gap-4">
        <TrackArtwork
          className="size-16 shrink-0 rounded-xl object-cover"
          size={64}
          artworkUrl={track.artworkUrl}
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Related to
          </span>
          <h1 className="truncate text-2xl font-semibold text-foreground">{track.title}</h1>
          <span className="truncate text-sm text-muted-foreground">{track.artist}</span>
        </div>
      </header>

      {!shelves ? (
        <div className="grid place-items-center py-16" role="status" aria-label="Loading">
          <SpinnerSteps size={30} color="currentColor" />
        </div>
      ) : shelves.length === 0 ? (
        <p className="px-2 py-10 text-center text-sm text-muted-foreground">
          YouTube Music has nothing related for this track.
        </p>
      ) : (
        <BrowseShelves
          shelves={shelves}
          playerController={playerController}
          onOpenAlbum={onOpenAlbum}
          onOpenArtist={onOpenArtist}
          onOpenPlaylist={onOpenPlaylist}
        />
      )}
    </div>
  );
}
