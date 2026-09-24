import { useState } from "react";
import { BrandIcon, OS_ICON } from "./brandIcons";
import { CheckIcon, DownloadIcon, ShieldIcon } from "./icons";
import { LinkButton, Mono, cn } from "./ui";
import {
  RELEASES_URL,
  formatSize,
  type LatestRelease,
  type PlatformId,
} from "../releases";

/**
 * One tile per operating system, each with its own format choice.
 *
 * A flat list of every asset makes the reader do the matching: four `.dmg`-ish names, two of
 * which are wrong for their machine. Grouping by OS and putting the variants behind a small
 * segmented control means there is exactly one decision per tile, and it is one the reader can
 * actually answer — "Apple Silicon or Intel" is a question about their laptop, not about a
 * filename.
 */
interface Variant {
  label: string;
  /** Which resolved platform build this maps to. */
  platform: PlatformId;
  /** Narrows further within a platform's assets — Linux ships two formats under one id. */
  match?: RegExp;
  note?: string;
}

interface OsTile {
  id: "windows" | "macos" | "linux";
  name: string;
  icon: string;
  /** Which detected platforms should light this tile up. */
  detects: readonly PlatformId[];
  requirement: string;
  variants: readonly Variant[];
}

const TILES: readonly OsTile[] = [
  {
    id: "windows",
    name: "Windows",
    icon: OS_ICON.windows,
    detects: ["windows"],
    requirement: "Windows 10 and 11 · 64-bit",
    variants: [
      { label: "Installer", platform: "windows", match: /-setup\.exe$/i },
      { label: "MSI", platform: "windows", match: /\.msi$/i },
    ],
  },
  {
    id: "macos",
    name: "macOS",
    icon: OS_ICON.macos,
    detects: ["macos-arm", "macos-intel"],
    requirement: "macOS 12 and later",
    variants: [
      {
        label: "Apple Silicon",
        platform: "macos-arm",
        note: "unsigned — right-click → Open on first launch",
      },
      {
        label: "Intel",
        platform: "macos-intel",
        note: "unsigned — right-click → Open on first launch",
      },
    ],
  },
  {
    id: "linux",
    name: "Linux",
    icon: OS_ICON.linux,
    detects: ["linux"],
    requirement: "x86_64 · glibc 2.31+",
    variants: [
      { label: "AppImage", platform: "linux", match: /\.AppImage$/i, note: "needs chmod +x" },
      { label: ".deb", platform: "linux", match: /\.deb$/i, note: "apt-based distributions" },
      { label: ".rpm", platform: "linux", match: /\.rpm$/i, note: "fedora and opensuse" },
    ],
  },
];

function Tile({
  tile,
  release,
  detected,
}: {
  tile: OsTile;
  release: LatestRelease | null;
  detected: PlatformId | null;
}) {
  const isYours = detected !== null && tile.detects.includes(detected);
  /* Open on the variant that matches the reader's machine, not always the first. */
  const [variantIndex, setVariantIndex] = useState(() => {
    const index = tile.variants.findIndex((variant) => variant.platform === detected);
    return index >= 0 ? index : 0;
  });

  const variant = tile.variants[variantIndex];
  const build = release?.downloads[variant.platform];
  /*
   * Linux ships two formats behind one platform id, so the resolved asset may be the AppImage
   * when the reader asked for the .deb. Rather than link the wrong file, the variant falls back
   * to the releases page — a correct extra click beats a confident wrong download.
   */
  const asset = build && (!variant.match || variant.match.test(build.name)) ? build : undefined;

  return (
    <article
      className={cn(
        "group relative flex flex-col gap-5 rounded-2xl p-6 ring-1 transition-colors",
        isYours ? "bg-card/70 ring-primary/30" : "bg-card/30 ring-border hover:bg-card/50",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <BrandIcon icon={tile.icon} width={34} height={34} className="text-foreground" />
        {isYours ? (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-primary">
            your system
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="text-xl font-semibold text-foreground">{tile.name}</h3>
        <Mono>{tile.requirement}</Mono>
      </div>

      {tile.variants.length > 1 ? (
        <div
          className="flex items-center gap-0.5 rounded-full bg-background/60 p-0.5 ring-1 ring-border"
          role="tablist"
          aria-label={`${tile.name} format`}
        >
          {tile.variants.map((option, index) => (
            <button
              key={option.label}
              type="button"
              role="tab"
              aria-selected={index === variantIndex}
              onClick={() => setVariantIndex(index)}
              className={cn(
                "flex-1 rounded-full px-3 py-2 font-mono text-[13px] transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                index === variantIndex
                  ? "bg-card text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-auto flex flex-col gap-3">
        <LinkButton
          href={asset?.url ?? RELEASES_URL}
          rel="noopener"
          variant={isYours ? "solid" : "muted"}
          className="w-full"
        >
          <DownloadIcon size={18} />
          Download
        </LinkButton>

        <div className="flex min-h-8 flex-col gap-0.5">
          <Mono className="truncate">
            {asset ? `${asset.name} · ${formatSize(asset.size)}` : "see all releases"}
          </Mono>
          {variant.note ? (
            <span className="text-[13px] leading-relaxed text-muted-foreground/70">
              {variant.note}
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

const ASSURANCES: readonly string[] = [
  "No telemetry — no analytics, crash reporting or usage pings",
  "Your own Google sign-in — Zuno has no account to create",
  "Apache 2.0, built from the public tree by CI",
];

export function Downloads({
  release,
  platform,
}: {
  release: LatestRelease | null;
  platform: PlatformId | null;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex items-baseline gap-2">
          <span className="text-lg font-semibold text-foreground">
            {release ? `v${release.version}` : "Latest release"}
          </span>
          <Mono>· updates install themselves after the first run</Mono>
        </span>
        <span className="ml-auto flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-primary">
          <ShieldIcon size={13} />
          <span className="font-mono text-[13px]">signed</span>
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {TILES.map((tile) => (
          <Tile key={tile.id} tile={tile} release={release} detected={platform} />
        ))}
      </div>

      <div className="flex flex-col gap-3 rounded-2xl bg-card/30 p-6 ring-1 ring-border">
        {ASSURANCES.map((line) => (
          <div key={line} className="flex items-start gap-3">
            <span
              className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"
              aria-hidden="true"
            >
              <CheckIcon size={12} />
            </span>
            <span className="text-base text-muted-foreground">{line}</span>
          </div>
        ))}
        <p className="mt-1">
          <Mono>
            no subscription · no upsell · no bundled software · no ad blocking or DRM
            circumvention — it plays what your account can already play
          </Mono>
        </p>
      </div>
    </div>
  );
}
