import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/motion/tooltip";
import { SpinnerSteps } from "@/components/motion/loader";
import { CheckActiveIcon, DownloadIcon } from "@/ui/icons";
import { usePlayerSelector } from "../../../player/playerStore";
import {
  cancelDownload,
  queueDownload,
  removeDownload,
  useOfflineState,
} from "../../../player/offlineStore";

const RING_RADIUS = 8;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * Download state for the song that is actually playing.
 *
 * This replaced an indicator that lit up for *any* download in the queue, which meant the
 * player bar reported on a song the listener might not have thought about for ten minutes
 * and gave them no way to act on it. One control, bound to the now-playing track, that both
 * reports and does something — the same download / cancel / remove contract as the track
 * context menu, so the two can never disagree about what a click means.
 */
export function DownloadButton() {
  const track = usePlayerSelector((state) => state.currentTrack);
  const offline = useOfflineState();

  // Local files are already on disk; a download control for them is a button that lies.
  if (!track || track.source === "local") return null;

  const isReady = Boolean(offline.entries[track.id]);
  const isDownloading = offline.downloadingId === track.id;
  const queuePosition = offline.queued.indexOf(track.id);
  const isQueued = queuePosition >= 0;
  const progress = isDownloading ? offline.progress : null;

  const label = isReady
    ? "Remove download"
    : isDownloading
      ? progress === null
        ? "Downloading — cancel"
        : `Downloading, ${Math.round(progress)}% — cancel`
      : isQueued
        ? `Queued to download, ${queuePosition + 1} in line — cancel`
        : "Download for offline";

  const onClick = () => {
    if (isReady) void removeDownload(track.id);
    else if (isDownloading || isQueued) cancelDownload(track.id);
    else queueDownload(track);
  };

  return (
    <Tooltip content={label}>
      <button
        type="button"
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isReady || isDownloading
            ? "text-primary"
            : isQueued
              ? "text-muted-foreground"
              : "text-muted-foreground hover:text-foreground",
        )}
        onClick={onClick}
        aria-label={label}
      >
        {isReady ? (
          <CheckActiveIcon size={19} aria-hidden="true" />
        ) : isDownloading && progress !== null ? (
          <ProgressRing progress={progress} />
        ) : isDownloading ? (
          /* The backend only reports a percentage once it knows the total size. Until then a
             determinate ring would have to invent a number, so it spins instead. */
          <SpinnerSteps size={17} />
        ) : (
          <DownloadIcon
            size={19}
            aria-hidden="true"
            className={cn(isQueued && "opacity-60")}
          />
        )}
      </button>
    </Tooltip>
  );
}

/** A ring rather than a percentage: at 8px of radius there is no room for two digits. */
function ProgressRing({ progress }: { progress: number }) {
  const filled = Math.min(1, Math.max(0, progress / 100));
  return (
    <svg viewBox="0 0 20 20" className="size-[19px] -rotate-90" aria-hidden="true">
      <circle
        cx="10"
        cy="10"
        r={RING_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.22}
        strokeWidth="2"
      />
      <circle
        cx="10"
        cy="10"
        r={RING_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${RING_CIRCUMFERENCE * filled} ${RING_CIRCUMFERENCE}`}
      />
    </svg>
  );
}
