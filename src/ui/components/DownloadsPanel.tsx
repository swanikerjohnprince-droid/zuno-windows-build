import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/motion/button";
import { Tooltip } from "@/components/motion/tooltip";
import { CheckIcon, CloseIcon, DownloadIcon } from "@/ui/icons";
import type { Track } from "../../datasource/types";
import { cancelDownload, useOfflineState } from "../../player/offlineStore";
import { FloatingPanel } from "./FloatingPanel";
import { TrackArtwork } from "./TrackArtwork";

/** Newest first, and only a handful: the full list lives on the Downloads page. */
const RECENT_LIMIT = 4;

function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function DownloadRow({
  track,
  status,
  progress,
  onCancel,
}: {
  track: Track;
  status: string;
  progress?: number | null;
  onCancel?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-2 py-2">
      <TrackArtwork
        className="size-10 shrink-0 rounded-lg"
        size={40}
        artworkUrl={track.artworkUrl}
        iconSize={18}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm text-foreground">{track.title}</span>
        <span className="truncate text-xs text-muted-foreground">{status}</span>
        {progress !== undefined && (
          /* A determinate bar where the size is known, an indeterminate shimmer where it is
             not — a bar stuck at 0% reads as a stall rather than as "still measuring". */
          <span className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-muted">
            <span
              className={cn(
                "block h-full rounded-full bg-primary transition-[width] duration-300",
                progress === null && "w-1/3 animate-pulse",
              )}
              style={progress === null ? undefined : { width: `${progress}%` }}
            />
          </span>
        )}
      </span>
      {onCancel && (
        <button
          type="button"
          className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onCancel}
          aria-label={`Cancel download of ${track.title}`}
        >
          <CloseIcon size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/**
 * Downloads, as a toolbar button.
 *
 * The badge counts what is *in flight*, not what is stored: a number that never goes back down
 * is a number nobody reads. Everything here comes from the offline store's own state, so the
 * panel costs nothing to keep open and needs no fetching of its own.
 */
export function DownloadsPanel({ onOpenDownloads }: { onOpenDownloads?: () => void }) {
  const [open, setOpen] = useState(false);
  const offline = useOfflineState();

  const downloadingTrack = offline.downloadingId ? offline.pending[offline.downloadingId] : undefined;
  const queuedTracks = offline.queued
    .filter((id) => id !== offline.downloadingId)
    .map((id) => offline.pending[id])
    .filter((track): track is Track => Boolean(track));
  const failed = Object.entries(offline.failed);
  const recent = Object.values(offline.entries)
    .sort((left, right) => right.downloadedAt - left.downloadedAt)
    .slice(0, RECENT_LIMIT);
  const activeCount = (downloadingTrack ? 1 : 0) + queuedTracks.length;
  const storedCount = Object.keys(offline.entries).length;

  return (
    <FloatingPanel
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      className="w-96 max-w-[calc(100vw-2rem)] p-2"
      trigger={
        <Tooltip
          side="bottom"
          content={activeCount > 0 ? `Downloading ${activeCount}` : "Downloads"}
        >
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={activeCount > 0 ? `Downloads, ${activeCount} in progress` : "Downloads"}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <DownloadIcon
              size={16}
              aria-hidden="true"
              className={cn("transition-opacity", activeCount > 0 ? "text-primary" : "opacity-40")}
            />
            {activeCount > 0 && (
              <span
                className="absolute right-0.5 top-0.5 min-w-3.5 rounded-full bg-primary px-1 text-[10px] font-semibold leading-3.5 text-primary-foreground"
                aria-hidden="true"
              >
                {activeCount > 9 ? "9+" : activeCount}
              </span>
            )}
          </Button>
        </Tooltip>
      }
    >
      <div className="flex items-center justify-between gap-2 px-2 pb-1.5 pt-1">
        <span className="text-sm font-semibold text-foreground">Downloads</span>
        <span className="text-xs text-muted-foreground">
          {storedCount > 0 ? `${storedCount} saved · ${formatBytes(offline.usedBytes)}` : "Nothing saved"}
        </span>
      </div>

      {activeCount === 0 && failed.length === 0 && recent.length === 0 ? (
        <p className="px-3 py-8 text-center text-sm text-muted-foreground">
          Nothing downloaded yet. Save a song for offline and it shows up here.
        </p>
      ) : (
        <div className="flex max-h-96 flex-col gap-0.5 overflow-y-auto">
          {downloadingTrack && (
            <DownloadRow
              track={downloadingTrack}
              status={offline.progress === null ? "Downloading…" : `Downloading · ${offline.progress}%`}
              progress={offline.progress}
              onCancel={() => cancelDownload(downloadingTrack.id)}
            />
          )}

          {queuedTracks.map((track, index) => (
            <DownloadRow
              key={track.id}
              track={track}
              status={`Queued · ${index + 1} of ${queuedTracks.length}`}
              onCancel={() => cancelDownload(track.id)}
            />
          ))}

          {failed.map(([trackId, message]) => {
            const track = offline.pending[trackId] ?? offline.entries[trackId]?.track;
            return track ? (
              <DownloadRow key={trackId} track={track} status={`Failed · ${message}`} />
            ) : null;
          })}

          {recent.length > 0 && (
            <>
              {activeCount > 0 && (
                <span className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                  Recently saved
                </span>
              )}
              {recent.map((entry) => (
                <div key={entry.track.id} className="flex items-center gap-3 rounded-xl px-2 py-2">
                  <TrackArtwork
                    className="size-10 shrink-0 rounded-lg"
                    size={40}
                    artworkUrl={entry.track.artworkUrl}
                    iconSize={18}
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm text-foreground">{entry.track.title}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {formatBytes(entry.byteLength)}
                    </span>
                  </span>
                  <CheckIcon size={16} aria-hidden="true" className="shrink-0 text-primary" />
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {onOpenDownloads && (
        <button
          type="button"
          className="mt-1 w-full rounded-xl px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={() => {
            setOpen(false);
            onOpenDownloads();
          }}
        >
          Open downloads
        </button>
      )}
    </FloatingPanel>
  );
}
