import type { Track } from "../../datasource/types";

export interface TrackPage {
  tracks: Track[];
  hasMore: boolean;
  nextPageKey?: string;
}

export interface CollectTrackPagesOptions {
  /** What is already loaded; the result starts from here. */
  initial: Track[];
  hasMore: boolean;
  nextPageKey?: string;
  /** Ceiling on requests, so a source that always says "more" cannot loop forever. */
  maxPages: number;
  fetchPage: (pageKey: string) => Promise<TrackPage>;
  /** Called after each page so the list can fill in as it loads rather than in one jump. */
  onPage?: (tracks: Track[], hasMore: boolean, nextPageKey: string | undefined) => void;
  /** Aborts the sweep — the user navigated away and these pages are for a different list. */
  isStale?: () => boolean;
}

/**
 * Pages a track list to the end.
 *
 * Extracted from the view because the loop's *termination* is the part that fails quietly:
 * a cursor that stops advancing spins forever, and a dedupe that is wrong drops songs from a
 * download without saying so. Both are checked in collectTrackPages.check.ts.
 *
 * Deliberately not a generator or a queue — one caller, one shape, and the whole point is that
 * it is small enough to read in one sitting.
 */
export async function collectTrackPages({
  initial,
  hasMore,
  nextPageKey,
  maxPages,
  fetchPage,
  onPage,
  isStale,
}: CollectTrackPagesOptions): Promise<Track[]> {
  let collected = initial;
  let pageKey = nextPageKey;
  let more = hasMore;
  const seen = new Set(initial.map((track) => track.id));

  for (let page = 0; more && pageKey && page < maxPages; page += 1) {
    const result = await fetchPage(pageKey);
    if (isStale?.()) return collected;

    const fresh = result.tracks.filter((track) => {
      if (seen.has(track.id)) return false;
      seen.add(track.id);
      return true;
    });

    /*
     * Nothing new *and* the cursor did not move means the source is handing back the same page.
     * Stopping is the only safe response: continuing would request it until maxPages runs out.
     */
    if (fresh.length === 0 && result.nextPageKey === pageKey) break;

    if (fresh.length > 0) collected = [...collected, ...fresh];
    more = result.hasMore;
    pageKey = result.nextPageKey;
    onPage?.(collected, more, pageKey);
  }

  return collected;
}
