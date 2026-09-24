import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * Shimmer placeholders shaped like the rows and cards they stand in for.
 *
 * A spinner says "wait"; a shape says "this is what's coming" — the difference between a web
 * page and something that feels native. Every skeleton here is sized off the real component it
 * precedes (`TrackRow`, `AlbumCard`, `PickCard`) so the swap from placeholder to content never
 * jumps the layout.
 *
 * `aria-hidden` throughout: the loading state is announced once, by the `role="status"` wrapper
 * around the whole group, not once per bar.
 */

/** The one shape every skeleton here is built from. */
function SkeletonBlock({
  className,
  style,
  delayMs = 0,
}: {
  className?: string;
  style?: CSSProperties;
  delayMs?: number;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-lg bg-foreground/10", className)}
      style={{ ...style, animationDelay: `${delayMs}ms` }}
    />
  );
}

/**
 * One `TrackRow`'s worth of nothing.
 *
 * Every measurement here is copied from `TrackRow` itself, not eyeballed: the `w-6` index
 * column, the unrounded `size-10` artwork, the `px-2 py-1.5` padding and the resulting 52px
 * height it advertises via `contain-intrinsic-size`. A skeleton that is a few pixels off is what
 * makes a list visibly resize the instant real rows replace it.
 */
export function TrackRowSkeleton({
  delayMs = 0,
  showArtwork = true,
}: {
  delayMs?: number;
  showArtwork?: boolean;
}) {
  return (
    <div className="flex h-[52px] w-full items-center gap-3 px-2 py-1.5">
      <div className="flex w-6 shrink-0 justify-end">
        <SkeletonBlock className="h-3 w-4" delayMs={delayMs} />
      </div>
      {showArtwork && <SkeletonBlock className="size-10 shrink-0" delayMs={delayMs} />}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <SkeletonBlock className="h-3.5 w-[55%]" delayMs={delayMs} />
        <SkeletonBlock className="h-3 w-[32%]" delayMs={delayMs} />
      </div>
    </div>
  );
}

/**
 * A stack of `TrackRowSkeleton`s standing in for a list of songs.
 *
 * Staggered by 60ms a row so the pulse sweeps down the list rather than every row blinking in
 * lockstep, which reads as one shape rather than a queue of content arriving.
 */
export function TrackListSkeleton({
  count = 8,
  showArtwork = true,
  label = "Loading songs",
}: {
  count?: number;
  showArtwork?: boolean;
  label?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5" role="status" aria-label={label}>
      {Array.from({ length: count }, (_, index) => (
        <TrackRowSkeleton key={index} delayMs={index * 60} showArtwork={showArtwork} />
      ))}
    </div>
  );
}

/**
 * One `AlbumCard`'s worth of nothing.
 *
 * `flex w-full flex-col gap-2 p-2` and the artwork's `rounded-none` are `AlbumCard`'s own
 * classes, copied rather than approximated — the card's corners are square, not the rounded
 * guess a generic "image placeholder" would reach for.
 */
export function AlbumCardSkeleton({ delayMs = 0 }: { delayMs?: number }) {
  return (
    <div className="flex w-full flex-col gap-2 p-2">
      <SkeletonBlock className="aspect-square w-full rounded-none" delayMs={delayMs} />
      <SkeletonBlock className="h-3.5 w-[78%]" delayMs={delayMs} />
      <SkeletonBlock className="h-3 w-[48%]" delayMs={delayMs} />
    </div>
  );
}

/** A grid of `AlbumCardSkeleton`s, matching the `auto-fill,minmax(9.5rem,1fr)` grids they precede. */
export function AlbumGridSkeleton({
  count = 6,
  label = "Loading",
}: {
  count?: number;
  label?: string;
}) {
  return (
    <div
      className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))]"
      role="status"
      aria-label={label}
    >
      {Array.from({ length: count }, (_, index) => (
        <AlbumCardSkeleton key={index} delayMs={index * 60} />
      ))}
    </div>
  );
}

/**
 * One `PickCard`'s worth of nothing — a slot for `CylinderCarousel` itself, not a replacement
 * for it.
 *
 * The carousel measures its own container and fits its curve, taper and item count to it (see
 * its `ResizeObserver`); a hand-built row of skeleton cards next to it would need to duplicate
 * all three and would still drift the moment either changed. Handing it these as `children`
 * instead means the loading state is exactly as responsive as the real one, because it *is* the
 * real one — only what fills each slot differs. `h-full` and `rounded-2xl` match the space the
 * carousel gives every child and `PickCard`'s own outer corner.
 */
export function PickCardSkeleton() {
  return <SkeletonBlock className="h-full w-full rounded-2xl" />;
}
