import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CloseIcon,
  KeyIcon,
} from "@/ui/icons";
import { primaryModifierLabel } from "../platform";
import { useReduceMotion } from "../settings/renderEffects";
import {
  CARD_WIDTH,
  ONBOARDING_STEPS,
  SPOTLIGHT_PADDING,
  getCardPosition,
  type OnboardingStep,
  type Rect,
} from "./onboardingSteps";

export {
  ONBOARDING_STEPS,
  nextOnboardingStep,
  previousOnboardingStep,
  type OnboardingStep,
} from "./onboardingSteps";

type StepContent = { title: string; text: string; target: string; shortcut?: string };

function getStepContent(): Record<OnboardingStep, StepContent> {
  return {
    "open-search": {
      title: "Find something to play",
      text: `Press ${primaryModifierLabel} Space, or click the search bar.`,
      target: '[data-onboarding="search"]',
      shortcut: `${primaryModifierLabel} Space`,
    },
    "type-first": {
      title: "Search for a song",
      text: "Type one of your favourites, then pick it from the results.",
      target: '[data-onboarding="search-panel"]',
      shortcut: `${primaryModifierLabel} Space`,
    },
    "play-first": {
      title: "Play it",
      text: "Choose a result to start playing.",
      target: '[data-onboarding="search-panel"], [data-onboarding="search-results"]',
    },
    "new-tab": {
      title: "Open a second tab",
      text: "Tabs each keep their own music, so this song carries on playing here.",
      target: '[data-onboarding="new-tab"]',
      shortcut: `${primaryModifierLabel} T`,
    },
    "type-second": {
      title: "Search again",
      text: "Find a different song in this new tab.",
      target: '[data-onboarding="search-panel"]',
      shortcut: `${primaryModifierLabel} Space`,
    },
    "play-second": {
      title: "Play the second song",
      text: "This tab now has music of its own.",
      target: '[data-onboarding="search-panel"], [data-onboarding="search-results"]',
    },
    "switch-back": {
      title: "Switch back",
      text: "Your first song is exactly where you left it.",
      target: '[data-onboarding="first-tab"]',
      shortcut: `${primaryModifierLabel} 1, 2, 3…`,
    },
  };
}

/**
 * Tracks the highlighted element's position.
 *
 * Watched rather than polled: the previous version re-queried on a 120ms interval, which both
 * burned work while idle and let the spotlight visibly lag anything that moved. A null result is
 * a normal outcome, not a failure — the step's target may not be on screen yet, and the caller
 * degrades to a centred card rather than showing nothing at all.
 */
function useTargetRect(selector: string): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);

  useLayoutEffect(() => {
    let frame = 0;
    let observed: HTMLElement | null = null;
    const resizeObserver = new ResizeObserver(() => measure());

    function measure() {
      const target = document.querySelector<HTMLElement>(selector);

      if (target !== observed) {
        if (observed) resizeObserver.unobserve(observed);
        if (target) resizeObserver.observe(target);
        observed = target;
      }

      if (!target) {
        setRect(null);
      } else {
        const box = target.getBoundingClientRect();
        // Zero-sized elements are mid-mount or hidden; treating them as absent avoids a
        // spotlight collapsing onto a point in the corner.
        setRect(
          box.width > 0 && box.height > 0
            ? {
                left: Math.max(0, box.left - SPOTLIGHT_PADDING),
                top: Math.max(0, box.top - SPOTLIGHT_PADDING),
                right: Math.min(window.innerWidth, box.right + SPOTLIGHT_PADDING),
                bottom: Math.min(window.innerHeight, box.bottom + SPOTLIGHT_PADDING),
              }
            : null,
        );
      }

      // The target can move without resizing — a tab opening, a panel sliding — and nothing
      // fires an event for that, so one rAF pass per frame keeps the ring attached.
      frame = requestAnimationFrame(measure);
    }

    measure();
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [selector]);

  return rect;
}

/** Reveals text a character at a time, unless motion is unwelcome or the reader is impatient. */
function useTypedText(text: string, enabled: boolean) {
  const [typed, setTyped] = useState(enabled ? "" : text);
  const reveal = useCallback(() => setTyped(text), [text]);

  useEffect(() => {
    if (!enabled) {
      setTyped(text);
      return;
    }
    setTyped("");
    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setTyped(text.slice(0, index));
      if (index >= text.length) window.clearInterval(timer);
    }, 18);
    return () => window.clearInterval(timer);
  }, [text, enabled]);

  return { typed, reveal, done: typed === text };
}

/*
 * Same substitution as AppLoadingScreen's: a blurred solid disc is a radial gradient, and the
 * gradient costs a raster pass where the filter cost a compositor layer plus an intermediate
 * texture expanded by ~3x the 120px radius on each side. Two of these were on screen at once.
 */
const GLOW_GRADIENT =
  "radial-gradient(circle, color-mix(in oklab, var(--color-primary) 15%, transparent) 0%, transparent 70%)";

interface OnboardingProps {
  step: OnboardingStep;
  /** Ends the tour entirely. */
  onSkip: () => void;
  /** Moves past this one step without doing it. */
  onSkipStep: () => void;
  onBack: () => void;
}

export function Onboarding({ step, onSkip, onSkipStep, onBack }: OnboardingProps) {
  // The typewriter is a JS timer, so no stylesheet can stop it — this is the hook that can.
  const reduceMotion = useReduceMotion();
  const content = getStepContent()[step];
  const rect = useTargetRect(content.target);
  const { typed, reveal, done } = useTypedText(content.text, !reduceMotion);

  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(160);
  useLayoutEffect(() => {
    if (cardRef.current) setCardHeight(cardRef.current.offsetHeight);
  }, [content.text, typed]);

  const index = ONBOARDING_STEPS.indexOf(step);
  const isFirst = index === 0;
  const isLast = index === ONBOARDING_STEPS.length - 1;
  const { left: cardLeft, top: cardTop } = getCardPosition(rect, cardHeight, {
    width: window.innerWidth,
    height: window.innerHeight,
  });

  /*
   * Escape leaves the tour and the arrows walk it. A tour that traps someone is worse than no
   * tour, and Escape is the first thing anyone reaches for.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onSkip();
        return;
      }
      // Only with a modifier: the arrows belong to the app while the tour is a passenger.
      if (!event.altKey) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        onSkipStep();
      }
      if (event.key === "ArrowLeft" && !isFirst) {
        event.preventDefault();
        onBack();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onSkip, onSkipStep, onBack, isFirst]);

  return (
    /*
     * pointer-events-none throughout, re-enabled only on the card. Every decorative layer here
     * sits over the very control the step is asking to be clicked, so without this the tour
     * blocks the action it requests.
     */
    <div className="pointer-events-none fixed inset-0 z-[90]">
      {rect && (
        <>
          <div
            className="absolute inset-x-0 top-0 bg-background/75 backdrop-blur-[2px]"
            style={{ height: rect.top }}
          />
          <div
            className="absolute left-0 bg-background/75 backdrop-blur-[2px]"
            style={{ top: rect.top, width: rect.left, height: rect.bottom - rect.top }}
          />
          <div
            className="absolute right-0 bg-background/75 backdrop-blur-[2px]"
            style={{ top: rect.top, left: rect.right, height: rect.bottom - rect.top }}
          />
          <div
            className="absolute inset-x-0 bottom-0 bg-background/75 backdrop-blur-[2px]"
            style={{ top: rect.bottom }}
          />
          <div
            className="absolute rounded-xl ring-2 ring-primary"
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.right - rect.left,
              height: rect.bottom - rect.top,
              /* Not gated in JS any more: the `shadows` switch is a stylesheet rule with
                 `!important`, which outranks this inline style on its own. */
              boxShadow: "0 0 40px var(--color-primary)",
            }}
          />
        </>
      )}

      <div
        ref={cardRef}
        className="pointer-events-auto absolute flex flex-col gap-3 rounded-xl bg-popover p-4 text-sm text-foreground shadow-2xl"
        style={{ left: cardLeft, top: cardTop, width: CARD_WIDTH }}
        role="dialog"
        aria-modal="false"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-text"
        // Tapping the card finishes the typewriter rather than making anyone wait it out.
        onClick={done ? undefined : reveal}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Step {index + 1} of {ONBOARDING_STEPS.length}
            </span>
            <h2 id="onboarding-title" className="text-sm font-semibold">
              {content.title}
            </h2>
          </div>
          <button
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            type="button"
            onClick={onSkip}
            aria-label="Skip the whole tour"
            title="Skip tour (Esc)"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        <p id="onboarding-text" className="min-h-[2.5rem] text-muted-foreground">
          {typed}
        </p>

        {content.shortcut && (
          <kbd className="w-fit rounded bg-card px-1.5 py-0.5 font-sans text-xs text-muted-foreground">
            {content.shortcut}
          </kbd>
        )}

        {/* Progress as dots: cheaper to read at a glance than the counter, and shows the end. */}
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {ONBOARDING_STEPS.map((id, dotIndex) => (
            <span
              key={id}
              className={`h-1 flex-1 rounded-full transition-colors ${
                dotIndex <= index ? "bg-primary" : "bg-card"
              }`}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
            type="button"
            onClick={onBack}
            disabled={isFirst}
            title="Previous step (Alt ←)"
          >
            <ArrowLeftIcon size={14} />
            Back
          </button>

          <div className="flex items-center gap-1">
            <button
              className="text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              type="button"
              onClick={onSkip}
            >
              Skip tour
            </button>
            <button
              className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              type="button"
              onClick={onSkipStep}
              title={isLast ? "Finish" : "Skip this step (Alt →)"}
            >
              {isLast ? (
                <>
                  Finish
                  <CheckIcon size={14} />
                </>
              ) : (
                <>
                  Skip step
                  <ArrowRightIcon size={14} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function OnboardingCompleteToast() {
  return (
    <div
      className="fixed bottom-28 left-1/2 z-[95] flex -translate-x-1/2 items-center gap-2 rounded-full bg-popover/95 px-4 py-2 shadow-2xl backdrop-blur"
      role="status"
    >
      <span className="text-primary" aria-hidden="true">
        <CheckIcon size={18} />
      </span>
      <span className="text-sm text-foreground">You're all set</span>
    </div>
  );
}

export function OnboardingWelcome() {
  return (
    <div
      className="fixed inset-0 z-[95] grid place-items-center bg-background"
      role="status"
      aria-label="Welcome"
    >
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 size-[660px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: GLOW_GRADIENT }}
      />
      <div className="relative flex flex-col items-center gap-3 text-center">
        <strong>Welcome</strong>
      </div>
    </div>
  );
}

interface KeychainNoticeProps {
  onContinue: () => void;
}

export function KeychainNotice({ onContinue }: KeychainNoticeProps) {
  return (
    <div
      className="fixed inset-0 z-[95] grid place-items-center bg-background/80 backdrop-blur"
      role="dialog"
      aria-modal="true"
      aria-labelledby="keychain-title"
    >
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 size-[660px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: GLOW_GRADIENT }}
      />
      <div className="relative flex w-[min(28rem,90vw)] flex-col items-center gap-3 rounded-2xl bg-popover p-6 text-center shadow-2xl">
        <span
          className="grid size-12 place-items-center rounded-full bg-primary/15 text-primary"
          aria-hidden="true"
        >
          <KeyIcon size={28} />
        </span>
        <h1 id="keychain-title">A note about macOS Keychain</h1>
        <p>
          This client uses Keychain to protect the encryption key for your YouTube Music session
          cookie. macOS may ask for permission when you continue.
        </p>
        <p>
          The app only accesses the Keychain item it created for this purpose. It does not request
          access to your passwords or any other Keychain items. You can deny this, but signing in
          with YouTube Music will not work then.
        </p>
        <p>
          <strong>Choose “Always Allow” if you would rather not see the prompt again.</strong>
        </p>
        <button type="button" onClick={onContinue}>
          Continue
        </button>
      </div>
    </div>
  );
}
