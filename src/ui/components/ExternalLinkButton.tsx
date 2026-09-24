import { type ReactNode, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cn } from "@/lib/utils";
import { CheckActiveIcon, LinkIcon } from "@/ui/icons";
import { logInternalWarn } from "../../internal/logging";

/** How long the outcome stays on the button before it goes back to its label. */
const FEEDBACK_MS = 2600;

type Outcome = "idle" | "copied" | "failed";

interface ExternalLinkButtonProps {
  /** Optional: the update buttons are a label alone, sitting beside a filled Install. */
  icon?: ReactNode;
  label: string;
  url: string;
  /**
   * `quiet` is a text link for a header row; `card` is a filled pill for a button group.
   * Two named looks rather than a pile of style props — there are only ever these two.
   */
  variant?: "quiet" | "card";
  className?: string;
}

/**
 * A link out of the app that admits when it fails.
 *
 * Every one of these used to be `void openUrl(url)`, which discards the promise: if the
 * opener has no registered browser, is blocked by the sandbox, or the plugin call rejects for
 * any other reason, the click did nothing and said nothing. On a desktop app that reads as a
 * dead button rather than as a failure, and the user's only recourse is to guess the URL.
 *
 * So the failure has somewhere to go: the address is copied to the clipboard and the button
 * says so, which leaves the user able to finish the job by hand.
 */
export function ExternalLinkButton({
  icon,
  label,
  url,
  variant = "card",
  className,
}: ExternalLinkButtonProps) {
  const [outcome, setOutcome] = useState<Outcome>("idle");
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
  }, []);

  const flash = (next: Outcome) => {
    setOutcome(next);
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => {
      resetTimerRef.current = null;
      setOutcome("idle");
    }, FEEDBACK_MS);
  };

  const open = async () => {
    try {
      await openUrl(url);
      // Deliberately no success state: the browser coming forward is the feedback, and a
      // tick on a button you have just navigated away from is talking to nobody.
      return;
    } catch (error) {
      logInternalWarn("ExternalLinkButton failed to open a URL", {
        url,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      await navigator.clipboard.writeText(url);
      flash("copied");
    } catch {
      // No browser and no clipboard: nothing left to offer but an honest failure.
      flash("failed");
    }
  };

  const message =
    outcome === "copied" ? "Link copied" : outcome === "failed" ? "Couldn't open" : label;

  return (
    <button
      type="button"
      onClick={() => void open()}
      // The destination, spelled out. An icon and two words do not tell anyone where they
      // are about to be sent, and this is the only place the URL is visible.
      title={url}
      aria-label={`${label} — opens ${url} in your browser`}
      className={cn(
        "group/link flex items-center gap-2 rounded-full transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        variant === "card"
          ? "bg-card px-3.5 py-2 text-sm font-medium text-foreground hover:bg-muted"
          : "px-1 text-sm text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {outcome === "copied" ? (
        <CheckActiveIcon size={16} aria-hidden="true" className="text-primary" />
      ) : (
        icon ?? null
      )}
      <span className="tabular-nums">{message}</span>
      {/* Only on the idle label: once it reads "Link copied" there is nothing to follow. */}
      {outcome === "idle" && (
        <LinkIcon
          size={13}
          aria-hidden="true"
          className="opacity-0 transition-opacity group-hover/link:opacity-60"
        />
      )}
      {/* Announced rather than only coloured, so the outcome is not sight-only. */}
      <span role="status" aria-live="polite" className="sr-only">
        {outcome === "copied"
          ? `Could not open the browser. ${url} copied to the clipboard.`
          : outcome === "failed"
            ? `Could not open ${url}.`
            : ""}
      </span>
    </button>
  );
}
