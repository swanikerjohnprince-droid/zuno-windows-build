import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { cn } from "@/lib/utils";
import { Loader } from "@/components/motion/loader";
import { CloseIcon, MusicNoteIcon } from "@/ui/icons";
import type { Track } from "../../datasource/types";
import { logInternalError } from "../../internal/logging";
import { forgetArtworkSource } from "../../internal/artworkCache";
import { LOCAL_ARTWORK_PREFIX } from "../../player/localPlaylists";

export interface LocalAudioTags {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  genre?: string;
  trackNumber?: number;
  year?: number;
}

/** What the save should do with the file's cover. `keep` is the default. */
type ArtworkEdit =
  | { kind: "keep" }
  | { kind: "remove" }
  | { kind: "replace"; mimeType: string; dataBase64: string };

interface LocalArtwork {
  mimeType: string;
  dataBase64: string;
}

const FIELDS: Array<{
  key: keyof LocalAudioTags;
  label: string;
  numeric?: boolean;
  min?: number;
  max?: number;
}> = [
  { key: "title", label: "Title" },
  { key: "artist", label: "Artist" },
  { key: "album", label: "Album" },
  { key: "albumArtist", label: "Album artist" },
  { key: "genre", label: "Genre" },
  { key: "trackNumber", label: "Track number", numeric: true, min: 1, max: 9999 },
  { key: "year", label: "Year", numeric: true, min: 1, max: 9999 },
];

const FIELD =
  "w-full min-w-0 rounded-lg bg-background px-2.5 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-inset focus:ring-border";
const GHOST_BUTTON =
  "rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function toDataUrl(artwork: LocalArtwork): string {
  return `data:${artwork.mimeType};base64,${artwork.dataBase64}`;
}

/**
 * Edits the tags written into a local audio file, cover art included.
 *
 * Values are loaded from the file rather than from the scanned track: the scanner falls back
 * to the filename and parent folder when a file has no tags, and saving those guesses back
 * would silently turn them into real metadata.
 */
export function TagEditor({
  track,
  onClose,
  onSaved,
}: {
  track: Track;
  onClose: () => void;
  /** Fired after a successful write so the caller can rescan. */
  onSaved?: () => void;
}) {
  const [tags, setTags] = useState<LocalAudioTags | null>(null);
  const [loadedTags, setLoadedTags] = useState<LocalAudioTags | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [artwork, setArtwork] = useState<ArtworkEdit>({ kind: "keep" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pickingImage, setPickingImage] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (!track.localPath) {
      setError("This song has no file on disk.");
      return;
    }
    const path = track.localPath;

    invoke<LocalAudioTags>("local_audio_read_tags", { path })
      .then((loaded) => {
        if (cancelled) return;
        setTags(loaded);
        setLoadedTags(loaded);
      })
      .catch((cause: unknown) => {
        logInternalError("TagEditor.read failed", cause, { path });
        if (!cancelled) setError("Could not read the tags on this file.");
      });

    // Separate from the tags read so a file with unreadable art still opens for text editing.
    invoke<LocalArtwork | null>("local_audio_artwork", { path })
      .then((existing) => {
        if (!cancelled && existing) setCoverUrl(toDataUrl(existing));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [track.localPath]);

  // Focus the first field once the values are in, so the dialog opens ready to type.
  useEffect(() => {
    if (tags) firstFieldRef.current?.focus();
  }, [tags]);

  /*
   * Save stays disabled until something actually differs. Writing tags rewrites the file, so an
   * accidental save on a dialog opened to look at the values is a real change to disk.
   */
  const isDirty = useMemo(() => {
    if (artwork.kind !== "keep") return true;
    if (!tags || !loadedTags) return false;
    return FIELDS.some((field) => (tags[field.key] ?? "") !== (loadedTags[field.key] ?? ""));
  }, [artwork, tags, loadedTags]);

  const chooseImage = useCallback(async () => {
    setError(null);
    setPickingImage(true);
    try {
      const selected = await openDialog({
        multiple: false,
        title: "Choose cover art",
        filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "gif", "bmp", "webp"] }],
      });
      if (typeof selected !== "string") return;
      const image = await invoke<LocalArtwork>("read_image_file", { path: selected });
      setArtwork({ kind: "replace", mimeType: image.mimeType, dataBase64: image.dataBase64 });
      setCoverUrl(toDataUrl(image));
    } catch (cause) {
      logInternalError("TagEditor.image pick failed", cause, { path: track.localPath });
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPickingImage(false);
    }
  }, [track.localPath]);

  const save = useCallback(async () => {
    if (!tags || !track.localPath || saving || !isDirty) return;
    setSaving(true);
    setError(null);
    try {
      await invoke("local_audio_write_tags", {
        path: track.localPath,
        tags: { ...tags, artwork },
      });
      // The cover for this path is cached as a blob under every size bucket it was shown at.
      // Without this the row keeps painting the old art until the app restarts.
      if (artwork.kind !== "keep") {
        forgetArtworkSource(`${LOCAL_ARTWORK_PREFIX}${track.localPath}`);
      }
      onSaved?.();
      onClose();
    } catch (cause) {
      logInternalError("TagEditor.write failed", cause, { path: track.localPath });
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }, [artwork, isDirty, onClose, onSaved, saving, tags, track.localPath]);

  // A save rewrites the file, so closing mid-write is not offered.
  const requestClose = useCallback(() => {
    if (!saving) onClose();
  }, [onClose, saving]);

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-background/70 p-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit tags for ${track.title}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
      /*
       * On the dialog, not on every input. Escape used to close only while a text field had
       * focus, so it did nothing from the artwork controls or the buttons.
       */
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          requestClose();
        }
      }}
    >
      <div className="flex w-full max-w-lg flex-col gap-4 rounded-2xl bg-popover p-5 shadow-2xl ring-1 ring-border">
        <header className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <h2 className="text-base font-semibold text-foreground">Edit tags</h2>
            <p className="truncate text-xs text-muted-foreground" title={track.localPath}>
              {track.localPath}
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CloseIcon size={18} />
          </button>
        </header>

        {tags === null && !error ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader variant="spinner" size={16} />
            Reading tags...
          </div>
        ) : tags === null ? null : (
          <div className="flex gap-4">
            <div className="flex shrink-0 flex-col items-center gap-2">
              <div className="grid size-28 place-items-center overflow-hidden rounded-xl bg-card text-muted-foreground">
                {coverUrl ? (
                  <img src={coverUrl} alt="" className="size-full object-cover" />
                ) : (
                  <MusicNoteIcon size={28} aria-hidden="true" />
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className={GHOST_BUTTON}
                  disabled={pickingImage || saving}
                  onClick={() => void chooseImage()}
                >
                  {pickingImage ? "Reading..." : coverUrl ? "Replace" : "Add cover"}
                </button>
                {coverUrl && (
                  <button
                    type="button"
                    className={GHOST_BUTTON}
                    disabled={saving}
                    onClick={() => {
                      setArtwork({ kind: "remove" });
                      setCoverUrl(null);
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>

            <div className="grid min-w-0 flex-1 grid-cols-2 gap-3">
              {FIELDS.map((field, index) => (
                <label
                  key={field.key}
                  className={cn(
                    "flex min-w-0 flex-col gap-1 text-xs text-muted-foreground",
                    !field.numeric && "col-span-2",
                  )}
                >
                  {field.label}
                  <input
                    ref={index === 0 ? firstFieldRef : undefined}
                    className={FIELD}
                    type={field.numeric ? "number" : "text"}
                    min={field.min}
                    max={field.max}
                    inputMode={field.numeric ? "numeric" : undefined}
                    value={String(tags[field.key] ?? "")}
                    onChange={(event) => {
                      const raw = event.target.value;
                      setTags((current) => ({
                        ...current,
                        // Blank clears the tag, which is why undefined is stored rather than "".
                        [field.key]: field.numeric
                          ? (raw === "" ? undefined : clampNumber(raw, field.min, field.max))
                          : (raw === "" ? undefined : raw),
                      }));
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void save();
                    }}
                  />
                </label>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <footer className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={requestClose}
            disabled={saving}
            className="rounded-full px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || tags === null || !isDirty}
            onClick={() => void save()}
            className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.02] active:scale-95 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {saving ? "Saving..." : "Save to file"}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Keeps a hand-typed year or track number inside what the tag formats can hold. */
function clampNumber(raw: string, min = 0, max = Number.MAX_SAFE_INTEGER): number | undefined {
  const value = Math.trunc(Number(raw));
  if (!Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}
