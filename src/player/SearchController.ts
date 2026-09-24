import type { DataSource } from "../datasource/DataSource";
import type { SearchResults, Track } from "../datasource/types";

export class SearchController {
  constructor(private readonly dataSource: DataSource) {}

  async search(
    query: string,
    onUpdate?: (results: SearchResults) => void,
  ): Promise<SearchResults> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return { artists: [], tracks: [], albums: [], playlists: [] };
    }
    if (this.dataSource.search) {
      return this.dataSource.search(normalizedQuery, onUpdate);
    }
    const tracks = await this.searchTracks(normalizedQuery, (items) => {
      onUpdate?.({ artists: [], tracks: items, albums: [], playlists: [] });
    });
    return { artists: [], tracks, albums: [], playlists: [] };
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
