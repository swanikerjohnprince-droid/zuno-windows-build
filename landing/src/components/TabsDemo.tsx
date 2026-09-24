import { useState } from "react";
import { Mono, cn } from "./ui";

interface DemoTab {
  id: string;
  label: string;
  heading: string;
  rows: string[];
}

const TABS: readonly DemoTab[] = [
  {
    id: "a",
    label: "Am I Dreaming",
    heading: "Metro Boomin · Heroes & Villains",
    rows: ["Am I Dreaming", "Creepin'", "Superhero", "Around Me", "Trance"],
  },
  {
    id: "b",
    label: "New tab",
    heading: "A$AP Rocky · Popular",
    rows: ["Praise The Lord", "F**kin' Problems", "Fashion Killa", "L$D", "Sundress"],
  },
  {
    id: "c",
    label: "Browse",
    heading: "Made for you",
    rows: ["Late night drive", "Focus, no lyrics", "2019 chill mix", "Discover weekly"],
  },
];

/** Three animated bars. The app uses the same treatment to mark the row that is playing. */
function PlayingBars({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-end gap-[2px]", className)} aria-hidden="true">
      {[0, 1, 2].map((bar) => (
        <span
          key={bar}
          className="equaliser-bar w-[2px] rounded-full bg-primary"
          style={{ animationDelay: `${bar * 0.18}s` }}
        />
      ))}
    </span>
  );
}

/**
 * A working miniature of the tab model.
 *
 * The feature is genuinely hard to describe and trivial to show: switch tabs and the playing
 * indicator stays pinned to the first one while the content underneath changes completely.
 * A paragraph claiming "each tab keeps its own playback" asks to be believed; this just does it,
 * and the player bar at the bottom never changes song no matter which tab you are looking at.
 *
 * Deliberately not a video or a GIF — it is a handful of divs, so it is sharp at any size, it
 * costs nothing to load, and it cannot drift out of date the way a recording does.
 */
export function TabsDemo() {
  const [activeId, setActiveId] = useState(TABS[0].id);
  /** The tab that owns playback. Fixed to the first, which is the entire point. */
  const playingId = TABS[0].id;
  const active = TABS.find((tab) => tab.id === activeId) ?? TABS[0];

  return (
    <div className="overflow-hidden rounded-2xl bg-card/40 ring-1 ring-border">
      {/* Window chrome, so it reads as an app rather than a web widget. */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="flex gap-1.5" aria-hidden="true">
          {["bg-[#ff5f57]", "bg-[#febc2e]", "bg-[#28c840]"].map((colour) => (
            <span key={colour} className={cn("size-2.5 rounded-full", colour)} />
          ))}
        </span>

        <div className="ml-3 flex min-w-0 items-center gap-1" role="tablist" aria-label="Demo tabs">
          {TABS.map((tab) => {
            const isActive = tab.id === activeId;
            const isPlaying = tab.id === playingId;

            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveId(tab.id)}
                className={cn(
                  "flex min-w-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  isActive
                    ? "bg-background text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {/* Present whether or not the tab is focused — that is the whole demonstration. */}
                {isPlaying ? <PlayingBars className="h-2.5" /> : null}
                <span className="truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content changes with the tab. */}
      <div className="min-h-[248px] px-6 py-6">
        <Mono className="mb-4 block">{active.heading}</Mono>
        <ol className="flex flex-col">
          {active.rows.map((row, index) => {
            const isNowPlaying = active.id === playingId && index === 0;
            return (
              <li
                key={row}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-2 py-2.5 text-base transition-colors",
                  isNowPlaying ? "text-primary" : "text-muted-foreground",
                )}
              >
                <span className="w-4 shrink-0 text-center">
                  {isNowPlaying ? <PlayingBars className="h-3" /> : <Mono>{index + 1}</Mono>}
                </span>
                <span className="truncate">{row}</span>
              </li>
            );
          })}
        </ol>
      </div>

      {/* The player bar. Bound to the playing tab, never to the visible one. */}
      <div className="flex items-center gap-3 border-t border-border bg-background/60 px-6 py-4">
        <span className="size-9 shrink-0 rounded-md bg-muted" aria-hidden="true" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base font-medium text-foreground">Am I Dreaming</span>
          <span className="truncate text-sm text-muted-foreground">
            Metro Boomin, A$AP Rocky, Roisee
          </span>
        </span>
        <PlayingBars className="h-3.5" />
        <Mono className="hidden sm:block">
          still playing from “{TABS[0].label}”
        </Mono>
      </div>
    </div>
  );
}
