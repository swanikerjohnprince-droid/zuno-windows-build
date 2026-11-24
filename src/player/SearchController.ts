import type { DataSource } from "../datasource/DataSource";
import type { Playlist, SearchResults, Track } from "../datasource/types";

export class SearchController {
  constructor(
    private readonly dataSource: DataSource,
    /**
     * Optional local-file search. When present, its tracks are merged ahead of the remote
     * results, so music from the user's own files has a part in every search.
     */
    private readonly searchLocal?: (query: string) => Promise<Track[]>,
    /** Local playlists, merged into the playlist results the same way. Sync: they live in memory. */
    private readonly searchLocalPlaylists?: (query: string) => Playlist[],
  ) {}

  async search(
    query: string,
    onUpdate?: (results: SearchResults) => void,
  ): Promise<SearchResults> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return { artists: [], tracks: [], albums: [], playlists: [] };
    }

    // Local playlists are in memory, so they are available immediately; local tracks need the scan.
    const localPlaylists = this.searchLocalPlaylists?.(normalizedQuery) ?? [];

    let localTracks: Track[] = [];
    const localStream = this.searchLocal
      ? Promise.resolve()
          .then(() => this.searchLocal?.(normalizedQuery) ?? [])
          .then((tracks) => {
            localTracks = tracks;
            // Local files answer in milliseconds — emit them straight away so the preview
            // shows something while the network search is still running.
            if ((tracks.length > 0 || localPlaylists.length > 0) && onUpdate) {
              onUpdate({ artists: [], tracks, albums: [], playlists: localPlaylists });
            }
            return tracks;
          })
          .catch(() => [] as Track[])
      : Promise.resolve([] as Track[]);

    const mergedOnUpdate = onUpdate
      ? (results: SearchResults) => onUpdate(this.mergeLocal(results, localTracks, localPlaylists))
      : undefined;

    let remote: SearchResults;
    if (this.dataSource.search) {
      remote = await this.dataSource.search(normalizedQuery, mergedOnUpdate);
    } else {
      const tracks = await this.searchTracks(normalizedQuery, (items) => {
        mergedOnUpdate?.({ artists: [], tracks: items, albums: [], playlists: [] });
      });
      remote = { artists: [], tracks, albums: [], playlists: [] };
    }
    await localStream;
    return this.mergeLocal(remote, localTracks, localPlaylists);
  }

  /**
   * Local results are mixed into their section ahead of the remote ones rather than split out;
   * ids never collide across sources (local ids carry a `local:` prefix). Callers badge the
   * local entries inline ("Your files").
   */
  private mergeLocal(
    results: SearchResults,
    localTracks: Track[],
    localPlaylists: Playlist[],
  ): SearchResults {
    if (!localTracks.length && !localPlaylists.length) return results;
    return {
      ...results,
      tracks: [...localTracks, ...results.tracks],
      playlists: [...localPlaylists, ...results.playlists],
    };
  }

  async searchTracks(query: string, onUpdate?: (tracks: Track[]) => void): Promise<Track[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery || !this.dataSource.searchTracks) return [];
    return this.dataSource.searchTracks(normalizedQuery, onUpdate);
  }

  async getSearchSuggestions(
    query: string,
    onUpdate?: (suggestions: string[]) => void,
  ): Promise<string[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery || !this.dataSource.getSearchSuggestions) return [];
    return this.dataSource.getSearchSuggestions(normalizedQuery, onUpdate);
  }
}
