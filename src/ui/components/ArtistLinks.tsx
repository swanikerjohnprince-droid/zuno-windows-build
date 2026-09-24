import {
  createContext,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useContext,
  useMemo,
  useRef,
} from "react";
import type { Artist, ArtistReference } from "../../datasource/types";
import { cn } from "@/lib/utils";
import { isMacOS } from "../platform";

type NavigateArtist = (artist: Artist, openInNewTab: boolean) => void;

const ArtistNavigationContext = createContext<NavigateArtist | null>(null);

function getFallbackArtists(fallback: string): ArtistReference[] {
  return fallback
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ id: "", name }));
}

export function ArtistNavigationProvider({
  children,
  onNavigate,
}: {
  children: ReactNode;
  onNavigate: NavigateArtist;
}) {
  /*
   * Stabilised here rather than asking every caller to `useCallback` it. The navigate handler
   * closes over most of App's state, so a correct dependency list would be long and would
   * change constantly anyway — and this provider wraps the whole app, so a new value means
   * every artist link in every list re-renders.
   */
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;
  const navigate = useMemo<NavigateArtist>(
    () => (artist, openInNewTab) => navigateRef.current(artist, openInNewTab),
    [],
  );

  return (
    <ArtistNavigationContext.Provider value={navigate}>
      {children}
    </ArtistNavigationContext.Provider>
  );
}

export function ArtistLinks({
  artists,
  fallback,
  className,
  interactive = true,
  suppressArtistId,
}: {
  artists?: ArtistReference[];
  fallback: string;
  className?: string;
  interactive?: boolean;
  suppressArtistId?: string;
}) {
  const navigate = useContext(ArtistNavigationContext);

  if (!navigate) {
    return <span className={className}>{fallback}</span>;
  }

  const openArtist = (
    event: MouseEvent<HTMLSpanElement> | KeyboardEvent<HTMLSpanElement>,
    artist: ArtistReference,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const hasPrimaryModifier = isMacOS ? event.metaKey : event.ctrlKey;
    const openInNewTab = "button" in event
      ? event.button === 1 || event.shiftKey || hasPrimaryModifier
      : event.shiftKey || hasPrimaryModifier;
    navigate({ id: artist.id, name: artist.name }, openInNewTab);
  };

  const isSuppressed = (artist: ArtistReference) =>
    suppressArtistId && artist.id === suppressArtistId;

  const renderArtist = (artist: ArtistReference) => {
    const suppressed = isSuppressed(artist);
    const isDisabled = !interactive || suppressed;
    return (
      <span className={cn("min-w-0", isDisabled && "pointer-events-none")}>
        {isDisabled ? (
          <span className="text-inherit">
            {artist.name}
          </span>
        ) : (
          <span
            className="cursor-pointer rounded-sm text-inherit underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            role="link"
            tabIndex={0}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => openArtist(event, artist)}
            onAuxClick={(event) => {
              if (event.button === 1) openArtist(event, artist);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                openArtist(event, artist);
              }
            }}
          >
            {artist.name}
          </span>
        )}
      </span>
    );
  };

  const rendered = (() => {
    if (!artists?.length) {
      if (!fallback || fallback === "Unknown artist") {
        return <span className={className}>{fallback}</span>;
      }
      const fallbackArtists = getFallbackArtists(fallback);
      return (
        <span className={className}>
          {fallbackArtists.map((artist, index) => (
            <span key={`${artist.id}:${artist.name}`}>
              {index > 0 && ", "}
              {renderArtist(artist)}
            </span>
          ))}
        </span>
      );
    }

    return (
      <span className={className}>
        {artists.map((artist, index) => (
          <span key={`${artist.id}:${artist.name}`}>
            {index > 0 && ", "}
            {renderArtist(artist)}
          </span>
        ))}
      </span>
    );
  })();

  return <>{rendered}</>;
}
