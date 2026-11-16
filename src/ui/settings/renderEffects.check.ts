/**
 * Self-check for the per-effect render toggles. Run with the whole suite:
 *
 *   npm run check
 *
 * The CSS matches with `~=`, which is a whitespace-separated word match — so the whole
 * mechanism rests on the stored list round-tripping into one well-formed attribute value.
 * An id that never reaches `data-fx-off`, or a stale one that never leaves it, is a switch
 * that silently does nothing, which is the worst possible failure for a debug instrument.
 */
export {};

const store = new Map<string, string>();
const documentElement = {
  attributes: new Map<string, string>(),
  setAttribute(name: string, value: string) {
    documentElement.attributes.set(name, value);
  },
};

Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  },
  window: { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} },
  document: { documentElement },
});

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

const {
  RENDER_EFFECTS,
  hydrateRenderEffects,
  readDisabledEffects,
  setAllEffectsDisabled,
  setEffectDisabled,
} = (await import("./renderEffects")) as typeof import("./renderEffects");

function attribute(): string {
  return documentElement.attributes.get("data-fx-off") ?? "<unset>";
}

check(readDisabledEffects().length === 0, "a fresh install has every effect on");

setEffectDisabled("backdrop", true);
check(attribute() === "backdrop", `one effect off writes one word, got "${attribute()}"`);

setEffectDisabled("shadows", true);
check(attribute() === "backdrop shadows", `two effects are space separated, got "${attribute()}"`);

// Idempotent: the settings switch can fire twice for one intent, and a duplicated id would
// survive a single `filter` pass below and leave the effect stuck off.
setEffectDisabled("backdrop", true);
check(attribute() === "backdrop shadows", `re-disabling does not duplicate, got "${attribute()}"`);

setEffectDisabled("backdrop", false);
check(attribute() === "shadows", `re-enabling removes only its own id, got "${attribute()}"`);

setAllEffectsDisabled(true);
check(
  readDisabledEffects().length === RENDER_EFFECTS.length,
  "the master switch disables every known effect",
);
for (const effect of RENDER_EFFECTS) {
  check(attribute().split(" ").includes(effect.id), `${effect.id} reaches the attribute`);
}

setAllEffectsDisabled(false);
check(attribute() === "", `the master switch clears the attribute, got "${attribute()}"`);

// A build that renames or drops an id leaves the matching CSS rule orphaned; ids are also
// localStorage keys' contents, so they are load-bearing beyond this file.
const ids = RENDER_EFFECTS.map((effect) => effect.id);
check(new Set(ids).size === ids.length, "effect ids are unique");
check(
  ids.every((id) => /^[a-z-]+$/.test(id)),
  "effect ids stay attribute-safe (lowercase and dashes, no whitespace)",
);

/*
 * The Potato PC migration. It runs at most once per install, on a launch where the user
 * changes nothing and sees nothing — so if it regresses, the only symptom is that somebody's
 * weak machine quietly starts running every effect again after an update.
 */
store.clear();
store.set("paper-pc-mode", "true");
await hydrateRenderEffects();
check(
  readDisabledEffects().length === RENDER_EFFECTS.length,
  "an install already on Potato PC, with no stored list, gets every effect disabled",
);

// Already has a list: the user has been through the switches, so their choices stand even
// though Potato PC is on and their list is not the full set.
store.clear();
store.set("paper-pc-mode", "true");
store.set("render-effects-off", JSON.stringify(["backdrop"]));
await hydrateRenderEffects();
check(
  readDisabledEffects().join(" ") === "backdrop",
  `a stored list survives the migration, got "${readDisabledEffects().join(" ")}"`,
);

store.clear();
await hydrateRenderEffects();
check(readDisabledEffects().length === 0, "an install not on Potato PC is left alone");

console.log("renderEffects: ok");
