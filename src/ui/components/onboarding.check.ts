/**
 * Self-check for the onboarding tour's order and geometry. No test runner in this project, so:
 *
 *   npx esbuild src/ui/components/onboarding.check.ts --bundle --platform=node --format=esm
 *     --outfile=check.mjs && node check.mjs
 *
 * Both of these fail silently rather than loudly. Step navigation running off either end would
 * leave someone stuck with no way forward, and a card positioned outside the viewport still
 * renders perfectly — just where nobody can see it.
 */
export {};

import {
  CARD_WIDTH,
  ONBOARDING_STEPS,
  VIEWPORT_MARGIN,
  getCardPosition,
  nextOnboardingStep,
  previousOnboardingStep,
} from "./onboardingSteps";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  check(actual === expected, `${message}: expected ${String(expected)}, got ${String(actual)}`);
}

const viewport = { width: 1280, height: 800 };

// --- step navigation --------------------------------------------------------------------

equal(nextOnboardingStep("open-search"), "type-first", "next from first");
equal(previousOnboardingStep("type-first"), "open-search", "previous from second");

// The ends are where a tour traps people: nothing before the first, nothing after the last.
equal(previousOnboardingStep(ONBOARDING_STEPS[0]), null, "no step before the first");
equal(
  nextOnboardingStep(ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1]),
  null,
  "no step after the last",
);

// Skipping repeatedly must terminate rather than cycle — this is the "skip every step" path.
let step = ONBOARDING_STEPS[0];
let hops = 0;
for (;;) {
  const next = nextOnboardingStep(step);
  if (!next) break;
  step = next;
  hops += 1;
  check(hops <= ONBOARDING_STEPS.length, "skipping never reached the end");
}
equal(hops, ONBOARDING_STEPS.length - 1, "skipping visits every step exactly once");

// --- card placement ---------------------------------------------------------------------

const below = getCardPosition({ left: 600, top: 100, right: 700, bottom: 140 }, 160, viewport);
equal(below.placement, "below", "room underneath puts the card below");
check(below.top > 140, "card below must clear the target");

// A target near the bottom has to flip above rather than run off-screen.
const above = getCardPosition({ left: 600, top: 700, right: 700, bottom: 760 }, 160, viewport);
equal(above.placement, "above", "no room underneath flips the card above");
check(above.top >= VIEWPORT_MARGIN, "flipped card stays inside the top margin");
check(above.top + 160 <= 700, "flipped card must clear the target");

// A target hard against either edge must not drag the card out of the viewport.
for (const rect of [
  { left: 0, top: 100, right: 40, bottom: 140 },
  { left: 1240, top: 100, right: 1280, bottom: 140 },
]) {
  const placed = getCardPosition(rect, 160, viewport);
  check(placed.left >= VIEWPORT_MARGIN, `card ran off the left edge: ${placed.left}`);
  check(
    placed.left + CARD_WIDTH <= viewport.width - VIEWPORT_MARGIN + 1,
    `card ran off the right edge: ${placed.left}`,
  );
}

// No target — a step whose element is not on screen — still shows a readable, centred card
// rather than nothing at all.
const centred = getCardPosition(null, 160, viewport);
equal(centred.placement, "center", "missing target centres the card");
check(centred.left >= VIEWPORT_MARGIN && centred.top >= VIEWPORT_MARGIN, "centred card is inside");

// A viewport narrower than the card keeps the left margin instead of going negative.
const cramped = getCardPosition({ left: 10, top: 10, right: 60, bottom: 40 }, 160, {
  width: 200,
  height: 400,
});
check(cramped.left >= VIEWPORT_MARGIN, `cramped viewport pushed the card off-screen: ${cramped.left}`);

console.log("onboarding: ok");
