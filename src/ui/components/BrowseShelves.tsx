import { cn } from "@/lib/utils";
import type { Album, Artist, BrowseLink, BrowseShelf, Playlist, Track } from "../../datasource/types";
import type { PlayerControllerActions } from "../../player/playerStore";
import { AlbumCard } from "./AlbumCard";
import { TrackArtwork } from "./TrackArtwork";
import { TrackRow } from "./TrackRow";
import { useNowPlaying } from "../hooks/useNowPlaying";
import { usePlaylistContextMenu } from "./PlaylistContextMenu";
import { useTrackContextMenu } from "./TrackContextMenu";

/** Horizontal, scrollable, and clipped at the edge so there is a hint of more. */
const SHELF_ROW = "flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

function ArtistTile({ artist, onOpen }: { artist: Artist; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-32 shrink-0 flex-col items-center gap-2 rounded-xl p-2 text-center transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <TrackArtwork
        className="size-24 rounded-full"
        size={96}
        artworkUrl={artist.artworkUrl}
        iconSize={28}
        variant="artist"
      />
      <span className="line-clamp-2 text-xs font-medium text-foreground">{artist.name}</span>
    </button>
  );
}

function PlaylistTile({ playlist, onOpen }: { playlist: Playlist; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-36 shrink-0 flex-col gap-2 rounded-xl p-2 text-left transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <TrackArtwork
        className="size-32 rounded-lg"
        size={128}
        artworkUrl={playlist.artworkUrl}
        iconSize={28}
        variant="playlist"
      />
      <span className="line-clamp-2 text-xs font-medium text-foreground">{playlist.title}</span>
      <span className="truncate text-[11px] text-muted-foreground">{playlist.owner}</span>
    </button>
  );
}

/**
 * Renders browse shelves: song rows, then chips, then artwork rails.
 *
 * Shared by the Browse surfaces and the Related page, which receive the same shelf shape from
 * different endpoints. The ordering inside a shelf is fixed rather than following the response,
 * because songs read as a list and everything else reads as artwork, and interleaving the two
 * produced a column that changed rhythm every few rows.
 */
export function BrowseShelves({
  shelves,
  playerController,
  onOpenAlbum,
  onOpenArtist,
  onOpenPlaylist,
  onFollowLink,
  className,
}: {
  shelves: readonly BrowseShelf[];
  playerController: PlayerControllerActions;
  onOpenAlbum: (album: Album) => void;
  onOpenArtist: (artist: Artist) => void;
  onOpenPlaylist: (playlist: Playlist) => void;
  /** Absent hides the chips: a surface with nowhere to drill into should not offer to. */
  onFollowLink?: (link: BrowseLink) => void;
  className?: string;
}) {
  const { currentTrackId, isPlaying } = useNowPlaying();
  const { openTrackMenu, openPlaylistPicker } = useTrackContextMenu();
  const { openPlaylistMenu, openAlbumMenu } = usePlaylistContextMenu();

  const playShelfTrack = (shelfTracks: Track[], track: Track) => {
    void playerController.playTrackById(track.id, shelfTracks);
  };

  return (
    <div className={cn("flex flex-col gap-8", className)}>
      {shelves.map((shelf) => (
        <section key={shelf.title} className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-foreground">{shelf.title}</h2>

          {shelf.tracks.length > 0 && (
            <div className="flex flex-col gap-0.5">
              {shelf.tracks.map((track, index) => (
                <TrackRow
                  key={`${track.id}:${index}`}
                  track={track}
                  index={index}
                  isCurrent={currentTrackId === track.id}
                  isPlaying={isPlaying && currentTrackId === track.id}
                  onSelect={() => playShelfTrack(shelf.tracks, track)}
                  onContextMenu={(event) => openTrackMenu(event, track)}
                  onQuickAdd={() => openPlaylistPicker(track)}
                  onQuickAddToQueue={() => playerController.addToQueue(track)}
                  showDownload
                  showRating
                />
              ))}
            </div>
          )}

          {onFollowLink && shelf.links.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {shelf.links.map((link) => (
                <button
                  key={link.browseId}
                  type="button"
                  onClick={() => onFollowLink(link)}
                  className="rounded-full bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {link.title}
                </button>
              ))}
            </div>
          )}

          {shelf.albums.length > 0 && (
            <div className={SHELF_ROW}>
              {shelf.albums.map((album) => (
                <div
                  key={album.id}
                  className="w-36 shrink-0"
                  onContextMenu={(event) => openAlbumMenu(event, album)}
                >
                  <AlbumCard
                    artworkUrl={album.artworkUrl}
                    title={album.title}
                    subtitle={album.artist}
                    onClick={() => onOpenAlbum(album)}
                  />
                </div>
              ))}
            </div>
          )}

          {shelf.playlists.length > 0 && (
            <div className={SHELF_ROW}>
              {shelf.playlists.map((playlist) => (
                <div
                  key={playlist.id}
                  onContextMenu={(event) => openPlaylistMenu(event, playlist)}
                >
                  <PlaylistTile playlist={playlist} onOpen={() => onOpenPlaylist(playlist)} />
                </div>
              ))}
            </div>
          )}

          {shelf.artists.length > 0 && (
            <div className={SHELF_ROW}>
              {shelf.artists.map((artist) => (
                <ArtistTile
                  key={artist.id}
                  artist={artist}
                  onOpen={() => onOpenArtist(artist)}
                />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
