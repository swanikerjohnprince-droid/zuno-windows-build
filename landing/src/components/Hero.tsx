import type { CSSProperties } from "react";
import { BrandIcon, OS_ICON, SERVICE_ICON } from "./brandIcons";
import { ArrowDownIcon, ArrowRightIcon } from "./icons";
import { LinkButton, Mono } from "./ui";
import { GITHUB_REPO, type LatestRelease, type PlatformId } from "../releases";

const PLATFORM_LABEL: Record<PlatformId, string> = {
  windows: "Windows",
  "macos-arm": "macOS",
  "macos-intel": "macOS",
  linux: "Linux",
};

const DEMO_VIDEO = "https://pub-493a5d4ea10b45dcaa83917aa3856a32.r2.dev/zunodem.mp4";
const DEMO_POSTER = "./zuno-d1-1.2.PNG";
/** Read off the file's own header. Reserves the box before a byte arrives, and sets the frame's
 *  aspect — the stage is cut to the footage rather than the footage cropped to the stage. */
const DEMO_W = 1234;
const DEMO_H = 922;

/** Six features, one clean row. The hero itself stays pure type, so they sit under the film. */
const FEATURES = [
  "tabs, one queue each",
  "line-synced lyrics",
  "offline downloads",
  "your local files",
  "discord presence",
  "last.fm scrobbling",
];

/**
 * Entrance cascade.
 *
 * Every line of the hero arrives on the same curve, a beat apart, top to bottom — which is what
 * makes a stack of centred text read as composed rather than as a page that finished loading.
 * The delay is the only thing that differs, so it is the only thing passed.
 *
 * Under reduced motion the global rule in styles.css collapses the duration, and because
 * `reveal-in` ends at the resting state that leaves everything simply visible.
 */
const step = (i: number): CSSProperties => ({ animationDelay: `${i * 0.09}s` });

/**
 * A floating service badge.
 *
 * Decorative, hence `aria-hidden`: both of these already appear in the feature index below, and
 * announcing them twice buys a screen reader nothing. Hidden outright below `lg`, where the
 * centred column takes the full width and there are no margins left to float in.
 *
 * Two elements rather than one, because the two motions have nothing to do with each other: the
 * outer box carries the position and the scroll-driven fade, the inner pill carries the bob. A
 * single element would need one `animation` list with mismatched timelines to do both.
 *
 * The negative delay starts the bob already in progress, so the pair does not rise and fall in
 * lockstep for the first cycle.
 */
function ServiceBadge({
  className,
  tilt,
  delay,
  duration,
  children,
}: {
  className: string;
  tilt: string;
  delay: string;
  duration: string;
  children: React.ReactNode;
}) {
  return (
    <span className={`scroll-fade absolute hidden lg:block ${className}`} aria-hidden="true">
      <span
        className="float flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.05] py-2 pl-3 pr-3.5 backdrop-blur-md"
        style={
          {
            "--tilt": tilt,
            animationDelay: delay,
            animationDuration: duration,
          } as CSSProperties
        }
      >
        {children}
      </span>
    </span>
  );
}

/**
 * The hero.
 *
 * Type first, product second — the two are not fighting over the same viewport. The fold is the
 * wordmark and the claim, centred, with nothing behind it; then the demo takes over completely
 * as a frame that pins to the viewport and grows to fill it while you scroll past.
 *
 * That split is the whole idea. A hero that runs copy beside a screenshot gives each half of the
 * frame to a different job and does neither at full size. Sequencing them means the words get a
 * clean page and the footage gets the entire screen.
 */
export function Hero({
  release,
  platform,
}: {
  release: LatestRelease | null;
  platform: PlatformId | null;
}) {
  const label = platform ? PLATFORM_LABEL[platform] : "your system";

  return (
    <>


      {/*
        Sized to the viewport minus the header, so the film frame below starts exactly at the
        fold rather than a header's height past it.
      */}
      <section
        id="top"
        className="grain relative isolate flex flex-col items-center justify-center px-6 pt-30 pb-20 text-center"
      >
        {/*
          Wider than the viewport and lifted until only the foot of the limb is in frame, so what
          reads is an arc across the top of the page rather than a circle behind the words.
        */}
        <div
          className="moon-arc pointer-events-none absolute left-1/2 top-0 -z-10 aspect-square w-[min(78rem,170vw)] -translate-x-1/2 -translate-y-[82%] rounded-full"
          aria-hidden="true"
        />

        {/*
          Flanking the column diagonally, offset from the centre line rather than from the
          viewport edge — the text is centred, so anything measured from the edge drifts away from
          it as the window widens. This keeps the same gap at every width.
        */}
        <ServiceBadge
          className="left-[calc(50%-23rem)] top-[27%]"
          tilt="-7deg"
          delay="-2.4s"
          duration="7.5s"
        >
          <BrandIcon icon={SERVICE_ICON.discord} width={19} height={15} />
          <span className="font-mono text-[12px] text-foreground/55">rich presence</span>
        </ServiceBadge>

        <ServiceBadge
          className="right-[calc(50%-24rem)] top-[49%]"
          tilt="6deg"
          delay="-5.1s"
          duration="8.5s"
        >
          <BrandIcon icon={SERVICE_ICON.lastfm} width={48} height={12} />
          <span className="font-mono text-[12px] text-foreground/55">scrobbling</span>
        </ServiceBadge>

        {/*
          The wordmark is the headline.

          It can be, because the line under it says what the thing is inside twelve words. Set as
          a mark rather than as a sentence: heavier, tighter, and ending in the underscore it is
          already named after — which the blinking block simply admits is a prompt.
        */}
        <img
          className="hero-in mb-5 size-20 sm:size-24"
          src="./logo.png"
          alt=""
          width={96}
          height={96}
          style={step(0)}
        />

        <h1
          className="hero-in relative text-[clamp(56px,9vw,96px)] font-bold leading-none tracking-[-0.045em] text-foreground"
          style={step(1)}
        >
          zuno_
          {release ? (
            <span className="absolute left-[calc(100%+0.5rem)] top-1 whitespace-nowrap rounded-full border border-primary/40 px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-primary max-sm:hidden">
              v{release.version}
            </span>
          ) : null}
        </h1>

        {/* Two deliberate lines: what it is, then the one thing no browser tab does. */}
        <p
          className="hero-in mt-5 max-w-[36ch] text-balance text-xl leading-[1.5] tracking-[-0.01em] text-foreground/60"
          style={step(2)}
        >
          A desktop client for the YouTube Music.
          <br className="max-sm:hidden" />Downloads, Lyrics & No Ads.
        </p>

        <p className="hero-in mt-3 text-[15px] text-foreground/40" style={step(3)}>
          Free and open source. No telemetry, and no account to create.
        </p>

        <div
          className="hero-in mt-9 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center"
          style={step(4)}
        >
          {/* Down to the tiles rather than straight at the asset: the format choice (msi vs exe,
              deb vs rpm vs AppImage) lives there, and a hero button cannot make it for you. */}
          <LinkButton href="#download" size="lg">
            Download for {label}
            <ArrowDownIcon
              size={18}
              className="transition-transform duration-200 group-hover:translate-y-0.5"
            />
          </LinkButton>

          <LinkButton variant="outline" size="lg" href={GITHUB_REPO} rel="noopener">
            Read the source
            <ArrowRightIcon
              size={18}
              className="transition-transform duration-200 group-hover:translate-x-0.5"
            />
          </LinkButton>
        </div>

        {/* The same three marks the download tiles use, so the promise here and the choice there
            read as one row. Apple's glyph ships unfilled, so it takes the text colour. */}
        <ul
          className="hero-in mt-7 flex flex-wrap items-center justify-center gap-2"
          style={step(5)}
        >
          {(["windows", "macos", "linux"] as const).map((os) => (
            <li
              key={os}
              className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] py-1.5 pl-2.5 pr-3.5 font-mono text-[13px] font-medium tracking-[0.06em] text-foreground/50 backdrop-blur-md"
            >
              {/* Apple and Tux are silhouettes on currentColor; the Windows mark carries its
                  own blue and ignores this. */}
              <BrandIcon icon={OS_ICON[os]} width={15} height={15} className="text-foreground" />
              {PLATFORM_LABEL[os === "macos" ? "macos-arm" : os]}
            </li>
          ))}
        </ul>
      </section>

      {/*
        The film stage.

        Taller than the viewport, with the frame pinned inside it: the demo holds still and grows
        to fill the screen while the page scrolls behind it, then releases. The video is the only
        thing in it — no chrome, no transport, no play button, because it is already playing.
      */}
      <div className="film-stage">
        <div className="film-sticky">
          <div className="film-frame">
            <video
              className="absolute inset-0 size-full object-cover"
              width={DEMO_W}
              height={DEMO_H}
              src={DEMO_VIDEO}
              poster={DEMO_POSTER}
              /* Muted and inline because every mobile engine requires both before it will honour
                 autoplay at all. Decoration, hence `aria-hidden` — there is nothing to operate
                 here and the copy above carries the meaning. */
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              aria-hidden="true"
            />
            {/* The footage is lit brighter than the page. A flat tint settles it into the
                surrounding dark without touching the video's own colour. */}
            <div className="pointer-events-none absolute inset-0 bg-black/25" aria-hidden="true" />
          </div>
        </div>
      </div>

      {/* The features, as a quiet index under the film rather than as a claim inside the hero. */}
      <ol className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-x-8 gap-y-3 px-6 pb-4 pt-14 sm:grid-cols-3 lg:grid-cols-6">
        {FEATURES.map((feature, i) => (
          <li key={feature} className="flex items-baseline gap-2.5">
            <Mono className="tabular-nums text-foreground/25">
              {String(i + 1).padStart(2, "0")}
            </Mono>
            <span className="text-pretty text-sm leading-6 text-foreground/60">{feature}</span>
          </li>
        ))}
      </ol>
    </>
  );
}
