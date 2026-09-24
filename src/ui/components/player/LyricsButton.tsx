import { cn } from "@/lib/utils";
import { LyricsActiveIcon, LyricsIcon } from "@/ui/icons";
import { usePlayerSelector } from "../../../player/playerStore";
import { usePlayerUIState } from "../../stores/playerUIStore";

interface LyricsButtonProps {
  onToggle: () => void;
}

export function LyricsButton({ onToggle }: LyricsButtonProps) {
  // The derived boolean, not the track: this only cares whether there is one, so it should
  // re-render when that flips and not on every change of song.
  const hasTrack = usePlayerSelector((state) => state.currentTrack !== null);
  const uiState = usePlayerUIState();
  const Glyph = uiState.isLyricsOpen ? LyricsActiveIcon : LyricsIcon;

  return (
    <button
      type="button"
      className={cn(
        "flex size-8 items-center justify-center rounded-full transition-colors",
        "disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        uiState.isLyricsOpen
          ? "bg-card text-primary"
          : "text-muted-foreground hover:text-foreground",
      )}
      onClick={onToggle}
      disabled={!hasTrack}
      aria-label={uiState.isLyricsOpen ? "Close lyrics" : "Open lyrics"}
      aria-pressed={uiState.isLyricsOpen}
    >
      <Glyph size={19} />
    </button>
  );
}
