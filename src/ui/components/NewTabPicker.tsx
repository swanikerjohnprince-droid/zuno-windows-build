import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { FolderIcon, HomeIcon, MusicNoteIcon } from "@/ui/icons";
import { popupScrimStyle, usePopupBounds } from "../popupBounds";

export type NewTabKind = "music" | "files" | "shemen";

interface NewTabPickerProps {
  open: boolean;
  onPick: (kind: NewTabKind) => void;
  onClose: () => void;
}

/**
 * What the "+" tab button asks before creating anything: a classic YouTube Music tab, a
 * file manager tab for local audio on the PC, or a shemenmusic.com instrumentals tab.
 *
 * Portalled and centred like ReleaseNoteDialog, so it survives whatever view is mounted when
 * the button is clicked. Escape and a scrim click both dismiss without creating a tab.
 */
export function NewTabPicker({ open, onPick, onClose }: NewTabPickerProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const popupBounds = usePopupBounds();

  const optionClass =
    "flex items-center gap-3 rounded-xl bg-card px-4 py-3 text-left ring-1 ring-border transition-colors hover:bg-card/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          /* Rounded to the window: a square scrim over a rounded window paints past the
             corner cutout. The variable is 0 when maximized, so it follows the window. */
          className="fixed inset-0 z-[200] flex items-center justify-center overflow-hidden rounded-[var(--window-radius)] bg-background/70 p-6 backdrop-blur-sm"
          style={popupScrimStyle(popupBounds)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Choose new tab type"
            className="w-full max-w-sm rounded-2xl bg-popover p-5 text-popover-foreground shadow-2xl ring-1 ring-border"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 4, transition: { duration: 0.12 } }}
            transition={{ type: "spring", stiffness: 420, damping: 32, mass: 0.7 }}
          >
            <h2 className="text-lg font-bold tracking-tight">New tab</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              What should this tab open?
            </p>

            <div className="mt-4 flex flex-col gap-2">
              <button type="button" onClick={() => onPick("music")} className={optionClass}>
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <HomeIcon size={18} aria-hidden="true" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-semibold text-foreground">YouTube Music</span>
                  <span className="truncate text-xs text-muted-foreground">
                    Browse, search and play from YouTube Music
                  </span>
                </span>
              </button>

              <button type="button" onClick={() => onPick("files")} className={optionClass}>
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <FolderIcon size={18} aria-hidden="true" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-semibold text-foreground">File manager</span>
                  <span className="truncate text-xs text-muted-foreground">
                    Play audio files from your PC
                  </span>
                </span>
              </button>

              <button type="button" onClick={() => onPick("shemen")} className={optionClass}>
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <MusicNoteIcon size={18} aria-hidden="true" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-semibold text-foreground">Shemen Music</span>
                  <span className="truncate text-xs text-muted-foreground">
                    Royalty-free instrumentals from shemenmusic.com
                  </span>
                </span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
