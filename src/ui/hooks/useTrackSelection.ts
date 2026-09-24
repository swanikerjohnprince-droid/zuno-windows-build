import { useCallback, useMemo, useRef, useState } from "react";
import type { Track } from "../../datasource/types";

export interface TrackSelection {
  selectedIds: ReadonlySet<string>;
  selectedCount: number;
  isSelected: (trackId: string) => boolean;
  /** True once anything is selected; lists use it to switch rows into selection mode. */
  isActive: boolean;
  /**
   * Handles a click on a row. Returns true when the click was consumed by selection, so the
   * caller knows not to also start playback.
   */
  handleRowClick: (event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }, index: number) => boolean;
  toggle: (trackId: string, index: number) => void;
  selectAll: () => void;
  clear: () => void;
  /** The selected tracks, in list order rather than click order. */
  getSelectedTracks: () => Track[];
}

/**
 * Multi-select for a track list.
 *
 * Modelled on file managers rather than on music apps: ctrl/cmd toggles one row, shift
 * extends from the last row touched, and a plain click without modifiers does nothing to the
 * selection so ordinary playback is unaffected until you opt in. The anchor is kept in a ref
 * because a shift-range depends on where the *previous* interaction was, which is not state
 * anything renders.
 */
export function useTrackSelection(tracks: Track[]): TrackSelection {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const anchorIndexRef = useRef<number | null>(null);

  const isSelected = useCallback(
    (trackId: string) => selectedIds.has(trackId),
    [selectedIds],
  );

  const toggle = useCallback((trackId: string, index: number) => {
    anchorIndexRef.current = index;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }, []);

  const handleRowClick = useCallback(
    (event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }, index: number) => {
      const track = tracks[index];
      if (!track) return false;

      if (event.shiftKey) {
        const anchor = anchorIndexRef.current ?? index;
        const [from, to] = anchor <= index ? [anchor, index] : [index, anchor];
        setSelectedIds((current) => {
          const next = new Set(current);
          for (let cursor = from; cursor <= to; cursor += 1) {
            const item = tracks[cursor];
            if (item) next.add(item.id);
          }
          return next;
        });
        return true;
      }

      if (event.ctrlKey || event.metaKey) {
        toggle(track.id, index);
        return true;
      }

      // No modifier: if a selection is open, a plain click collapses it rather than playing,
      // which is the behaviour that stops an accidental click losing a long selection.
      if (selectedIds.size > 0) {
        anchorIndexRef.current = index;
        setSelectedIds(new Set());
        return true;
      }

      anchorIndexRef.current = index;
      return false;
    },
    [selectedIds.size, toggle, tracks],
  );

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(tracks.map((track) => track.id)));
  }, [tracks]);

  const clear = useCallback(() => {
    anchorIndexRef.current = null;
    setSelectedIds(new Set());
  }, []);

  const getSelectedTracks = useCallback(
    () => tracks.filter((track) => selectedIds.has(track.id)),
    [selectedIds, tracks],
  );

  return useMemo(
    () => ({
      selectedIds,
      selectedCount: selectedIds.size,
      isSelected,
      isActive: selectedIds.size > 0,
      handleRowClick,
      toggle,
      selectAll,
      clear,
      getSelectedTracks,
    }),
    [clear, getSelectedTracks, handleRowClick, isSelected, selectAll, selectedIds, toggle],
  );
}
