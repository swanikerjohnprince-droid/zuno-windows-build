import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { MusicNoteIcon, PlayIcon, SearchIcon } from "@/ui/icons";
import type { Track } from "../../datasource/types";
import type { PlayerControllerActions } from "../../player/playerStore";
import { popularShemenTracks, searchShemenTracks } from "../../player/shemenSearch";
import { logInternalError } from "../../internal/logging";
import { TrackRow } from "../components/TrackRow";
import { useTrackContextMenu } from "../components/TrackContextMenu";
import { useNowPlaying } from "../hooks/useNowPlaying";

/**
 * The "Shemen Music" tab: royalty-free instrumentals from shemenmusic.com.
 *
 * This tab has its own search box, deliberately separate from the global search bar (which
 * is hidden while this tab is active) — the site's index is searched directly. The same
 * tracks also appear in the global search, badged "Instrumental".
 *
 * With an empty query the tab shows the site's most-played instrumentals; every row plays
 * through the normal shemen path (downloaded via the media server on play).
 */
export function ShemenPage({
  playerController,
}: {
  playerController: PlayerControllerActions;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { currentTrackId, isPlaying } = useNowPlaying();
  const { openTrackMenu } = useTrackContextMenu();

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query.trim()), 200);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError(null);
    const load = debouncedQuery
      ? searchShemenTracks(debouncedQuery)
      : popularShemenTracks();
    load
      .then((result) => {
        if (!active) return;
        setTracks(result);
        setIsLoading(false);
      })
      .catch((loadError) => {
        if (!active) return;
        logInternalError("ShemenPage load failed", loadError);
        setTracks([]);
        setError("Could not reach shemenmusic.com. Check your connection and try again.");
        setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [debouncedQuery]);

  const playAll = useCallback(() => {
    const first = tracks[0];
    if (!first) return;
    void playerController.playTrackById(first.id, tracks);
  }, [playerController, tracks]);

  const actionButtonClass = cn(
    "flex shrink-0 items-center gap-2 rounded-full bg-card px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors",
    "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    "disabled:opacity-50",
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-3xl font-bold tracking-[-0.02em] text-foreground">Shemen Music</h1>
          <p className="text-sm text-muted-foreground">
            {debouncedQuery
              ? `${tracks.length} ${tracks.length === 1 ? "result" : "results"} for “${debouncedQuery}”`
              : `${tracks.length} popular ${tracks.length === 1 ? "instrumental" : "instrumentals"}`}
            {" "}from shemenmusic.com
          </p>
        </div>

        <div className="flex items-center gap-2">
          {tracks.length > 0 && (
            <button
              type="button"
              onClick={playAll}
              className={cn(
                actionButtonClass,
                "bg-primary text-primary-foreground hover:text-primary-foreground hover:opacity-90",
              )}
            >
              <PlayIcon size={15} aria-hidden="true" />
              Play all
            </button>
          )}
        </div>
      </header>

      <div className="relative max-w-md">
        <SearchIcon
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search instrumentals on shemenmusic.com…"
          aria-label="Search shemenmusic.com"
          className="w-full rounded-full bg-card py-2 pl-10 pr-4 text-sm text-foreground ring-1 ring-border placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-col gap-0.5">
        {isLoading && tracks.length === 0 ? (
          <p className="px-2 py-6 text-sm text-muted-foreground">Loading shemenmusic.com…</p>
        ) : (
          tracks.map((track, index) => (
            <TrackRow
              key={track.id}
              track={track}
              index={index}
              isCurrent={currentTrackId === track.id}
              isPlaying={isPlaying && currentTrackId === track.id}
              onSelect={() => void playerController.playTrackById(track.id, tracks)}
              onContextMenu={(event) => openTrackMenu(event, track)}
              onQuickAddToQueue={() => playerController.addToQueue(track)}
            />
          ))
        )}
        {!isLoading && tracks.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-card text-muted-foreground">
              <MusicNoteIcon size={24} aria-hidden="true" />
            </span>
            <p className="text-sm font-medium text-foreground">
              {debouncedQuery ? `No instrumentals match “${debouncedQuery}”` : "Nothing to show yet"}
            </p>
            <p className="max-w-xs text-sm text-muted-foreground">
              {debouncedQuery
                ? "Try a different title, artist or tag."
                : "The most-played instrumentals on shemenmusic.com will show up here."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
