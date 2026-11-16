import { useState, type ReactNode } from "react";
import { TabsDemo } from "./TabsDemo";
import { Mono, cn } from "./ui";

/** Download rows mid-flight: one done, one in progress, one queued. */
function OfflineVisual() {
  const rows = [
    { name: "Am I Dreaming", state: "done" as const, pct: 100 },
    { name: "Creepin'", state: "active" as const, pct: 62 },
    { name: "Superhero", state: "queued" as const, pct: 0 },
    { name: "Around Me", state: "queued" as const, pct: 0 },
  ];

  return (
    <div className="flex flex-col gap-4">
      {rows.map((row) => (
        <div key={row.name} className="flex items-center gap-3">
          <span
            className={cn(
              "grid size-6 shrink-0 place-items-center rounded-full text-[11px]",
              row.state === "done" && "bg-primary/15 text-primary",
              row.state === "active" && "bg-primary/10 text-primary",
              row.state === "queued" && "bg-muted text-muted-foreground",
            )}
            aria-hidden="true"
          >
            {row.state === "done" ? "✓" : row.state === "active" ? "↓" : "·"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="mb-1.5 block truncate text-base text-muted-foreground">{row.name}</span>
            <span className="block h-1 w-full overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-primary transition-[width] duration-700"
                style={{ width: `${row.pct}%` }}
              />
            </span>
          </span>
        </div>
      ))}
      <Mono>1 of 4 · 128 kbps AAC · 8 GB cap</Mono>
    </div>
  );
}

/** Three lyric lines with the current one lit. */
function LyricsVisual() {
  const lines = [
    "I've been so lost since you've been gone",
    "Am I dreaming?",
    "Or is this real now",
    "Tell me what you want",
  ];
  return (
    <div className="flex flex-col gap-3">
      {lines.map((line, index) => (
        <span
          key={line}
          className={cn(
            "text-xl transition-colors",
            index === 1
              ? "font-medium text-foreground"
              : index === 0
                ? "text-muted-foreground/40"
                : "text-muted-foreground/60",
          )}
        >
          {line}
        </span>
      ))}
      <Mono className="mt-1">synced · not available on the web client</Mono>
    </div>
  );
}

/** The mini player pill, at rest and expanded. */
function MiniPlayerVisual() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3 self-start rounded-full bg-background/80 py-2 pl-2 pr-5 ring-1 ring-border">
        <span className="size-9 shrink-0 rounded-full bg-muted" aria-hidden="true" />
        <span className="flex flex-col">
          <span className="text-base font-medium text-foreground">Am I Dreaming</span>
          <span className="text-sm text-muted-foreground">Metro Boomin</span>
        </span>
      </div>
      <div className="flex items-center gap-2 self-start rounded-full bg-background/60 p-2 ring-1 ring-border">
        <span className="size-7 rounded-full bg-muted" aria-hidden="true" />
      </div>
      <Mono>appears when you tab away · drag it anywhere</Mono>
    </div>
  );
}

/** Local paths sitting in the same library. */
function LocalVisual() {
  return (
    <div className="flex flex-col gap-4">
      {["~/Music/FLAC", "D:\\Rips\\2024", "~/Downloads/live-sets"].map((path) => (
        <div key={path} className="flex items-center gap-3">
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-muted text-[11px] text-muted-foreground" aria-hidden="true">
            ♪
          </span>
          <span className="truncate font-mono text-sm text-muted-foreground">{path}</span>
        </div>
      ))}
      <Mono>same rows, same queue, same player · tag editor included</Mono>
    </div>
  );
}

/** The two integration toggles, as they appear in the toolbar. */
function IntegrationsVisual() {
  return (
    <div className="flex flex-col gap-5">
      {[
        { label: "Discord Rich Presence", on: true, detail: "shows the artist, not the app" },
        { label: "Last.fm scrobbling", on: false, detail: "one click to stop broadcasting" },
      ].map((item) => (
        <div key={item.label} className="flex items-start justify-between gap-4">
          <span className="flex flex-col gap-0.5">
            <span className="text-base text-foreground">{item.label}</span>
            <Mono>{item.detail}</Mono>
          </span>
          <span
            className={cn(
              "mt-1 flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors",
              item.on ? "bg-primary" : "bg-muted",
            )}
            aria-hidden="true"
          >
            <span
              className={cn(
                "size-5 rounded-full bg-background transition-transform",
                item.on && "translate-x-5",
              )}
            />
          </span>
        </div>
      ))}
    </div>
  );
}

interface Feature {
  id: string;
  title: string;
  body: string;
  visual: ReactNode;
}

const FEATURES: readonly Feature[] = [
  {
    id: "tabs",
    title: "Tabs that each keep playing",
    body:
      "Open a second tab and the first carries on. Each holds its own queue, volume and position, and the player bar follows whichever is playing — not whichever you are looking at.",
    visual: <TabsDemo />,
  },
  {
    id: "offline",
    title: "Offline downloads",
    body:
      "A song, a selection, or a whole album or playlist. Its own quality setting, its own size cap, and a queue you can watch.",
    visual: <OfflineVisual />,
  },
  {
    id: "lyrics",
    title: "Synced lyrics",
    body: "Line by line and in time with the track, which the official web client does not offer.",
    visual: <LyricsVisual />,
  },
  {
    id: "mini",
    title: "A mini player",
    body:
      "Click away from the window and a small pill appears. Hover to expand it, drag it anywhere, click through to come back.",
    visual: <MiniPlayerVisual />,
  },
  {
    id: "local",
    title: "Your local files, in the same list",
    body:
      "Point Zuno at folders on your machine and they sit alongside your library — nothing uploaded, and a tag editor for fixing metadata.",
    visual: <LocalVisual />,
  },
  {
    id: "integrations",
    title: "Last.fm and Discord",
    body:
      "Scrobbling and Rich Presence, each one click away in the toolbar for when you would rather not broadcast what you are playing.",
    visual: <IntegrationsVisual />,
  },
];

/**
 * Features as an explorer, not an inventory.
 *
 * A grid of six cards gives every feature identical weight and asks the reader to evaluate all
 * of them at once. This shows one at a time, at full size, with the list acting as a table of
 * contents — the reader picks what they care about and gets a real look at it rather than a
 * thumbnail of everything.
 *
 * It is a proper tablist: arrow keys move between features, and the panel is labelled by the tab
 * that opened it. On narrow screens the same data renders as a stack, because a two-column
 * explorer on a phone is a column of buttons above a column of panels.
 */
export function Features() {
  const [activeId, setActiveId] = useState(FEATURES[0].id);
  const active = FEATURES.find((feature) => feature.id === activeId) ?? FEATURES[0];

  const move = (delta: number) => {
    const index = FEATURES.findIndex((feature) => feature.id === activeId);
    const next = FEATURES[(index + delta + FEATURES.length) % FEATURES.length];
    setActiveId(next.id);
    document.getElementById(`feature-tab-${next.id}`)?.focus();
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-12">
      <div
        className="flex flex-col max-lg:hidden"
        role="tablist"
        aria-orientation="vertical"
        aria-label="Features"
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            move(1);
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            move(-1);
          }
        }}
      >
        {FEATURES.map((feature, index) => {
          const isActive = feature.id === activeId;
          return (
            <button
              key={feature.id}
              id={`feature-tab-${feature.id}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`feature-panel-${feature.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveId(feature.id)}
              className={cn(
                "group relative flex items-start gap-4 rounded-xl px-4 py-4 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                isActive ? "bg-card/60" : "hover:bg-card/30",
              )}
            >
              <span
                className={cn(
                  "absolute inset-y-3 left-0 w-0.5 rounded-full transition-colors",
                  isActive ? "bg-primary" : "bg-transparent",
                )}
                aria-hidden="true"
              />
              <Mono className={cn("pt-0.5 transition-colors", isActive && "text-primary")}>
                {String(index + 1).padStart(2, "0")}
              </Mono>
              <span className="flex min-w-0 flex-col gap-1">
                <span
                  className={cn(
                    "text-base font-medium transition-colors",
                    isActive ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {feature.title}
                </span>
                {isActive ? (
                  <span className="text-pretty text-base leading-relaxed text-muted-foreground">
                    {feature.body}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      <div
        id={`feature-panel-${active.id}`}
        role="tabpanel"
        aria-labelledby={`feature-tab-${active.id}`}
        className="flex min-h-[26rem] flex-col justify-center rounded-2xl bg-card/30 p-6 ring-1 ring-border max-lg:hidden sm:p-8"
      >
        {active.visual}
      </div>

      {/* Narrow screens get the same content as a stack; an explorer needs two columns. */}
      <div className="flex flex-col gap-10 lg:hidden">
        {FEATURES.map((feature, index) => (
          <div key={feature.id} className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <Mono className="pt-1">{String(index + 1).padStart(2, "0")}</Mono>
              <div className="flex flex-col gap-1.5">
                <h3 className="text-lg font-medium text-foreground">{feature.title}</h3>
                <p className="text-pretty text-base leading-relaxed text-muted-foreground">
                  {feature.body}
                </p>
              </div>
            </div>
            <div className="rounded-2xl bg-card/30 p-5 ring-1 ring-border">{feature.visual}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
