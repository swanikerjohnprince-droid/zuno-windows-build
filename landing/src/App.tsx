import { useLatestRelease } from "@/useLatestRelease";
import { Downloads } from "@/components/Downloads";
import { Hero } from "@/components/Hero";
import { MiniPlayer } from "@/components/MiniPlayer";
import { Mono, Section } from "./components/ui";
import { GITHUB_REPO, RELEASES_URL } from "./releases";

/**
 * The Zuno character, looping.
 *
 * The one place with room for personality — everything else on the page is doing a job. Muted,
 * looping and `playsInline` so it behaves like a graphic rather than media: no controls, nothing
 * to pause, and it never asks for sound.
 */
function Character() {
  return (
    <video
      className="size-16 shrink-0 rounded-2xl bg-card/40 object-cover"
      src="./zuno-character.mp4"
      autoPlay
      muted
      loop
      playsInline
      aria-hidden="true"
    />
  );
}

function Footer() {
  return (
    <footer className=" bg-black">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-14 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-end gap-4">
          <Character />
          <div className="flex max-w-sm flex-col gap-2">
            <span className="flex items-center gap-2 text-base font-bold text-foreground">
              <img className="size-5" src="./logo.png" alt="" />
              zuno_
            </span>
            <Mono className="leading-relaxed">
              an independent, unofficial project. not affiliated with, authorised by or endorsed
              by youtube or google.
            </Mono>
          </div>
        </div>

        <nav className="flex flex-wrap items-center gap-5" aria-label="Links">
          {[
            ["github", GITHUB_REPO],
            ["releases", RELEASES_URL],
            ["issues", `${GITHUB_REPO}/issues`],
            ["licence", `${GITHUB_REPO}/blob/main/LICENSE`],
          ].map(([label, href]) => (
            <a
              key={href}
              className="font-mono text-[13px] text-muted-foreground transition-colors hover:text-foreground"
              href={href}
              rel="noopener"
            >
              {label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}

export function App() {
  const latest = useLatestRelease();

  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex-1">
        <Hero release={latest.release} platform={latest.platform} />

        <Section
          id="download"
          index="01"
          title="Get it"
          lede="Free and open source. Pick your system — the format choice inside each tile is the only decision to make."
        >
          <Downloads release={latest.release} platform={latest.platform} />
        </Section>
      </main>
      <Footer />
      <MiniPlayer />
    </div>
  );
}
