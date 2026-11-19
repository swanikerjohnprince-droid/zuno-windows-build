import { useCallback, useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { cn } from "@/lib/utils";
import { CloseIcon, FolderAddIcon, FolderIcon, MusicNoteIcon, PlayIcon } from "@/ui/icons";
import type { Track } from "../../datasource/types";
import type { PlayerControllerActions } from "../../player/playerStore";
import { scanLocalAudioPaths } from "../../player/localPlaylists";
import { logInternalError } from "../../internal/logging";
import {
  addFilesTabSources,
  filesTabSourcePaths,
  getFilesTabSources,
  removeFilesTabSource,
  subscribeFilesTabSources,
  type FilesTabSource,
} from "./filesTabSources";
import { TrackRow } from "../components/TrackRow";
import { useTrackContextMenu } from "../components/TrackContextMenu";
import { useNowPlaying } from "../hooks/useNowPlaying";

/** Mirrors `is_local_audio_file` on the Rust side. */
const AUDIO_FILE_FILTER = {
  name: "Audio files",
  extensions: ["mp3", "m4a", "mp4", "aac", "flac", "wav", "ogg", "oga", "opus", "webm"],
};

/**
 * The "File manager" tab: local audio on the PC, browsable without leaving Zuno.
 *
 * Sources are picked through the OS dialog (individual files or a whole folder) and stored in
 * filesTabSources; the Rust `local_audio_scan` reads their tags — the same pipeline as the DJ
 * queue's "add from PC" — and every row plays through the normal local-file path.
 */
export function FilesPage({
  playerController,
}: {
  playerController: PlayerControllerActions;
}) {
  const [sources, setSources] = useState<FilesTabSource[]>(() => getFilesTabSources());
  const [tracks, setTracks] = useState<Track[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const { currentTrackId, isPlaying } = useNowPlaying();
  const { openTrackMenu, openPlaylistPicker } = useTrackContextMenu();

  useEffect(() => subscribeFilesTabSources(() => setSources(getFilesTabSources())), []);

  const paths = useMemo(() => filesTabSourcePaths(sources), [sources]);

  useEffect(() => {
    if (paths.length === 0) {
      setTracks([]);
      setScanError(null);
      return;
    }
    let active = true;
    setIsScanning(true);
    setScanError(null);
    scanLocalAudioPaths(paths)
      .then((scanned) => {
        if (active) setTracks(scanned);
      })
      .catch((error) => {
        logInternalError("FilesPage local scan failed", error);
        if (active) {
          setTracks([]);
          setScanError("Could not read these files. Check that the paths still exist.");
        }
      })
      .finally(() => {
        if (active) setIsScanning(false);
      });
    return () => {
      active = false;
    };
  }, [paths]);

  const handlePickFiles = useCallback(async () => {
    setIsPicking(true);
    try {
      const selected = await openDialog({
        title: "Add music from your PC",
        multiple: true,
        directory: false,
        filters: [AUDIO_FILE_FILTER],
      });
      if (!selected) return;
      const picked = Array.isArray(selected) ? selected : [selected];
      if (picked.length > 0) addFilesTabSources(picked, "file");
    } catch (error) {
      logInternalError("FilesPage file pick failed", error);
    } finally {
      setIsPicking(false);
    }
  }, []);

  const handlePickFolder = useCallback(async () => {
    setIsPicking(true);
    try {
      const selected = await openDialog({
        title: "Choose music folder",
        directory: true,
        multiple: false,
      });
      if (typeof selected !== "string" || !selected) return;
      addFilesTabSources([selected], "folder");
    } catch (error) {
      logInternalError("FilesPage folder pick failed", error);
    } finally {
      setIsPicking(false);
    }
  }, []);

  const playAll = useCallback(() => {
    const first = tracks[0];
    if (!first) return;
    void playerController.playTrackById(first.id, tracks);
  }, [playerController, tracks]);

  const actionButtonClass = cn(
    "flex shrink-0 items-center gap-2 rounded-full bg-card px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors",
    "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    "disabled:opacity-50",
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-3xl font-bold tracking-[-0.02em] text-foreground">Files</h1>
          <p className="text-sm text-muted-foreground">
            {sources.length === 0
              ? "Audio files from your PC"
              : `${tracks.length} ${tracks.length === 1 ? "track" : "tracks"} from ${sources.length} ${
                  sources.length === 1 ? "source" : "sources"
                }`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {tracks.length > 0 && (
            <button
              type="button"
              onClick={playAll}
              className={cn(
                actionButtonClass,
                "bg-primary text-primary-foreground hover:text-primary-foreground hover:opacity-90",
              )}
            >
              <PlayIcon size={15} aria-hidden="true" />
              Play all
            </button>
          )}
          <button
            type="button"
            onClick={handlePickFiles}
            disabled={isPicking}
            className={actionButtonClass}
          >
            <MusicNoteIcon size={16} aria-hidden="true" />
            Add files
          </button>
          <button
            type="button"
            onClick={handlePickFolder}
            disabled={isPicking}
            className={actionButtonClass}
          >
            <FolderAddIcon size={16} aria-hidden="true" />
            Add folder
          </button>
        </div>
      </header>

      {sources.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {sources.map((source) => (
            <span
              key={source.path}
              title={source.path}
              className="flex max-w-full items-center gap-1.5 rounded-full bg-card py-1 pl-3 pr-1 text-xs text-muted-foreground ring-1 ring-border"
            >
              {source.kind === "folder" ? (
                <FolderIcon size={13} aria-hidden="true" />
              ) : (
                <MusicNoteIcon size={13} aria-hidden="true" />
              )}
              <span className="max-w-72 truncate">{source.path}</span>
              <button
                type="button"
                aria-label={`Remove ${source.path}`}
                onClick={() => removeFilesTabSource(source.path)}
                className="grid size-5 shrink-0 place-items-center rounded-full hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CloseIcon size={12} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}

      {scanError && <p className="text-sm text-destructive">{scanError}</p>}

      {sources.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-card text-muted-foreground">
            <FolderIcon size={24} aria-hidden="true" />
          </span>
          <p className="text-sm font-medium text-foreground">No local files yet</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            Add audio files or a music folder from your PC and they will show up here, ready to
            play.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={handlePickFiles}
              disabled={isPicking}
              className={actionButtonClass}
            >
              <MusicNoteIcon size={16} aria-hidden="true" />
              Add files
            </button>
            <button
              type="button"
              onClick={handlePickFolder}
              disabled={isPicking}
              className={actionButtonClass}
            >
              <FolderAddIcon size={16} aria-hidden="true" />
              Add folder
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {isScanning && tracks.length === 0 ? (
            <p className="px-2 py-6 text-sm text-muted-foreground">Scanning…</p>
          ) : (
            tracks.map((track, index) => (
              <TrackRow
                key={track.id}
                track={track}
                index={index}
                showAlbum
                isCurrent={currentTrackId === track.id}
                isPlaying={isPlaying && currentTrackId === track.id}
                onSelect={() => void playerController.playTrackById(track.id, tracks)}
                onContextMenu={(event) => openTrackMenu(event, track)}
                onQuickAdd={() => openPlaylistPicker(track)}
                onQuickAddToQueue={() => playerController.addToQueue(track)}
              />
            ))
          )}
          {!isScanning && tracks.length === 0 && (
            <p className="px-2 py-6 text-sm text-muted-foreground">
              No audio files found in these sources.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
