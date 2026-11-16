import { cn } from "@/lib/utils";
import { GoogleIcon } from "@/ui/icons";
import { SpinnerSteps } from "@/components/motion/loader";

interface GoogleSignInButtonProps {
  onClick: () => void;
  /** Shows a spinner and blocks re-entry while a sign-in is already running. */
  isBusy?: boolean;
  disabled?: boolean;
  /** Stretches to the container — for the title-bar panel and the sidebar's empty state. */
  fullWidth?: boolean;
  /**
   * Drops the label for the collapsed sidebar rail, which is 72px wide.
   *
   * The accessible name stays on the button either way, so this only removes the *visible*
   * text — a screen reader still announces "Sign in with Google", and the title attribute
   * gives sighted users the same on hover.
   */
  iconOnly?: boolean;
  size?: "sm" | "md";
  className?: string;
}

/**
 * The one sign-in button, used everywhere signing in is offered.
 *
 * It was three separate buttons — a brand-red pill in the sidebar, a primary `Button` in the
 * title-bar panel, and a third in settings with a generic login glyph — which meant the most
 * consequential action in the app looked like three different actions. Signing in hands
 * credentials to Google's own page, so it should look like what it is, and look the same
 * everywhere it is offered.
 *
 * Deliberately not brand-red: the surface is white (or near-black in dark mode) with the
 * four-colour G, which is the convention every Google sign-in button follows and the reason
 * this one is instantly recognisable as safe rather than as one more red button in a red app.
 */
export function GoogleSignInButton({
  onClick,
  isBusy = false,
  disabled = false,
  fullWidth = false,
  iconOnly = false,
  size = "md",
  className,
}: GoogleSignInButtonProps) {
  const glyphSize = size === "sm" ? 15 : 17;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isBusy}
      aria-busy={isBusy}
      aria-label="Sign in with Google"
      title="Sign in with Google"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-medium",
        "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-60",
        /*
         * A fixed light surface in both themes, and the one place in the app that is not a
         * token. Google's mark is specified against white; on a dark card the G's blue and
         * green lose enough contrast to stop reading as the Google mark at 18px.
         */
        "bg-white text-[#1f1f1f] shadow-sm ring-1 ring-black/10 hover:bg-white/90",
        iconOnly
          // Square so it stays a circle, and sized to match the rail's other icon buttons.
          ? (size === "sm" ? "size-9" : "size-10")
          : cn("gap-2.5", size === "sm" ? "px-3.5 py-1.5 text-sm" : "px-5 py-2.5 text-sm"),
        fullWidth && !iconOnly && "w-full",
        className,
      )}
    >
      {isBusy ? <SpinnerSteps size={glyphSize} /> : <GoogleIcon size={glyphSize} />}
      {!iconOnly && (isBusy ? "Connecting…" : "Sign in with Google")}
    </button>
  );
}
