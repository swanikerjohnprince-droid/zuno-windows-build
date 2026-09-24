import { useEffect, useState } from "react";

/**
 * The OS "reduce motion" preference, live.
 *
 * CSS can shorten an animation to nothing, which is what styles.css already does, but it
 * cannot stop a `<video autoplay loop>` — that keeps playing regardless, and a looping video
 * is exactly the kind of continuous motion the preference exists to suppress. This is the only
 * way to honour it for the demo footage.
 *
 * Subscribed rather than read once: the preference can be toggled while the page is open, and
 * a value captured at mount would keep playing for someone who just asked it to stop.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
