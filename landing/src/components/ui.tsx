import type { AnchorHTMLAttributes, ReactNode } from "react";

/**
 * Class merger.
 *
 * The app uses clsx + tailwind-merge, which exist there because components take a `className`
 * override and have to resolve conflicts. Nothing on this page does, so a join is the whole
 * requirement — two dependencies for a filter would not earn their place.
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * Geometry, type and behaviour shared by every weight — only colour differs, so only colour
 * lives in the variants.
 *
 * Nothing glows and nothing floats. A tinted shadow spilling out from under a saturated pill,
 * a `brightness` filter on hover, an inset top highlight faking a lit edge — those are the
 * default settings of a button that nobody decided anything about. The press is the whole
 * interaction: colour shifts on hover, and the pill moves a single pixel *down* when it is
 * actually clicked, because that is the direction a pressed thing goes.
 *
 * `group` is in the base because the buttons carry icons that react to the button's own hover,
 * and a variant that forgot it would silently kill the nudge.
 */
const BASE =
  "group inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-full font-semibold tracking-[-0.01em] " +
  "transition-[background-color,border-color,color,transform] duration-150 ease-out " +
  "active:translate-y-px " +
  /* Offset colour set once here: Tailwind defaults it to white, which on this page draws a white
     gap around every focused button. `background` is right for the hero and the sections both. */
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * Size is a prop, not a `className` override.
 *
 * `cn` is a plain join, so a caller passing `px-7` did not replace the variant's `px-5` — both
 * landed on the element and Tailwind's stylesheet order picked the winner. That resolves the way
 * you want today only because `px-7` happens to be emitted after `px-5`. Naming the three sizes
 * that actually exist means padding is set once, by whoever knows which one they want.
 */
const SIZES = {
  sm: "px-4 py-2 text-sm",
  md: "px-5 py-2.5 text-base",
  /* Wide rather than tall: the label is the shape, so the horizontal padding carries the weight
     and the type stays at reading size instead of growing with the button. */
  lg: "px-8 py-4 text-base",
} as const;

export type ButtonSize = keyof typeof SIZES;

/*
 * The primary action, matching the app's primary button — same accent fill, same hover step.
 *
 * The download buttons are the one place the page and the product are the same object, so they
 * wear the product's colour rather than the page's neutral.
 */
const SOLID = "bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary";

/*
 * The secondary weight, for actions sitting on top of the video.
 *
 * Nothing opaque works there — a card fill punches a hole in the footage — and nothing fully
 * transparent works either, because the label would compete with whatever frame happens to be
 * underneath. A hairline over blur is the least that stays legible over moving colour.
 */
const OUTLINE =
  "border border-white/15 bg-white/[0.06] text-white backdrop-blur-xl " +
  "hover:border-white/25 hover:bg-white/[0.12] focus-visible:ring-white";

/* Same weight, on an opaque surface — the blurred variant needs something behind it to blur. */
const MUTED =
  "border border-border text-foreground hover:border-white/20 hover:bg-white/[0.05] " +
  "focus-visible:ring-ring";

/*
 * Borders, not rings, on the two bordered weights.
 *
 * `ring-1 ring-border` plus `focus-visible:ring-2 focus-visible:ring-ring` is two rules fighting
 * over one property, settled by whichever variant Tailwind emitted last. Using `border` for the
 * resting outline leaves the ring to mean exactly one thing: focus.
 */
const VARIANTS = { solid: SOLID, outline: OUTLINE, muted: MUTED } as const;
export type ButtonVariant = keyof typeof VARIANTS;

export function LinkButton({
  variant = "solid",
  size = "md",
  className,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return <a className={cn(BASE, SIZES[size], VARIANTS[variant], className)} {...props} />;
}

/** Small monospace label. Used for versions, sizes, counts — anything machine-ish. */
export function Mono({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cn("font-mono text-[13px] tracking-tight text-muted-foreground", className)}>
      {children}
    </span>
  );
}

/**
 * Section shell.
 *
 * Everything is on one measure and left-aligned. Centred columns read as a template; a single
 * consistent left edge running the length of the page is what makes it read as designed.
 */
export function Section({
  id,
  index,
  title,
  lede,
  children,
}: {
  id?: string;
  /** Two-digit marker in the margin — the page reads as a numbered document. */
  index?: string;
  title?: string;
  lede?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section id={id} className="reveal">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-28">
        <div className="flex flex-col gap-4 sm:flex-row sm:gap-10">
          <Mono className="shrink-0 pt-1.5 sm:w-16">{index}</Mono>
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <h2 className="max-w-2xl text-pretty text-3xl font-semibold tracking-[-0.025em] text-foreground sm:text-4xl">
              {title}
            </h2>
            {lede ? (
              <p className="max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
                {lede}
              </p>
            ) : null}
            {children ? <div className="mt-6">{children}</div> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
