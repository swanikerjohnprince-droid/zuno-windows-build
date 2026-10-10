import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Track } from "../../datasource/types";
import { usePlayerSessionSelector, type PlayerControllerActions } from "../../player/playerStore";
import type { PlayerSession } from "../../player/PlayerController";
import { TrackArtwork } from "../components/TrackArtwork";
import { cn } from "@/lib/utils";
import { OUTPUT_RESET_EVENT } from "../settings/audioOutputDevice";
import { Marquee } from "@/components/motion/marquee";
import { PlayIcon, PauseIcon, MusicNoteIcon, ArrowRightIcon } from "@/ui/icons";

/** Bounds for the operator-adjustable "MIX A → B" transition length, in seconds. */
const MIN_TRANSITION_SEC = 1;
const MAX_TRANSITION_SEC = 12;
const DEFAULT_TRANSITION_SEC = 4;

/** How often the on-screen deck positions refresh. Audio timing never depends on this. */
const DECK_CLOCK_MS = 100;

/** Per-deck trim range. 1 is unity gain; this only ever attenuates or boosts around that. */
const MIN_TRIM = 0.5;
const MAX_TRIM = 1.5;

/**
 * The crossfader's constant-power curve, ported from Mixxx's `EngineXfader::getXfadeGains`
 * (src/engine/enginexfader.cpp, GPL-2.0) at its default "transform" of 1.0 — Mixxx exposes that
 * as a "hold time" tuning knob per mixer profile; this fixes it at their default rather than
 * adding a second slider on top of TRANSITION and TRIM.
 *
 * The plain `cos`/`sin` law used before is also constant-power (gain² always sums to 1), but
 * it's a pure trig derivation. Mixxx's is instead the result of measuring against real mixed
 * audio: their source comment says they tested 30-second clips across genres with ReplayGain 2.0
 * analysis and tuned the curve to that, rather than to the trigonometric ideal. The two land in
 * the same place at the ends and at center, and differ in between — Mixxx's cuts each side a
 * little harder approaching center.
 */
function xfadeGains(normalizedAtoB: number): [gainA: number, gainB: number] {
  // Mixxx's own coordinate space is -1 (hard left) .. +1 (hard right); map our 0..1 (A..B) onto it.
  const position = Math.max(0, Math.min(1, normalizedAtoB)) * 2 - 1;
  const powerCalibration = 0.5; // pow(0.5, 1 / transform) with transform = 1.0
  const scaled = position * powerCalibration;
  const left = scaled - powerCalibration;
  const right = scaled + powerCalibration;

  let gainA = right > 0 ? 1 - right : 1;
  let gainB = left < 0 ? 1 - Math.abs(left) : 1;
  gainA = Math.max(0, gainA);
  gainB = Math.max(0, gainB);

  // Pins the pair onto gainA + gainB == 1 before the sqrt step below turns that linear pair
  // into a constant-power one — same order of operations as the source, not simplifiable to
  // "normalize first" without changing the curve's shape near the clipped ends.
  if (gainA > gainB) gainB = 1 - gainA; else gainA = 1 - gainB;
  const norm = Math.sqrt(gainA * gainA + gainB * gainB) || 1;
  return [gainA / norm, gainB / norm];
}

interface DJModeProps {
  session: PlayerSession;
  playerController: PlayerControllerActions;
  onClose: () => void;
}

function ScrollingText({
  children,
  className,
  speed = 22,
}: {
  children: React.ReactNode;
  className?: string;
  speed?: number;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const viewport = viewportRef.current;
    const text = textRef.current;
    if (!viewport || !text) return;

    const update = () => setOverflowing(text.scrollWidth > viewport.clientWidth + 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    observer.observe(text);
    return () => observer.disconnect();
  }, [children]);

  return (
    <div ref={viewportRef} className={cn("min-w-0 overflow-hidden whitespace-nowrap", className)}>
      <span
        ref={textRef}
        aria-hidden={overflowing}
        className={cn("inline-block whitespace-nowrap", overflowing && "invisible absolute")}
      >
        {children}
      </span>
      {overflowing && (
        <Marquee speed={speed} gap="2.5rem" className={className}>
          <span className="whitespace-nowrap">{children}</span>
        </Marquee>
      )}
    </div>
  );
}

function formatTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

/** Peaks requested per track: enough for a crisp full-width overview at 2x pixel density. */
const WAVEFORM_BUCKETS = 1024;
const WAVEFORM_HEIGHT = 80;

type WaveformStatus = "empty" | "loading" | "ready" | "unavailable";

/**
 * Real peaks for a deck's track, decoded once in Rust and cached by the controller. Streaming
 * tracks are analysed from the buffer their own playback is filling, so they only have a
 * waveform once they are actually loaded onto a deck — `retryKey` is how a deck says "that has
 * changed, ask again" (Deck A flips it when playback starts; Deck B when it is played). A track
 * with no peaks to give is shown as having none, never as a generated stand-in shape, because a
 * made-up waveform is worse than none: a DJ reads breaks and drops off it.
 */
function useWaveform(playerController: PlayerControllerActions, track: Track | null, retryKey: boolean) {
  const [result, setResult] = useState<{ id: string | null; peaks: Uint8Array | null; status: WaveformStatus }>({
    id: null,
    peaks: null,
    status: "empty",
  });
  const resultRef = useRef(result);
  resultRef.current = result;
  const trackId = track?.id ?? null;

  useEffect(() => {
    if (!track) {
      setResult({ id: null, peaks: null, status: "empty" });
      return;
    }
    // Already drawn for this track: a retry signal must not blank a working waveform.
    if (resultRef.current.id === track.id && resultRef.current.status === "ready") return;
    let cancelled = false;
    setResult({ id: track.id, peaks: null, status: "loading" });
    void playerController.getWaveform(track, WAVEFORM_BUCKETS).then((peaks) => {
      if (cancelled) return;
      setResult({ id: track.id, peaks, status: peaks ? "ready" : "unavailable" });
    });
    return () => {
      cancelled = true;
    };
    // Keyed on the id: a new Track object for the same song must not trigger a second decode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, retryKey, playerController]);

  // A result for the previous track must never draw under the new one for even one frame.
  return result.id === trackId ? result : { id: trackId, peaks: null, status: (trackId ? "loading" : "empty") as WaveformStatus };
}

/**
 * The whole song at once, left to right, with the played part lit — the overview a DJ uses to
 * see where the breaks and drops are, as in Mixxx's overview waveform (which likewise shows the
 * full track and is clickable to jump). Peaks are mirrored around the centre line and each
 * pixel column takes the loudest bucket under it, so a transient never disappears when the
 * panel is narrower than the bucket count.
 */
function Waveform({
  peaks,
  status,
  fraction,
  disabled,
  onSeekFraction,
}: {
  peaks: Uint8Array | null;
  status: WaveformStatus;
  fraction: number;
  disabled: boolean;
  onSeekFraction: (fraction: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const draggingRef = useRef(false);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setWidth(Math.floor(node.clientWidth)));
    observer.observe(node);
    setWidth(Math.floor(node.clientWidth));
    return () => observer.disconnect();
  }, []);

  const clamped = Math.max(0, Math.min(1, fraction));
  const playedPx = Math.round(clamped * width);
  const ratio = window.devicePixelRatio || 1;

  /*
   * The bar heights depend only on the peaks and the width, never on the playhead, so they are
   * worked out once here instead of on every redraw. The old draw loop re-scanned the peaks for
   * every pixel column each time the lit edge moved by a pixel; this leaves the draw effect
   * with nothing to do but fill rectangles.
   */
  const columns = useMemo(() => {
    if (!peaks || peaks.length === 0 || width <= 0) return null;
    const pixelWidth = Math.max(1, Math.floor(width * ratio));
    const pixelHeight = Math.floor(WAVEFORM_HEIGHT * ratio);
    const mid = pixelHeight / 2;
    const barWidth = Math.max(1, Math.round(ratio));
    const step = barWidth + (ratio >= 2 ? 1 : 0);
    const count = Math.ceil(pixelWidth / step);
    const tops = new Float32Array(count);
    const heights = new Float32Array(count);
    for (let column = 0; column < count; column += 1) {
      const x = column * step;
      const from = Math.floor((x / pixelWidth) * peaks.length);
      const to = Math.max(from + 1, Math.ceil(((x + step) / pixelWidth) * peaks.length));
      let peak = 0;
      for (let i = from; i < to && i < peaks.length; i += 1) {
        if (peaks[i] > peak) peak = peaks[i];
      }
      // A floor of one pixel each side keeps silence visible as a thin line, not a gap.
      const half = Math.max(ratio, (peak / 255) * mid * 0.96);
      tops[column] = mid - half;
      heights[column] = half * 2;
    }
    return { pixelWidth, pixelHeight, barWidth, step, count, tops, heights };
  }, [peaks, width, ratio]);

  // `getComputedStyle` can force a synchronous style recalculation, and it used to run on every
  // redraw. The colours only change with the theme, which is one attribute on <html>.
  const colorsRef = useRef<{ key: string; played: string; unplayed: string } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !columns) return;
    const { pixelWidth, pixelHeight, barWidth, step, count, tops, heights } = columns;
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, pixelWidth, pixelHeight);

    const root = document.documentElement;
    const themeKey = `${root.getAttribute("data-theme") ?? ""}|${root.getAttribute("style") ?? ""}`;
    if (!colorsRef.current || colorsRef.current.key !== themeKey) {
      const styles = getComputedStyle(canvas);
      colorsRef.current = {
        key: themeKey,
        played: styles.getPropertyValue("--color-primary").trim() || "#00cccc",
        unplayed: styles.getPropertyValue("--color-muted-foreground").trim() || "#888",
      };
    }
    const { played, unplayed } = colorsRef.current;

    // Columns are laid out left to right, so "played" is simply the first `split` of them.
    const playedEdge = clamped * pixelWidth;
    const split = Math.max(0, Math.min(count, Math.floor((playedEdge - barWidth) / step) + 1));

    // Two paths and two fills rather than one fillRect (and one style change) per column.
    ctx.globalAlpha = 1;
    ctx.fillStyle = played;
    ctx.beginPath();
    for (let column = 0; column < split; column += 1) {
      ctx.rect(column * step, tops[column], barWidth, heights[column]);
    }
    ctx.fill();

    ctx.globalAlpha = 0.45;
    ctx.fillStyle = unplayed;
    ctx.beginPath();
    for (let column = split; column < count; column += 1) {
      ctx.rect(column * step, tops[column], barWidth, heights[column]);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
    // playedPx (not the raw fraction) is the dependency: redrawing on every tick that
    // doesn't move the lit edge by a whole pixel would be pure waste.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, playedPx]);

  const seekFromEvent = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    onSeekFraction(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)));
  };

  return (
    <div
      ref={wrapRef}
      role="slider"
      aria-label="Track position"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      aria-disabled={disabled}
      className={cn(
        "relative w-full select-none overflow-hidden rounded-lg bg-background/40",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
      )}
      style={{ height: WAVEFORM_HEIGHT, touchAction: "none" }}
      onPointerDown={(event) => {
        if (disabled) return;
        draggingRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        seekFromEvent(event);
      }}
      onPointerMove={(event) => {
        if (draggingRef.current && !disabled) seekFromEvent(event);
      }}
      onPointerUp={() => {
        draggingRef.current = false;
      }}
      onPointerCancel={() => {
        draggingRef.current = false;
      }}
    >
      {status === "ready" ? (
        <canvas ref={canvasRef} className="block size-full" style={{ width: "100%", height: WAVEFORM_HEIGHT }} />
      ) : (
        <>
          {/* No peaks to draw: a plain progress bar, so the position still reads and seeking still works. */}
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted-foreground/25" />
          <div
            className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary"
            style={{ width: `${clamped * 100}%` }}
          />
          <div
            className={cn(
              "pointer-events-none absolute inset-0 grid place-items-center pb-9 text-[10px] font-semibold tracking-wide text-muted-foreground",
              status === "loading" && "animate-pulse",
            )}
          >
            {status === "loading" && "Analysing waveform…"}
            {status === "unavailable" && "Waveform not ready — it appears once the track has loaded"}
          </div>
        </>
      )}
      {status === "ready" && (
        <div className="pointer-events-none absolute inset-y-0 w-px bg-foreground" style={{ left: `${clamped * 100}%` }} />
      )}
    </div>
  );
}

function Deck({
  side,
  track,
  position,
  duration,
  playing,
  trim,
  peaks,
  waveformStatus,
  locked,
  onPlay,
  onCue,
  onSeek,
  onHotCue,
  onTrim,
  hotCues,
  dragState,
}: {
  side: "A" | "B";
  track: Track | null;
  position: number;
  duration: number;
  playing: boolean;
  trim: number;
  peaks: Uint8Array | null;
  waveformStatus: WaveformStatus;
  /** True while a MIX A → B is running: transport is the native crossfade's, not the person's. */
  locked: boolean;
  onPlay: () => void;
  onCue: () => void;
  onSeek: (value: number) => void;
  onHotCue: (index: number) => void;
  onTrim: (value: number) => void;
  hotCues: (number | null)[];
  /** A queue track is being dragged: null = no drag, otherwise which deck (if any) it is over. */
  dragState: DragTarget;
}) {
  const dragging = dragState !== null;
  const isDropTarget = dragState === side;

  return (
    <section
      data-deck-drop={side}
      className={cn(
        "relative min-w-0 flex-1 rounded-2xl bg-card/80 p-4 shadow-2xl shadow-black/20 transition-shadow",
        dragging && "ring-2 ring-primary/30",
        isDropTarget && "bg-primary/10 ring-primary",
      )}
    >
      {dragging && (
        // Covers the deck while a track is being dragged so the target is unmistakable, and is
        // pointer-events-none so hit-testing still lands on the section underneath.
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-2xl bg-background/60">
          <span className={cn(
            "rounded-full px-4 py-2 text-xs font-bold tracking-widest",
            isDropTarget ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}>
            {isDropTarget ? `RELEASE TO LOAD ON DECK ${side}` : `DROP ON DECK ${side}`}
          </span>
        </div>
      )}
      <div className="mb-4 flex items-center justify-between gap-3">
        {/*
          min-w-0 is what lets ScrollingText ever see an overflow: a flex item will not shrink
          below the width of its content, and until the title is known to overflow it is still
          laid out in flow — so without this the column just grows to the full title, nothing
          overflows, nothing scrolls, and the header pushes the TRIM control out instead.
        */}
        <div className="min-w-0">
          <div className="text-[10px] font-bold tracking-[0.22em] text-primary">DECK {side}</div>
          <ScrollingText className="mt-1 text-lg font-semibold">{track?.title ?? "Load a track"}</ScrollingText>
          <ScrollingText className="text-xs text-muted-foreground">{track?.artist ?? "Choose a song from the library"}</ScrollingText>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-[10px] font-semibold text-muted-foreground">
          <label className="flex items-center gap-1.5">
            <span className="tracking-widest">TRIM</span>
            <input
              aria-label={`Deck ${side} trim`}
              type="range"
              min={MIN_TRIM}
              max={MAX_TRIM}
              step={0.01}
              value={trim}
              onChange={(event) => onTrim(Number(event.target.value))}
              className="w-16 accent-[var(--color-primary)]"
            />
          </label>
        </div>
      </div>

      <div className="mb-4 grid place-items-center">
        <div className="relative size-32 overflow-hidden rounded-xl bg-muted shadow-lg">
          {track?.artworkUrl ? (
            <TrackArtwork artworkUrl={track.artworkUrl} className="size-full" size={180} iconSize={30} />
          ) : <MusicNoteIcon size={34} className="text-muted-foreground" />}
          <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-white/10" />
        </div>
      </div>

      <div className="mb-3 rounded-xl bg-background/70 p-2">
        <Waveform
          peaks={peaks}
          status={waveformStatus}
          fraction={duration ? position / duration : 0}
          disabled={locked || !duration}
          onSeekFraction={(fraction) => onSeek(fraction * duration)}
        />
        <input
          aria-label={`Deck ${side} position`}
          type="range"
          min={0}
          max={Math.max(0.01, duration)}
          step={0.01}
          value={Math.min(position, duration || 0)}
          disabled={locked}
          onChange={(event) => onSeek(Number(event.target.value))}
          className="mt-2 w-full accent-[var(--color-primary)] disabled:opacity-50"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>{formatTime(position)}</span><span>{formatTime(duration)}</span>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <button type="button" onClick={onCue} disabled={locked} className="h-10 rounded-xl bg-muted text-xs font-bold hover:bg-muted/80 disabled:opacity-50">CUE</button>
        <button type="button" onClick={onPlay} disabled={locked} className="grid size-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/20 disabled:opacity-50">
          {playing ? <PauseIcon size={19} /> : <PlayIcon size={19} />}
        </button>
        <div className="grid grid-cols-4 gap-1">
          {hotCues.map((cue, index) => (
            <button key={index} type="button" onClick={() => onHotCue(index)} disabled={locked} className={cn("h-10 rounded-lg text-[10px] font-bold disabled:opacity-50", cue == null ? "bg-muted text-muted-foreground" : "bg-primary/20 text-primary")}>
              {cue == null ? `C${index + 1}` : formatTime(cue)}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

const EMPTY_QUEUE: Track[] = [];
const selectQueue = (session: PlayerSession | null) => session?.queue ?? EMPTY_QUEUE;
const sameTracks = (a: Track[], b: Track[]) =>
  a.length === b.length && a.every((track, index) => track === b[index]);

/**
 * The queue, with a stable identity.
 *
 * `exportSession()` builds a fresh `queue` array on every player emit, so reading
 * `session.queue` hands back a "new" queue far more often than the queue changes. Comparing by
 * track identity keeps the previous array while the tracks are the same, which is what lets the
 * lists below sit out the DJ surface's frequent position re-renders.
 */
function useStableQueue(): Track[] {
  return usePlayerSessionSelector(selectQueue, sameTracks);
}

/**
 * Where a queue track being dragged currently is: `null` when nothing is being dragged, `"none"`
 * while dragging over empty space, otherwise the deck under the pointer. One value instead of a
 * flag plus a target keeps the page to a re-render when a drag starts, ends, or crosses a deck —
 * not on every pointer move, which stays inside `DjQueue`.
 */
type DragTarget = "A" | "B" | "none" | null;

const DRAG_THRESHOLD_PX = 6;
const EDGE_SCROLL_ZONE_PX = 56;
const EDGE_SCROLL_MAX_STEP_PX = 16;

function deckUnderPoint(x: number, y: number): "A" | "B" | null {
  const side = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-deck-drop]")?.dataset.deckDrop;
  return side === "A" || side === "B" ? side : null;
}

const DECK_BUTTON =
  "grid size-7 place-items-center rounded-lg text-[11px] font-bold transition-colors";

const QueueRow = memo(function QueueRow({
  track,
  index,
  isA,
  isB,
  playing,
  onPress,
  onLoadA,
  onLoadB,
}: {
  track: Track;
  index: number;
  isA: boolean;
  isB: boolean;
  playing: boolean;
  onPress: (event: React.PointerEvent<HTMLElement>, track: Track) => void;
  onLoadA: (track: Track) => void;
  onLoadB: (track: Track) => void;
}) {
  const status = isA ? (playing ? "PLAYING" : "LOADED") : isB ? "CUED" : null;
  return (
    <div
      onPointerDown={(event) => onPress(event, track)}
      // The artwork is an <img>, which the browser would otherwise start dragging natively —
      // cancelling the pointer stream this row's own drag depends on.
      onDragStart={(event) => event.preventDefault()}
      // pan-y keeps the list scrollable by touch; only the grip below opts out of that.
      style={{ touchAction: "pan-y" }}
      className={cn(
        "flex cursor-grab select-none items-center gap-3 rounded-xl px-3 py-2 hover:bg-white/5 active:cursor-grabbing",
        (isA || isB) && "bg-primary/10 ring-1 ring-primary/20",
      )}
    >
      <span
        data-drag-handle
        aria-hidden="true"
        style={{ touchAction: "none" }}
        className="grid size-6 shrink-0 place-items-center text-muted-foreground/60"
      >
        <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
          <circle cx="2" cy="2" r="1.2" /><circle cx="8" cy="2" r="1.2" />
          <circle cx="2" cy="7" r="1.2" /><circle cx="8" cy="7" r="1.2" />
          <circle cx="2" cy="12" r="1.2" /><circle cx="8" cy="12" r="1.2" />
        </svg>
      </span>
      <span className="w-5 text-center text-[10px] font-bold text-muted-foreground">{index + 1}</span>
      <TrackArtwork artworkUrl={track.artworkUrl} className="size-9 rounded-lg" size={48} iconSize={15} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{track.title}</span>
        <span className="block truncate text-[10px] text-muted-foreground">{track.artist}</span>
      </span>
      {status && <span className="text-[9px] font-bold text-primary">{status}</span>}
      <div className="flex shrink-0 gap-1">
        <button
          type="button"
          disabled={isA}
          onClick={() => onLoadA(track)}
          aria-label={`Load ${track.title} on Deck A`}
          title={isA ? "Already on Deck A" : "Load on Deck A"}
          className={cn(
            DECK_BUTTON,
            isA
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-primary hover:text-primary-foreground",
          )}
        >
          A
        </button>
        <button
          type="button"
          // A track cannot be on both decks: the one on Deck A is not offered to Deck B.
          disabled={isA || isB}
          onClick={() => onLoadB(track)}
          aria-label={`Load ${track.title} on Deck B`}
          title={isA ? "This track is on Deck A" : isB ? "Already on Deck B" : "Load on Deck B"}
          className={cn(
            DECK_BUTTON,
            isB
              ? "bg-primary text-primary-foreground"
              : isA
                ? "cursor-not-allowed bg-muted/40 text-muted-foreground/40"
                : "bg-muted text-muted-foreground hover:bg-primary hover:text-primary-foreground",
          )}
        >
          B
        </button>
      </div>
    </div>
  );
});

/**
 * The one queue, in place of the old Deck A queue, "load on deck" picker and Deck B quick-load
 * list — all three were the same list of the same tracks, differing only in which deck a click
 * sent it to. Now each row says so itself: an A and a B button, or drag the row onto a deck.
 *
 * Dragging is pointer-event based, like the sidebar's reordering, and deliberately not HTML5
 * drag-and-drop: with Tauri's file-drop handling left on (its default), WebView2 on Windows
 * never delivers the HTML5 drag events inside the page, and touch screens do not either. Pointer
 * events work in both. The drag position lives in this component, not in `DJMode`, so a drag does
 * not re-render the decks and their clocks on every pointer move.
 */
const DjQueue = memo(function DjQueue({
  deckAId,
  deckBId,
  playing,
  scrollRef,
  onLoadA,
  onLoadB,
  onDragTarget,
}: {
  deckAId: string | null;
  deckBId: string | null;
  playing: boolean;
  scrollRef: React.RefObject<HTMLElement | null>;
  onLoadA: (track: Track) => void;
  onLoadB: (track: Track) => void;
  onDragTarget: (target: DragTarget) => void;
}) {
  const queue = useStableQueue();
  const [ghost, setGhost] = useState<{ track: Track; x: number; y: number; over: "A" | "B" | null } | null>(null);
  const teardownRef = useRef<(() => void) | null>(null);

  // Closing DJ Mode mid-drag must not leave window listeners attached, or the cursor and text
  // selection locked the way a drag sets them.
  useEffect(() => () => teardownRef.current?.(), []);

  const onPress = useCallback((event: React.PointerEvent<HTMLElement>, track: Track) => {
    if (event.button !== 0 || teardownRef.current) return;
    const target = event.target as HTMLElement;
    // A and B buttons are clicks, not drag handles.
    if (target.closest("button")) return;
    // By touch only the grip starts a drag, so the rest of the row still scrolls the list.
    if (event.pointerType === "touch" && !target.closest("[data-drag-handle]")) return;

    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let x = startX;
    let y = startY;
    let dragging = false;
    let over: "A" | "B" | null = null;
    let frame = 0;

    const updateOver = () => {
      const next = deckUnderPoint(x, y);
      if (next === over) return;
      over = next;
      onDragTarget(next ?? "none");
    };

    // The decks sit above the queue, so a long page needs scrolling mid-drag. Also re-tests what
    // is under the pointer each frame: scrolling moves a deck under a pointer that is not moving.
    const autoScroll = () => {
      const container = scrollRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        if (y < rect.top + EDGE_SCROLL_ZONE_PX) {
          container.scrollTop -= Math.min(EDGE_SCROLL_MAX_STEP_PX, Math.ceil((rect.top + EDGE_SCROLL_ZONE_PX - y) / 3));
        } else if (y > rect.bottom - EDGE_SCROLL_ZONE_PX) {
          container.scrollTop += Math.min(EDGE_SCROLL_MAX_STEP_PX, Math.ceil((y - (rect.bottom - EDGE_SCROLL_ZONE_PX)) / 3));
        }
        updateOver();
        setGhost((current) => (current && current.over !== over ? { ...current, over } : current));
      }
      frame = requestAnimationFrame(autoScroll);
    };

    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      x = moveEvent.clientX;
      y = moveEvent.clientY;
      if (!dragging) {
        // Below the threshold this is still a click or a text-select attempt, not a drag.
        if (Math.hypot(x - startX, y - startY) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
        onDragTarget("none");
        frame = requestAnimationFrame(autoScroll);
      }
      updateOver();
      setGhost({ track, x, y, over });
    };

    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
      cancelAnimationFrame(frame);
      teardownRef.current = null;
      if (!dragging) return;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setGhost(null);
      onDragTarget(null);
      if (commit && over) (over === "A" ? onLoadA : onLoadB)(track);
    };
    const up = (upEvent: PointerEvent) => {
      if (upEvent.pointerId === pointerId) finish(true);
    };
    const cancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId === pointerId) finish(false);
    };
    const key = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === "Escape") finish(false);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    teardownRef.current = () => finish(false);
  }, [onDragTarget, onLoadA, onLoadB, scrollRef]);

  return (
    <div className="flex max-h-[30rem] min-w-0 flex-col rounded-2xl bg-card/60 p-4">
      <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold tracking-widest">QUEUE</div>
          <div className="text-[10px] text-muted-foreground">
            Drag a track onto a deck, or press A / B to load it. Your main Zuno queue stays here.
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[9px] font-bold text-muted-foreground">
          {queue.length} TRACKS
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto pr-1">
        {queue.map((track, index) => (
          <QueueRow
            key={track.id}
            track={track}
            index={index}
            isA={deckAId === track.id}
            isB={deckBId === track.id}
            playing={playing}
            onPress={onPress}
            onLoadA={onLoadA}
            onLoadB={onLoadB}
          />
        ))}
        {!queue.length && (
          <div className="py-6 text-center text-xs text-muted-foreground">Add tracks to the main Zuno queue.</div>
        )}
      </div>
      {ghost && createPortal(
        // In a portal on <body>: DJ Mode sits inside overflow-hidden, possibly transformed,
        // ancestors, which would clip a fixed-position ghost or anchor it to the wrong box.
        <div
          className="pointer-events-none fixed z-[200] flex w-60 items-center gap-2 rounded-xl bg-card px-3 py-2 shadow-2xl ring-1 ring-primary/40"
          style={{ left: ghost.x + 14, top: ghost.y + 14 }}
        >
          <TrackArtwork artworkUrl={ghost.track.artworkUrl} className="size-8 rounded-md" size={40} iconSize={14} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold">{ghost.track.title}</span>
            <span className="block truncate text-[10px] text-muted-foreground">{ghost.track.artist}</span>
          </span>
          {ghost.over && (
            <span className="rounded-md bg-primary px-1.5 py-0.5 text-[9px] font-bold text-primary-foreground">
              → DECK {ghost.over}
            </span>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
});

export function DJMode({ session, playerController, onClose }: DJModeProps) {
  const [deckB, setDeckB] = useState<Track | null>(
    session.queue[session.queueIndex + 1] ?? session.queue.find((track) => track.id !== session.currentTrack?.id) ?? null,
  );
  const [crossfader, setCrossfader] = useState(0);
  // Remember the actual mixer levels so loading/starting Deck A never overwrites Deck B.
  const [deckMixVolumes, setDeckMixVolumes] = useState<[number, number]>([1, 0]);
  const [deckBPlaying, setDeckBPlaying] = useState(false);
  const [deckBDuration, setDeckBDuration] = useState(0);
  const [deckBPosition, setDeckBPosition] = useState(0);
  const [deckBStartedAt, setDeckBStartedAt] = useState<number | null>(null);
  const [deckAPosition, setDeckAPosition] = useState(0);
  const [hotCuesA, setHotCuesA] = useState<(number | null)[]>([null, null, null, null]);
  const [hotCuesB, setHotCuesB] = useState<(number | null)[]>([null, null, null, null]);
  // Which deck a dragged queue track is over (null: nothing is being dragged). See DragTarget.
  const [dragTarget, setDragTarget] = useState<DragTarget>(null);
  // The scrolling page body, so a drag near its top or bottom edge can scroll it.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [trimA, setTrimA] = useState(1);
  const [trimB, setTrimB] = useState(1);
  const [transitionSec, setTransitionSec] = useState(DEFAULT_TRANSITION_SEC);
  const [isMixing, setIsMixing] = useState(false);
  const queue = useStableQueue();
  const canMix = Boolean(deckB) && !isMixing;

  // The output stream gets reopened when a different device is chosen or the OS default moves, and
  // that empties both decks. Deck A is reloaded by whoever reopened it; Deck B is only ever
  // loaded by this component, so it has to put itself back: re-cue it, show it as stopped (it
  // is — nothing is playing on a deck that was just created), and re-send the mixer levels,
  // which a fresh deck starts without. A ref, not state: this subscription must not be torn
  // down and re-added on every render just to see the latest Deck B.
  const outputResetRef = useRef({ deckB, deckMixVolumes, playerController });
  outputResetRef.current = { deckB, deckMixVolumes, playerController };
  useEffect(() => {
    const onReset = () => {
      const { deckB: current, deckMixVolumes: volumes, playerController: controller } = outputResetRef.current;
      setDeckBPlaying(false);
      setDeckBStartedAt(null);
      if (!current) return;
      void controller.cueTrack(current).then((ready) => {
        if (!ready) return;
        setDeckBDuration(controller.getCuedDuration(current));
        void controller.setDjDeckVolumes(volumes[0], volumes[1]);
      });
    };
    window.addEventListener(OUTPUT_RESET_EVENT, onReset);
    return () => window.removeEventListener(OUTPUT_RESET_EVENT, onReset);
  }, []);

  // mixAtoB awaits the whole native fade (and then a short ease) before it touches the mixer
  // again. If DJ Mode is closed in that window the unmount cleanup has already restored the
  // engine to (1, 0); letting the rest of the mix run would then re-apply the DJ levels to a
  // player that is no longer in DJ Mode.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  // Set synchronously so a fast slider drag cannot start Deck B several times before the first
  // playCuedTrack resolves and flips deckBPlaying.
  const deckBStartingRef = useRef(false);

  // Tell the controller that this DJ surface owns a live standby deck. This prevents a normal
  // browse/search track change from tearing Deck B down while Split Mode remains open.
  const cleanupRef = useRef({ deckB, deckBPlaying, playerController });
  cleanupRef.current = { deckB, deckBPlaying, playerController };
  useEffect(() => {
    playerController.setDjDeckActive(true);
    return () => {
      const {
        deckB: exitingDeckB,
        deckBPlaying: exitingDeckBPlaying,
        playerController: exitingController,
      } = cleanupRef.current;
      exitingController.setDjDeckActive(false);
      if (exitingDeckBPlaying && exitingDeckB) {
        void exitingController.pauseCuedTrack(exitingDeckB);
      }
      void exitingController.setDjDeckVolumes(1, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerController]);

  // Start with a known mixer state whenever DJ/Split Mode mounts.
  useEffect(() => {
    setDeckMixVolumes([1, 0]);
    void playerController.setDjDeckVolumes(1, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerController]);

  const deckA = session.currentTrack;
  const waveformA = useWaveform(playerController, deckA, session.status === "playing");
  const waveformB = useWaveform(playerController, deckB, deckBPlaying);
  const durationA = deckA?.durationSec ?? playerController.getDuration();
  const durationB = deckBDuration || deckB?.durationSec || 0;

  // The player store intentionally does not emit on every audio sample, so the DJ surface
  // keeps its own lightweight visual clock while the real audio engine remains the source of truth.
  useEffect(() => {
    if (session.status !== "playing") {
      setDeckAPosition(session.positionSec);
      return;
    }
    const tick = () => setDeckAPosition(Math.max(0, playerController.getCurrentTime()));
    tick();
    // 100ms: one waveform pixel is roughly a third of a second of a normal-length track, so a
    // faster clock only re-rendered the deck without moving anything a person could see.
    const timer = window.setInterval(tick, DECK_CLOCK_MS);
    return () => window.clearInterval(timer);
  }, [session.status, session.positionSec, playerController, deckA?.id]);

  // Keep Deck A tied to the real player session. This is deliberately derived from session
  // rather than copied into local state, so loading a song anywhere in Zuno immediately updates
  // the DJ deck.
  useEffect(() => {
    if (!deckB || deckB.id === deckA?.id) {
      const replacement = queue.find((track) => track.id !== deckA?.id) ?? null;
      setDeckB(replacement);
      setDeckBPlaying(false);
      setDeckBDuration(0);
      setDeckBPosition(0);
      setDeckBStartedAt(null);
    }
  }, [deckA?.id, queue, deckB]);

  // Deck B has its own visual clock. Rust owns the actual audio clock; this clock is only for
  // showing the prepared standby deck while it plays simultaneously.
  useEffect(() => {
    if (!deckBPlaying || !deckBStartedAt || !durationB) return;
    const timer = window.setInterval(() => {
      const elapsed = (Date.now() - deckBStartedAt) / 1000;
      setDeckBPosition(Math.min(durationB, elapsed));
      if (elapsed >= durationB) {
        setDeckBPlaying(false);
        setDeckBStartedAt(null);
      }
    }, DECK_CLOCK_MS);
    return () => window.clearInterval(timer);
  }, [deckBPlaying, deckBStartedAt, durationB]);

  // Hot cues belong to the track, not the deck slot. Clear them whenever a different
  // track is loaded so cue points from the previous song cannot be reused accidentally.
  useEffect(() => {
    setHotCuesA([null, null, null, null]);
  }, [deckA?.id]);

  useEffect(() => {
    setHotCuesB([null, null, null, null]);
  }, [deckB?.id]);

  // Prepare Deck B whenever the selection changes.
  useEffect(() => {
    if (!deckB) return;
    setDeckBPosition(0);
    setDeckBStartedAt(null);
    setDeckBPlaying(false);
    setDeckBDuration(deckB.durationSec || 0);
    void playerController.cueTrack(deckB).then((ready) => {
      if (!ready) return;
      setDeckBDuration(playerController.getCuedDuration(deckB));
    });
  }, [deckB, playerController]);

  // Mixxx-derived crossfade curve (see xfadeGains above), then each deck's own trim knob on
  // top. Trim is a client-side gain multiplier — the native engine only exposes one volume per
  // deck, so "TRIM" is exactly that volume scaled before it is sent down, the same way a real
  // mixer channel gain sits upstream of the crossfader.
  const deckVolumes = (normalized: number): [number, number] => {
    const [gainA, gainB] = xfadeGains(normalized);
    return [
      Math.max(0, Math.min(1, gainA * trimA)),
      Math.max(0, Math.min(1, gainB * trimB)),
    ];
  };

  const applyCrossfader = (value: number) => {
    if (isMixing) return;
    const normalized = Math.max(0, Math.min(100, value)) / 100;
    setCrossfader(value);
    const [volumeA, volumeB] = deckVolumes(normalized);
    setDeckMixVolumes([volumeA, volumeB]);
    void playerController.setDjDeckVolumes(volumeA, volumeB);

    // Like a professional DJ app, moving toward a silent prepared deck can start that deck.
    if (deckB && normalized > 0 && !deckBPlaying && !deckBStartingRef.current) {
      deckBStartingRef.current = true;
      void playerController.playCuedTrack(deckB, volumeB).then((started) => {
        if (!started) return;
        setDeckBPlaying(true);
        setDeckBStartedAt(Date.now() - deckBPosition * 1000);
      }).finally(() => {
        deckBStartingRef.current = false;
      });
    }
  };

  // Trim knobs re-apply the current crossfader position immediately, so nudging a knob is
  // audible right away instead of waiting for the next crossfader move.
  const applyTrim = (side: "A" | "B", value: number) => {
    const clamped = Math.max(MIN_TRIM, Math.min(MAX_TRIM, value));
    if (isMixing) {
      if (side === "A") setTrimA(clamped); else setTrimB(clamped);
      return;
    }
    if (side === "A") setTrimA(clamped); else setTrimB(clamped);
    const [xfadeA, xfadeB] = xfadeGains(crossfader / 100);
    const volumeA = Math.max(0, Math.min(1, xfadeA * (side === "A" ? clamped : trimA)));
    const volumeB = Math.max(0, Math.min(1, xfadeB * (side === "B" ? clamped : trimB)));
    setDeckMixVolumes([volumeA, volumeB]);
    void playerController.setDjDeckVolumes(volumeA, volumeB);
  };

  const playA = async () => {
    // Pausing the outgoing deck mid-fade would leave the native crossfade ramping into silence.
    if (isMixing) return;
    if (session.status === "playing") {
      await playerController.pauseDjActive();
      return;
    }
    const started = await playerController.playDjActive();
    if (started) {
      // Preserve Deck B's live level when a replacement Deck A track is started.
      const [volumeA, volumeB] = deckMixVolumes;
      void playerController.setDjDeckVolumes(volumeA, volumeB);
    }
  };

  const playB = async () => {
    if (!deckB || isMixing) return;
    if (deckBPlaying) {
      const paused = await playerController.pauseCuedTrack(deckB);
      if (paused) {
        setDeckBPlaying(false);
        setDeckBStartedAt(null);
      }
      return;
    }
    const [, volumeB] = deckVolumes(crossfader / 100);
    setDeckMixVolumes((current) => [current[0], volumeB]);
    const started = await playerController.playCuedTrack(deckB, volumeB);
    if (started) {
      setDeckBPlaying(true);
      setDeckBStartedAt(Date.now() - deckBPosition * 1000);
    }
  };

  const setCue = (side: "A" | "B", index: number) => {
    // `session.positionSec` is a snapshot taken when the session was last exported, which is
    // not on every audio sample, so a cue set mid-song landed wherever playback last emitted.
    const time = side === "A" ? Math.max(0, playerController.getCurrentTime()) : deckBPosition;
    const setter = side === "A" ? setHotCuesA : setHotCuesB;
    setter((current) => current.map((value, i) => i === index ? (value == null ? time : null) : value));
  };

  // Stable identities: these are handed to memoised lists, and a new function every render
  // would make every row re-render along with the deck clock.
  const selectDeckB = useCallback((track: Track) => {
    // Loading a track onto Deck B must never move the crossfader or change Deck A's level.
    // The two decks are independent: the crossfader is the only control that changes their mix.
    setDeckB(track);
  }, []);
  const loadOnDeckA = useCallback((track: Track) => {
    void playerController.loadTrack(track, true);
    setDeckAPosition(0);
  }, [playerController]);
  // A track cannot be on both decks; if the very same track were sent to Deck B while it is on
  // Deck A, the "keep Deck B different" effect would immediately swap it for something else,
  // which would look like the load silently doing the wrong thing. Read through a ref so the
  // callback keeps one identity and the memoised queue rows are not re-rendered by it.
  const deckAIdRef = useRef<string | null>(null);
  deckAIdRef.current = deckA?.id ?? null;
  const loadOnDeckB = useCallback((track: Track) => {
    if (track.id === deckAIdRef.current) return;
    selectDeckB(track);
  }, [selectDeckB]);

  /**
   * The headline DJ move: hand playback from the active deck straight to the cued Deck B over
   * `transitionSec`, using the real native crossfade rather than the manual crossfader slider.
   * On success Deck B becomes the new active track (the engine swaps deck ownership), so we
   * clear the standby side and let the effect above refill it from the queue.
   */
  const mixAtoB = async () => {
    if (!deckB || isMixing) return;
    setIsMixing(true);
    try {
      const mixed = await playerController.mixToTrack(deckB, transitionSec * 1000);
      if (mixed) {
        // mixToTrack resolves as soon as Rust starts the fade. Stay locked until it finishes,
        // or a crossfader/trim move mid-fade fights the native ramp.
        await new Promise((resolve) => window.setTimeout(resolve, transitionSec * 1000 + 150));
        if (!mountedRef.current) return;
        // The promoted track keeps the trim it had as Deck B, not whatever the previous Deck A
        // happened to be set to — trim is a property of the track's own level, not of which
        // visual slot it's drawn in, and the engine's "A"/"B" already followed the promotion on
        // its own (setDjDeckVolumes always means "whichever slot is active right now"). Landing
        // on hard (1, 0) here would silently drop trim entirely the moment a mix finishes.
        const promotedVolumeA = Math.max(0, Math.min(1, trimB));
        setTrimA(trimB);
        setTrimB(1);
        // The native fade always lands the incoming deck at full output level. Dropping straight
        // to the trimmed level from there is an audible step, so ease down over ~240ms instead.
        if (promotedVolumeA < 0.999) {
          const steps = 8;
          for (let step = 1; step <= steps; step += 1) {
            const level = 1 + (promotedVolumeA - 1) * (step / steps);
            void playerController.setDjDeckVolumes(level, 0);
            await new Promise((resolve) => window.setTimeout(resolve, 30));
            if (!mountedRef.current) return;
          }
        }
        setDeckMixVolumes([promotedVolumeA, 0]);
        void playerController.setDjDeckVolumes(promotedVolumeA, 0);
        setCrossfader(0);
        setDeckB(null);
        setDeckBPlaying(false);
        setDeckBDuration(0);
        setDeckBPosition(0);
        setDeckBStartedAt(null);
        setHotCuesB([null, null, null, null]);
        setHotCuesA([null, null, null, null]);
      }
    } finally {
      setIsMixing(false);
    }
  };

  return (
    <div className="@container/djmode flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between border-b border-white/5 px-5 py-3">
        <div>
          <div className="text-[10px] font-bold tracking-[0.28em] text-primary">ZUNO DJ</div>
          <div className="text-xs text-muted-foreground">Two-deck performance mode</div>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg bg-white/5 px-3 py-2 text-xs hover:bg-white/10">Exit DJ</button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto p-4">
        <div className="flex min-h-0 flex-col gap-4 @3xl/djmode:flex-row">
          <Deck
            side="A"
            track={deckA}
            position={deckAPosition}
            duration={durationA}
            playing={session.status === "playing"}
            trim={trimA}
            peaks={waveformA.peaks}
            waveformStatus={waveformA.status}
            locked={isMixing}
            onPlay={() => void playA()}
            onCue={() => void playerController.seekTo(hotCuesA[0] ?? 0)}
            onSeek={(value) => void playerController.seekTo(value)}
            onHotCue={(i) => setCue("A", i)}
            onTrim={(value) => applyTrim("A", value)}
            hotCues={hotCuesA}
            dragState={dragTarget}
          />
          <Deck
            side="B"
            track={deckB}
            position={deckBPosition}
            duration={durationB}
            playing={deckBPlaying}
            trim={trimB}
            peaks={waveformB.peaks}
            waveformStatus={waveformB.status}
            locked={isMixing}
            onPlay={() => void playB()}
            onCue={() => {
              if (!deckB) return;
              const time = hotCuesB[0] ?? 0;
              setDeckBPosition(time);
              void playerController.seekCuedTrack(deckB, time);
              if (deckBPlaying) setDeckBStartedAt(Date.now() - time * 1000);
            }}
            onSeek={(value) => {
              setDeckBPosition(value);
              if (deckB) {
                void playerController.seekCuedTrack(deckB, value);
                if (deckBPlaying) setDeckBStartedAt(Date.now() - value * 1000);
                const [volumeA, volumeB] = deckVolumes(crossfader / 100);
                setDeckMixVolumes([volumeA, volumeB]);
                void playerController.setDjDeckVolumes(volumeA, volumeB);
              }
            }}
            onHotCue={(i) => setCue("B", i)}
            onTrim={(value) => applyTrim("B", value)}
            hotCues={hotCuesB}
            dragState={dragTarget}
          />
        </div>

        {/* The mixer takes one half, the queue the other; they stack when the panel is narrow. */}
        <div className="mt-4 grid items-stretch gap-4 @3xl/djmode:grid-cols-2">
          <div className="min-w-0 rounded-2xl bg-card/60 p-5">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-bold tracking-widest">MIXER</div>
                <div className="text-[10px] text-muted-foreground">A ← Crossfader → B</div>
              </div>
              <div className="shrink-0 rounded-xl bg-white/5 px-4 py-2 text-center">
                <div className="text-[10px] font-bold tracking-widest text-muted-foreground">CROSSFADER</div>
                <div className="text-xl font-bold tabular-nums">{Math.round(crossfader)}%</div>
              </div>
            </div>
            <input
              aria-label="Crossfader"
              type="range"
              min={0}
              max={100}
              value={crossfader}
              disabled={isMixing}
              onChange={(event) => applyCrossfader(Number(event.target.value))}
              className="w-full accent-[var(--color-primary)]"
            />
            <div className="mt-1 flex justify-between text-[9px] font-bold text-muted-foreground">
              <span>DECK A</span><span>CENTER MIX</span><span>DECK B</span>
            </div>
            <p className="mt-3 text-[10px] text-muted-foreground">
              Both decks can play at the same time. Move the crossfader left/right to blend or switch between them,
              or let MIX A → B do it for you with the native engine's real crossfade.
            </p>

            <div className="mt-4 flex items-center gap-3 border-t border-white/5 pt-4">
              <button
                type="button"
                onClick={() => void mixAtoB()}
                disabled={!canMix}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-bold tracking-wide",
                  canMix
                    ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/90"
                    : "cursor-not-allowed bg-muted text-muted-foreground",
                )}
              >
                {isMixing ? "MIXING…" : "MIX A"}
                <ArrowRightIcon size={13} />
                {isMixing ? "" : "B"}
              </button>
              <label className="flex flex-1 items-center gap-2 text-[10px] font-semibold text-muted-foreground">
                <span className="shrink-0 tracking-widest">TRANSITION</span>
                <input
                  aria-label="Transition length"
                  type="range"
                  min={MIN_TRANSITION_SEC}
                  max={MAX_TRANSITION_SEC}
                  step={1}
                  value={transitionSec}
                  onChange={(event) => setTransitionSec(Number(event.target.value))}
                  disabled={isMixing}
                  className="w-full accent-[var(--color-primary)]"
                />
                <span className="w-6 shrink-0 text-right text-foreground">{transitionSec}s</span>
              </label>
            </div>
            {!deckB && (
              <p className="mt-2 text-[10px] text-muted-foreground">Load a track on Deck B to enable MIX A → B.</p>
            )}
          </div>

          <DjQueue
            deckAId={deckA?.id ?? null}
            deckBId={deckB?.id ?? null}
            playing={session.status === "playing"}
            scrollRef={scrollRef}
            onLoadA={loadOnDeckA}
            onLoadB={loadOnDeckB}
            onDragTarget={setDragTarget}
          />
        </div>
      </div>
    </div>
  );
}
