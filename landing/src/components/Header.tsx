import { useEffect, useState } from "react";
import { LinkButton, cn } from "./ui";

/**
 * One header for the whole page.
 *
 * Its own file rather than living in App: Hero renders it, and App renders Hero, so importing
 * it from App made the two modules import each other. That resolves today only because of
 * hoisting, and stops resolving the moment either file grows a top-level constant the other
 * needs.
 *
 * A floating pill rather than a full-width bar. The hero is a single continuous surface, and a
 * bar spanning it cuts the composition in two before the eye reaches the product.
 */
export function Header() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="sticky top-0 z-50 px-4 pt-4">
      <div
        className={cn(
          "mx-auto flex h-14 max-w-3xl items-center gap-3 rounded-full px-4",

          // Transparent over the hero, solid once there is content behind it — a bar with its
          // own fill on top of the hero reads as a second surface stacked on the first.
          scrolled
            ? "border border-white/10 bg-background/70 shadow-lg shadow-black/20 backdrop-blur-xl"
            : "border border-transparent bg-transparent",
        )}
      >
        <a
          className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground"
          href="#top"
        >
          <img className="size-8" src="./logo.png" alt="" />
          zuno_
        </a>

        <div className="ml-auto flex items-center gap-1">
          <a
            className="rounded-full px-3 py-2 font-mono text-[13px] text-foreground/60 transition-colors hover:text-foreground"
            href="https://github.com/nofayz/zuno"
            rel="noopener"
          >
            source
          </a>
          <LinkButton href="#download" size="sm">
            Download
          </LinkButton>
        </div>
      </div>
    </header>
  );
}
