import { createContext, useContext, type MouseEvent as ReactMouseEvent } from "react";
import type { Album, Playlist } from "../../datasource/types";

/**
 * Alone in its own module for the same reason as the track menu's context — see
 * trackContextMenuContext.ts. A `createContext()` that sits next to components is re-created
 * by every hot update that touches them, and the provider and its consumers end up holding
 * two different objects.
 */
export interface PlaylistContextMenuValue {
  openPlaylistMenu: (event: ReactMouseEvent, playlist: Playlist) => void;
  openAlbumMenu: (event: ReactMouseEvent, album: Album) => void;
}

export const PlaylistContext = createContext<PlaylistContextMenuValue | null>(null);

export function usePlaylistContextMenu(): PlaylistContextMenuValue {
  const value = useContext(PlaylistContext);
  if (!value) {
    throw new Error("usePlaylistContextMenu must be used within PlaylistContextMenuProvider.");
  }
  return value;
}
