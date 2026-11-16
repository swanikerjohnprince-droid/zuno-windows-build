import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Loader } from "@/components/motion/loader";
import { CheckActiveIcon, CloseIcon, UserIcon, UserPlusIcon } from "@/ui/icons";
import type { AccountOption, GoogleAccountOption } from "../../datasource/types";
import type { LibraryController } from "../../player/LibraryController";
import { logInternalWarn } from "../../internal/logging";

/**
 * Small uppercase header a switcher renders directly above its own rows — never on its own, so
 * a section that has hidden itself (single option, `showSingle` off) can never leave an
 * orphaned label with nothing underneath it. This is what tells "Account" and "Channel" apart
 * in the title bar popover instead of both rendering as one undifferentiated list.
 */
function SectionLabel({ children }: { children: string }) {
  return (
    <span className="px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </span>
  );
}

/** Round profile image with a glyph fallback, shared by every account surface. */
export function AccountAvatar({
  artworkUrl,
  className,
  iconSize = 18,
}: {
  artworkUrl?: string;
  className?: string;
  iconSize?: number;
}) {
  const [failed, setFailed] = useState(false);

  // A new URL deserves a fresh attempt; without this, one broken image would poison the slot
  // for every account shown in it afterwards.
  useEffect(() => setFailed(false), [artworkUrl]);

  if (artworkUrl && !failed) {
    return (
      <img
        src={artworkUrl}
        alt=""
        className={cn("shrink-0 rounded-full object-cover", className)}
        onError={() => setFailed(true)}
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-card text-muted-foreground",
        className,
      )}
    >
      <UserIcon size={iconSize} aria-hidden="true" />
    </span>
  );
}

/**
 * Picks between the channels on the signed-in Google account.
 *
 * The accounts are fetched when this mounts rather than held in library state: the list only
 * matters while a switcher is open, and it costs a request to YouTube to build.
 */
export function AccountSwitcher({
  libraryController,
  onSwitched,
  showSingle = false,
  label,
  className,
}: {
  libraryController: LibraryController;
  /** Fired once a switch completes, so a popover can close itself. */
  onSwitched?: () => void;
  /**
   * Render even when only one channel was found. Settings sets this so you can see which
   * channel is active and that the lookup worked; the title bar popover does not, because a
   * picker with a single option is noise.
   */
  showSingle?: boolean;
  /** Small header rendered directly above the rows — see `SectionLabel`. Omit for none. */
  label?: string;
  className?: string;
}) {
  const [accounts, setAccounts] = useState<AccountOption[] | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    libraryController
      .listAccounts()
      .then((options) => {
        if (!cancelled) setAccounts(options);
      })
      .catch((error: unknown) => {
        logInternalWarn("AccountSwitcher.listAccounts failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        if (!cancelled) setAccounts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [libraryController]);

  const handleSelect = async (account: AccountOption) => {
    if (account.isActive || switchingId) return;
    setSwitchingId(account.id);
    try {
      await libraryController.selectAccount(account.id);
      // Closing here, not before the await: an early close unmounts the row and its
      // spinner on the same tick, so the switch looks like nothing happened.
      onSwitched?.();
    } finally {
      setSwitchingId(null);
    }
  };

  if (accounts === null) {
    return (
      <div className={cn("flex items-center gap-2 px-1  text-sm text-muted-foreground", className)}>
        <Loader variant="spinner" size={16} />
        Loading channels...
      </div>
    );
  }

  if (accounts.length === 0) {
    return showSingle ? (
      <p className={cn("px-2 py-2 text-sm text-muted-foreground", className)}>
        No channels were returned for this account.
      </p>
    ) : null;
  }
  // One channel is not a choice, so there is normally nothing to show.
  if (accounts.length === 1 && !showSingle) return null;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && <SectionLabel>{label}</SectionLabel>}
      <div className="flex flex-col gap-0.5">
        {accounts.map((account) => (
          <button
            key={account.id}
            type="button"
            disabled={Boolean(switchingId)}
            onClick={() => void handleSelect(account)}
            aria-current={account.isActive ? "true" : undefined}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/70",
              " disabled:pointer-events-none disabled:opacity-60",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              account.isActive && "bg-muted/40",
            )}
          >
            <AccountAvatar artworkUrl={account.artworkUrl} className="size-8" iconSize={16} />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{account.name}</span>
            {switchingId === account.id ? (
              <Loader variant="spinner" size={15} />
            ) : account.isActive ? (
              <CheckActiveIcon size={16} className="shrink-0 text-primary" aria-hidden="true" />
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Picks between separate Google logins with a stored session — not channels on one login (that
 * is `AccountSwitcher`), but different accounts entirely, switched without going through
 * sign-in again.
 *
 * Accounts are fetched on mount for the same reason `AccountSwitcher` does: the list only
 * matters while a switcher is open.
 */
export function GoogleAccountSwitcher({
  libraryController,
  onSwitched,
  showSingle = false,
  allowRemove = false,
  label,
  className,
}: {
  libraryController: LibraryController;
  /** Fired once a switch (or a removal that changes who is active) completes. */
  onSwitched?: () => void;
  /** Render even with only one stored account. Settings sets this so "Add account" has a list
   *  to attach to; the title-bar popover does not, since the header above it already says who
   *  you are and a picker with one option is noise. */
  showSingle?: boolean;
  /** Whether each row gets a remove control. Off in the title-bar popover — that is a quick
   *  switcher, not where you manage the list — on in Settings. */
  allowRemove?: boolean;
  /** Small header rendered directly above the rows — see `SectionLabel`. Omit for none. */
  label?: string;
  className?: string;
}) {
  const [accounts, setAccounts] = useState<GoogleAccountOption[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = () => {
    libraryController
      .listGoogleAccounts()
      .then(setAccounts)
      .catch((error: unknown) => {
        logInternalWarn("GoogleAccountSwitcher.listGoogleAccounts failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        setAccounts([]);
      });
  };

  useEffect(() => {
    let cancelled = false;
    libraryController
      .listGoogleAccounts()
      .then((options) => {
        if (!cancelled) setAccounts(options);
      })
      .catch((error: unknown) => {
        logInternalWarn("GoogleAccountSwitcher.listGoogleAccounts failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        if (!cancelled) setAccounts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [libraryController]);

  const handleSelect = async (account: GoogleAccountOption) => {
    if (account.isActive || busyId) return;
    setBusyId(account.id);
    try {
      await libraryController.switchGoogleAccount(account.id);
      // Closing here, not before the await: an early close unmounts the row and its spinner
      // on the same tick, so the switch looks like nothing happened.
      onSwitched?.();
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (account: GoogleAccountOption, event: React.MouseEvent) => {
    // Otherwise this bubbles into the row's own onClick and switches to the account being
    // removed a moment before it disappears.
    event.stopPropagation();
    if (busyId) return;
    setBusyId(account.id);
    try {
      await libraryController.removeGoogleAccount(account.id);
      if (account.isActive) onSwitched?.();
      reload();
    } finally {
      setBusyId(null);
    }
  };

  if (accounts === null) {
    return (
      <div className={cn("flex items-center gap-2 px-1 text-sm text-muted-foreground", className)}>
        <Loader variant="spinner" size={16} />
        Loading accounts...
      </div>
    );
  }

  // Zero is the moment between a full sign-out and the UI catching up; nothing to switch to.
  if (accounts.length === 0) return null;
  if (accounts.length === 1 && !showSingle) return null;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && <SectionLabel>{label}</SectionLabel>}
      <div className="flex flex-col gap-0.5">
        {accounts.map((account) => (
          <button
            key={account.id}
            type="button"
            disabled={Boolean(busyId)}
            onClick={() => void handleSelect(account)}
            aria-current={account.isActive ? "true" : undefined}
            className={cn(
              "group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/70",
              "disabled:pointer-events-none disabled:opacity-60",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              account.isActive && "bg-muted/40",
            )}
          >
            <AccountAvatar artworkUrl={account.artworkUrl} className="size-8" iconSize={16} />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{account.name}</span>
            {busyId === account.id ? (
              <Loader variant="spinner" size={15} />
            ) : (
              <>
                {account.isActive && (
                  <CheckActiveIcon size={16} className="shrink-0 text-primary" aria-hidden="true" />
                )}
                {allowRemove && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(event) => void handleRemove(account, event)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      void handleRemove(account, event as unknown as React.MouseEvent);
                    }}
                    aria-label={`Remove ${account.name}`}
                    className="flex shrink-0 items-center justify-center rounded-md p-1 opacity-0 transition-opacity hover:bg-background hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <CloseIcon size={14} aria-hidden="true" />
                  </span>
                )}
              </>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/** "+ Add account" — reuses sign-in as-is: re-authenticating an already-stored account renews
 *  it in place, and any other account lands as a genuinely new, additional stored account. */
export function AddGoogleAccountButton({
  onClick,
  disabled = false,
  className,
}: {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground",
        "disabled:pointer-events-none disabled:opacity-60",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        className,
      )}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-card text-muted-foreground">
        <UserPlusIcon size={16} aria-hidden="true" />
      </span>
      Add account
    </button>
  );
}
