/**
 * The onboarding tour's order and geometry.
 *
 * Split from the component because none of it is React: it is a list and some arithmetic, and
 * keeping it here means both can be checked without a DOM. See onboarding.check.ts.
 */

export type OnboardingStep =
  | "open-search"
  | "type-first"
  | "play-first"
  | "new-tab"
  | "type-second"
  | "play-second"
  | "switch-back";

/**
 * The tour in order. Single source for both progress ("3 of 7") and step skipping, since
 * deriving that from a scattered set of transitions is how the two drift apart.
 */
export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  "open-search",
  "type-first",
  "play-first",
  "new-tab",
  "type-second",
  "play-second",
  "switch-back",
];

export function nextOnboardingStep(step: OnboardingStep): OnboardingStep | null {
  return ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) + 1] ?? null;
}

export function previousOnboardingStep(step: OnboardingStep): OnboardingStep | null {
  const index = ONBOARDING_STEPS.indexOf(step);
  return index > 0 ? ONBOARDING_STEPS[index - 1] : null;
}

export const SPOTLIGHT_PADDING = 8;
export const CARD_WIDTH = 320;
export const CARD_GAP = 14;
export const VIEWPORT_MARGIN = 12;

export type Rect = { left: number; top: number; right: number; bottom: number };
export type CardPlacement = "above" | "below" | "center";

/**
 * Places the card beside the spotlight, flipping and clamping so it never leaves the viewport.
 *
 * The viewport is a parameter rather than read off `window`, so the geometry can be checked
 * without a DOM — this is the part most likely to break silently, since a card pushed off-screen
 * still renders perfectly, just where nobody can see it.
 */
export function getCardPosition(
  rect: Rect | null,
  cardHeight: number,
  viewport: { width: number; height: number },
): { left: number; top: number; placement: CardPlacement } {
  if (!rect) {
    return {
      left: Math.max(VIEWPORT_MARGIN, (viewport.width - CARD_WIDTH) / 2),
      top: Math.max(VIEWPORT_MARGIN, (viewport.height - cardHeight) / 2),
      placement: "center",
    };
  }

  const below = viewport.height - rect.bottom >= cardHeight + CARD_GAP + VIEWPORT_MARGIN;
  const top = below
    ? rect.bottom + CARD_GAP
    : Math.max(VIEWPORT_MARGIN, rect.top - cardHeight - CARD_GAP);

  const centred = rect.left + (rect.right - rect.left) / 2 - CARD_WIDTH / 2;
  const left = Math.min(
    Math.max(VIEWPORT_MARGIN, centred),
    // A viewport narrower than the card would push this below the margin; the max keeps the card
    // on screen at the cost of overflowing its right edge, which is the lesser failure.
    Math.max(VIEWPORT_MARGIN, viewport.width - CARD_WIDTH - VIEWPORT_MARGIN),
  );

  return { left, top, placement: below ? "below" : "above" };
}
