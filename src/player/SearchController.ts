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
    /**
     * Optional shemenmusic.com search. Its instrumental tracks merge into the track results
     * ahead of the remote ones, exactly like local files; the UI badges them "Instrumental".
     */
    private readonly searchShemen?: (query: string) => Promise<Track[]>,
  ) {}

  async search(
    query: string,
    onUpdate?: (results: SearchResults) => void,
  ): Promise<SearchResults> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return { artists: [], tracks: [], albums: [], playlists: [] };
    }

    // Local playlists are in memory, so they are available immediately; local and shemen
    // tracks need their indexes, which answer in milliseconds once warm.
    const localPlaylists = this.searchLocalPlaylists?.(normalizedQuery) ?? [];

    let localTracks: Track[] = [];
    let shemenTracks: Track[] = [];
    // Emit whatever extras have landed straight away, so the preview shows something
    // while the network search is still running.
    const emitExtras = () => {
      if (!onUpdate) return;
      if (localTracks.length > 0 || shemenTracks.length > 0 || localPlaylists.length > 0) {
        onUpdate({
          artists: [],
          tracks: [...localTracks, ...shemenTracks],
          albums: [],
          playlists: localPlaylists,
        });
      }
    };
    const localStream = this.searchLocal
      ? Promise.resolve()
          .then(() => this.searchLocal?.(normalizedQuery) ?? [])
          .then((tracks) => {
            localTracks = tracks;
            emitExtras();
            return tracks;
          })
          .catch(() => [] as Track[])
      : Promise.resolve([] as Track[]);
    const shemenStream = this.searchShemen
      ? this.searchShemen(normalizedQuery)
          .then((tracks) => {
            shemenTracks = tracks;
            emitExtras();
            return tracks;
          })
          .catch(() => [] as Track[])
      : Promise.resolve([] as Track[]);

    const mergedOnUpdate = onUpdate
      ? (results: SearchResults) =>
          onUpdate(this.mergeExtras(results, [...localTracks, ...shemenTracks], localPlaylists))
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
    await Promise.all([localStream, shemenStream]);
    return this.mergeExtras(remote, [...localTracks, ...shemenTracks], localPlaylists);
  }

  /**
   * Non-YouTube results (local files, shemenmusic) are mixed into their section ahead of the
   * remote ones rather than split out; ids never collide across sources (they carry `local:`
   * or `shemen:` prefixes). Callers badge those entries inline ("Your files" / "Instrumental").
   */
  private mergeExtras(
    results: SearchResults,
    extraTracks: Track[],
    localPlaylists: Playlist[],
  ): SearchResults {
    if (!extraTracks.length && !localPlaylists.length) return results;
    return {
      ...results,
      tracks: [...extraTracks, ...results.tracks],
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
