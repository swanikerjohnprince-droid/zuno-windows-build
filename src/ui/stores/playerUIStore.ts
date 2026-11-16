import { useSyncExternalStore } from "react";

export interface PlayerUIState {
  isSeeking: boolean;
  isDraggingVolume: boolean;
  showAlbumArt: boolean;
  isLyricsOpen: boolean;
  isLyricsFullscreen: boolean;
  isQueueOpen: boolean;
}

type Listener = () => void;

class PlayerUIStore {
  private state: PlayerUIState = {
    isSeeking: false,
    isDraggingVolume: false,
    showAlbumArt: true,
    isLyricsOpen: false,
    isLyricsFullscreen: false,
    isQueueOpen: false,
  };
  private listeners = new Set<Listener>();

  getState(): PlayerUIState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(partial: Partial<PlayerUIState>) {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  private emit() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  setSeeking(isSeeking: boolean) {
    this.setState({ isSeeking });
  }

  setDraggingVolume(isDraggingVolume: boolean) {
    this.setState({ isDraggingVolume });
  }

  setShowAlbumArt(showAlbumArt: boolean) {
    this.setState({ showAlbumArt });
  }

  setLyricsOpen(isLyricsOpen: boolean) {
    // Leaving the lyrics view leaves fullscreen with it — there is nothing left to be
    // fullscreen about, and the window would otherwise get stuck edge-to-edge.
    this.setState(isLyricsOpen ? { isLyricsOpen } : { isLyricsOpen, isLyricsFullscreen: false });
  }

  toggleLyrics() {
    this.setLyricsOpen(!this.state.isLyricsOpen);
  }

  setLyricsFullscreen(isLyricsFullscreen: boolean) {
    this.setState({ isLyricsFullscreen });
  }

  setQueueOpen(isQueueOpen: boolean) {
    this.setState({ isQueueOpen });
  }

  toggleQueue() {
    this.setState({ isQueueOpen: !this.state.isQueueOpen });
  }
}

export const playerUIStore = new PlayerUIStore();

export function usePlayerUIState() {
  return useSyncExternalStore(
    (listener) => playerUIStore.subscribe(listener),
    () => playerUIStore.getState(),
    () => playerUIStore.getState(),
  );
}
