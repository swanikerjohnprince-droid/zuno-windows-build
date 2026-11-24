import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Track } from "../../datasource/types";
import { usePlayerSessionSelector, type PlayerControllerActions } from "../../player/playerStore";
import type { PlayerSession } from "../../player/PlayerController";
import { TrackArtwork } from "../components/TrackArtwork";
import { cn } from "@/lib/utils";
import { OUTPUT_RESET_EVENT } from "../settings/audioOutputDevice";
import {
  RELIABLE_CONFIDENCE,
  TEMPO_RANGES,
  formatBpm,
  formatPercent,
  heardBpm,
} from "./djTempo";
import { useDjTempo, type DeckTempoActions, type DeckTempoView, type WaveformStatus } from "./useDjTempo";
import { Marquee } from "@/components/motion/marquee";
import { PlayIcon, PauseIcon, MusicNoteIcon, ArrowRightIcon } from "@/ui/icons";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { scanLocalAudioPaths } from "../../player/localPlaylists";

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

/** Width of the vertical waveform strip that sits beside a deck's cover art, in CSS pixels. */
const WAVEFORM_WIDTH = 56;
/** Strip height: matches the size-32 artwork it stands beside. */
const WAVEFORM_STRIP_HEIGHT = 128;
/** Zoom range: 1 fits the whole track; higher values show less of it around the playhead. */
const MIN_WAVEFORM_ZOOM = 1;
const MAX_WAVEFORM_ZOOM = 64;
const ZOOM_STEP = 1.6;
/** Both decks share one zoom, remembered across sessions. */
const WAVEFORM_ZOOM_KEY = "zuno.dj.waveformZoom";

function clampWaveformZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_WAVEFORM_ZOOM;
  return Math.min(MAX_WAVEFORM_ZOOM, Math.max(MIN_WAVEFORM_ZOOM, zoom));
}

function readWaveformZoom(): number {
  try {
    return clampWaveformZoom(Number(window.localStorage.getItem(WAVEFORM_ZOOM_KEY)) || MIN_WAVEFORM_ZOOM);
  } catch {
    return MIN_WAVEFORM_ZOOM;
  }
}

function formatZoom(zoom: number): string {
  return zoom < 10 ? zoom.toFixed(1).replace(/\.0$/, "") : String(Math.round(zoom));
}

const ZOOM_BUTTON =
  "grid h-5 min-w-5 place-items-center rounded-md bg-muted px-1 text-[10px] font-bold text-muted-foreground transition-colors hover:bg-primary hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-muted disabled:hover:text-inherit";

/**
 * The deck's waveform as a vertical strip beside the cover art — Mixxx's overview waveform stood
 * on its side: time runs top to bottom, peaks are mirrored around a centre line, and the part
 * already played is lit. Beat markers are drawn across it the way Mixxx draws its beat grid
 * (src/widgets/waveformwidget.cpp): a thin line per beat, a heavier one every fourth beat (the
 * bar), hot cues as amber markers on the edge, the playhead as a bright glowing line — each with
 * its own colour.
 *
 * `zoom` is shared by both decks (DJMode owns it): 1 fits the whole track, and a higher value
 * shows a window of duration/zoom centred on the playhead, so zooming one deck zooms the other.
 * Zoom with the buttons under the strip, Ctrl+scroll on the strip, or double-click to fit again.
 */
function DeckWaveform({
  peaks,
  status,
  positionSec,
  durationSec,
  disabled,
  grid,
  cues,
  zoom,
  onZoomChange,
  onSeekFraction,
}: {
  peaks: Uint8Array | null;
  status: WaveformStatus;
  positionSec: number;
  durationSec: number;
  disabled: boolean;
  /** Beat grid in track time, or null when there is no tempo to draw. */
  grid: { firstBeatSec: number; bpm: number; durationSec: number } | null;
  /** Hot-cue times in seconds, drawn as markers when inside the visible window. */
  cues: (number | null)[];
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onSeekFraction: (fraction: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const draggingRef = useRef(false);
  // Refs for the non-passive wheel listener, which must not be re-attached on every render.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setSize({ w: Math.floor(node.clientWidth), h: Math.floor(node.clientHeight) }));
    observer.observe(node);
    setSize({ w: Math.floor(node.clientWidth), h: Math.floor(node.clientHeight) });
    return () => observer.disconnect();
  }, []);

  // Ctrl+scroll zooms (plain scroll keeps scrolling the page). Non-passive so it can preventDefault.
  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      onZoomChangeRef.current(clampWaveformZoom(zoomRef.current * Math.exp(-event.deltaY * 0.0015)));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

  const clampedPosition = Math.max(0, Math.min(durationSec || 0, positionSec));
  // The visible time window: the whole track at zoom 1, otherwise duration/zoom around the
  // playhead (clamped to the track), like Mixxx's zoomed waveform following the play position.
  const windowDur = durationSec > 0 ? durationSec / Math.max(MIN_WAVEFORM_ZOOM, zoom) : 0;
  const maxStart = Math.max(0, durationSec - windowDur);
  const t0 = windowDur <= 0 || windowDur >= durationSec ? 0 : Math.min(Math.max(clampedPosition - windowDur / 2, 0), maxStart);
  const t1 = t0 + windowDur;

  /*
   * One pixel row per strip row; each row takes the loudest bucket under it, so a transient
   * never disappears when the strip is shorter than the bucket count. Depends on the window, so
   * a zoomed-in waveform re-scans only when the window actually moves.
   */
  const rows = useMemo(() => {
    if (!peaks || peaks.length === 0 || size.w <= 0 || size.h <= 0 || windowDur <= 0 || durationSec <= 0) return null;
    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.floor(size.w * ratio));
    const pixelHeight = Math.max(1, Math.floor(size.h * ratio));
    const mid = pixelWidth / 2;
    const lefts = new Float32Array(pixelHeight);
    const widths = new Float32Array(pixelHeight);
    for (let row = 0; row < pixelHeight; row += 1) {
      const time = t0 + ((row + 0.5) / pixelHeight) * windowDur;
      const from = Math.floor((time / durationSec) * peaks.length);
      const to = Math.max(from + 1, Math.ceil(((time + windowDur / pixelHeight) / durationSec) * peaks.length));
      let peak = 0;
      for (let i = from; i < to && i < peaks.length; i += 1) {
        if (peaks[i] > peak) peak = peaks[i];
      }
      // A floor of one pixel keeps silence visible as a thin line, not a gap.
      const half = Math.max(ratio, (peak / 255) * mid * 0.96);
      lefts[row] = mid - half;
      widths[row] = half * 2;
    }
    return { ratio, pixelWidth, pixelHeight, lefts, widths };
  }, [peaks, size.w, size.h, t0, windowDur, durationSec]);

  /*
   * Beat markers across the strip: a line per beat, heavy every fourth (the bar) — Mixxx's beat
   * grid. Where beats would be closer than a few pixels only bars are drawn, and where even bars
   * are that close nothing is — a fence of lines tells a DJ less than a clean waveform does.
   */
  const markers = useMemo(() => {
    if (!grid || !rows || grid.durationSec <= 0 || windowDur <= 0) return null;
    const spacing = 60 / grid.bpm;
    if (!(spacing > 0)) return null;
    const beatPx = (spacing / windowDur) * rows.pixelHeight;
    const minGap = 3 * rows.ratio;
    const stride = beatPx >= minGap ? 1 : 4;
    if (beatPx * stride < minGap) return null;
    const first = Math.ceil((t0 - grid.firstBeatSec) / spacing);
    const last = Math.floor((t1 - grid.firstBeatSec) / spacing);
    const lines: { y: number; bar: boolean }[] = [];
    for (let k = first; k <= last; k += 1) {
      if (k % stride !== 0) continue;
      lines.push({
        y: ((grid.firstBeatSec + k * spacing - t0) / windowDur) * rows.pixelHeight,
        bar: k % 4 === 0,
      });
    }
    return lines;
  }, [grid?.firstBeatSec, grid?.bpm, grid?.durationSec, rows, t0, t1, windowDur]);

  /** Hot cues inside the window, as row positions for the amber edge markers. */
  const cueMarks = useMemo(() => {
    if (!rows || windowDur <= 0) return null;
    const marks: number[] = [];
    for (const cue of cues) {
      if (cue == null || cue < t0 || cue > t1) continue;
      marks.push(((cue - t0) / windowDur) * rows.pixelHeight);
    }
    return marks;
  }, [cues, rows, t0, t1, windowDur]);

  // `getComputedStyle` can force a synchronous style recalculation; the colours only change with
  // the theme, which is one attribute on <html>.
  const colorsRef = useRef<{ key: string; played: string; unplayed: string; line: string } | null>(null);

  const playedRow = rows && windowDur > 0
    ? Math.max(0, Math.min(rows.pixelHeight, Math.round(((clampedPosition - t0) / windowDur) * rows.pixelHeight)))
    : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !rows) return;
    const { ratio, pixelWidth, pixelHeight, lefts, widths } = rows;
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
        played: styles.getPropertyValue("--color-primary").trim() || "#ff0033",
        unplayed: styles.getPropertyValue("--color-muted-foreground").trim() || "#888",
        line: styles.getPropertyValue("--color-foreground").trim() || "#fff",
      };
    }
    const { played, unplayed, line } = colorsRef.current;

    // Time runs top to bottom, so "played" is the rows above the playhead row. Two paths and two
    // fills rather than one fillRect (and one style change) per row.
    ctx.globalAlpha = 1;
    ctx.fillStyle = played;
    ctx.beginPath();
    for (let row = 0; row < playedRow; row += 1) ctx.rect(lefts[row], row, widths[row], 1);
    ctx.fill();

    ctx.globalAlpha = 0.45;
    ctx.fillStyle = unplayed;
    ctx.beginPath();
    for (let row = playedRow; row < pixelHeight; row += 1) ctx.rect(lefts[row], row, widths[row], 1);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Beat grid: thin line per beat, heavy line per bar.
    if (markers) {
      for (const marker of markers) {
        ctx.globalAlpha = marker.bar ? 0.8 : 0.28;
        ctx.fillStyle = line;
        ctx.fillRect(0, Math.floor(marker.y), pixelWidth, Math.max(1, Math.round((marker.bar ? 2 : 1) * ratio * 0.75)));
      }
      ctx.globalAlpha = 1;
    }

    // Hot cues: amber triangles on the left edge.
    if (cueMarks && cueMarks.length > 0) {
      ctx.fillStyle = "#f59e0b";
      for (const y of cueMarks) {
        const yy = Math.floor(y);
        ctx.beginPath();
        ctx.moveTo(0, yy - 3 * ratio);
        ctx.lineTo(5 * ratio, yy);
        ctx.lineTo(0, yy + 3 * ratio);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Playhead: a bright line with a glow so it reads over the played fill.
    if (windowDur > 0) {
      const y = Math.max(0, Math.min(pixelHeight - 1, playedRow));
      ctx.save();
      ctx.shadowColor = played;
      ctx.shadowBlur = 4 * ratio;
      ctx.fillStyle = played;
      ctx.fillRect(0, y, pixelWidth, Math.max(1, Math.round(ratio)));
      ctx.restore();
    }
    // playedRow (not the raw position) is the dependency: redrawing on every clock tick that does
    // not move the playhead by a whole row would be pure waste.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, markers, cueMarks, playedRow, windowDur]);

  const seekFromEvent = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.height <= 0 || durationSec <= 0 || windowDur <= 0) return;
    const time = t0 + Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) * windowDur;
    onSeekFraction(Math.max(0, Math.min(1, time / durationSec)));
  };

  const fraction = durationSec > 0 ? clampedPosition / durationSec : 0;

  return (
    <div
      ref={wrapRef}
      role="slider"
      aria-label="Track position"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fraction * 100)}
      aria-disabled={disabled}
      title={windowDur > 0 && windowDur < durationSec
        ? `Waveform ${formatTime(t0)} – ${formatTime(t1)} · click/drag to seek · Ctrl+scroll to zoom (shared by both decks) · double-click to fit`
        : "Click or drag to seek · Ctrl+scroll to zoom (shared by both decks) · double-click to fit the whole track"}
      className={cn(
        "relative select-none overflow-hidden rounded-xl bg-background/40",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
      )}
      style={{ width: WAVEFORM_WIDTH, height: WAVEFORM_STRIP_HEIGHT, touchAction: "none" }}
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
      onDoubleClick={() => onZoomChange(MIN_WAVEFORM_ZOOM)}
    >
      {status === "ready" ? (
        <canvas ref={canvasRef} className="block size-full" style={{ width: "100%", height: "100%" }} />
      ) : (
        <>
          {/* No peaks to draw: a vertical progress bar, so the position still reads and seeking still works. */}
          <div className="absolute inset-y-0 left-1/2 w-1.5 -translate-x-1/2 rounded-full bg-muted-foreground/25" />
          <div
            className="absolute left-1/2 top-0 w-1.5 -translate-x-1/2 rounded-full bg-primary"
            style={{ height: `${fraction * 100}%` }}
          />
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 bg-background/70 p-1 text-center text-[8px] font-semibold leading-tight text-muted-foreground",
              status === "loading" && "animate-pulse",
            )}
          >
            {status === "loading" && "Analysing…"}
            {status === "unavailable" && "Not ready"}
          </div>
        </>
      )}
    </div>
  );
}

/** Zoom controls under a deck's waveform strip; they drive the one zoom both decks share. */
function WaveformZoomControls({ zoom, onZoomChange }: { zoom: number; onZoomChange: (zoom: number) => void }) {
  return (
    <div className="flex items-center gap-1" title="Waveform zoom — shared by both decks">
      <button type="button" aria-label="Zoom waveform out" disabled={zoom <= MIN_WAVEFORM_ZOOM} onClick={() => onZoomChange(zoom / ZOOM_STEP)} className={ZOOM_BUTTON}>−</button>
      <button
        type="button"
        aria-label="Fit the whole track in the waveform"
        onClick={() => onZoomChange(MIN_WAVEFORM_ZOOM)}
        className={cn(ZOOM_BUTTON, "w-9 tabular-nums")}
      >
        {zoom <= MIN_WAVEFORM_ZOOM ? "FIT" : `×${formatZoom(zoom)}`}
      </button>
      <button type="button" aria-label="Zoom waveform in" disabled={zoom >= MAX_WAVEFORM_ZOOM} onClick={() => onZoomChange(zoom * ZOOM_STEP)} className={ZOOM_BUTTON}>+</button>
    </div>
  );
}

const TEMPO_BUTTON =
  "h-7 rounded-lg bg-muted px-2 text-[10px] font-bold transition-colors hover:bg-primary hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-muted disabled:hover:text-inherit";

/**
 * BPM readout and pitch fader for one deck.
 *
 * The big number is what is *heard*: the track's own BPM scaled by the fader and by Settings'
 * playback speed, because that is what has to match the other deck. The track's own BPM sits
 * underneath it, so it is always clear what the fader is moving away from.
 */
function TempoPanel({ side, view, actions }: { side: "A" | "B"; view: DeckTempoView; actions: DeckTempoActions }) {
  const heard = view.bpm === null ? null : heardBpm(view.bpm, view.percent, view.globalRate);
  const uncertain = view.bpm !== null && !view.overridden && view.confidence < RELIABLE_CONFIDENCE;
  return (
    <div className="mt-3 rounded-xl bg-background/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums">{view.analysing && view.bpm === null ? "…" : formatBpm(heard)}</span>
            <span className="text-[10px] font-bold tracking-widest text-muted-foreground">BPM</span>
            {uncertain && (
              <span
                title="The measurement was not confident — check it by ear, or tap the tempo yourself."
                className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary"
              >
                CHECK
              </span>
            )}
            {view.overridden && (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">SET</span>
            )}
          </div>
          <div className="text-[10px] tabular-nums text-muted-foreground">
            track {formatBpm(view.bpm)} · fader {formatPercent(view.percent)}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button type="button" onClick={actions.onTap} title="Tap along with the beat to set the BPM" className={TEMPO_BUTTON}>TAP</button>
          <button type="button" onClick={actions.onHalve} disabled={view.bpm === null} title="Measured an octave too high: halve it" className={TEMPO_BUTTON}>½</button>
          <button type="button" onClick={actions.onDouble} disabled={view.bpm === null} title="Measured an octave too low: double it" className={TEMPO_BUTTON}>×2</button>
          {view.overridden && (
            <button type="button" onClick={actions.onClearBpm} title="Go back to the measured BPM" className={TEMPO_BUTTON}>↺</button>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="text-[10px] font-bold tracking-widest text-muted-foreground">TEMPO</span>
        <input
          aria-label={`Deck ${side} tempo`}
          type="range"
          min={-view.range}
          max={view.range}
          step={0.1}
          value={view.percent}
          onChange={(event) => actions.onPercent(Number(event.target.value))}
          onDoubleClick={() => actions.onPercent(0)}
          className="min-w-0 flex-1 accent-[var(--color-primary)]"
        />
        <button
          type="button"
          onClick={actions.onSync}
          disabled={!view.canSync}
          title={view.canSync ? "Match this deck's tempo to the other deck's" : "Needs a BPM on both decks"}
          className={TEMPO_BUTTON}
        >
          SYNC
        </button>
        <button type="button" onClick={() => actions.onPercent(0)} title="Back to the track's own tempo" className={TEMPO_BUTTON}>0</button>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {TEMPO_RANGES.map((range) => (
            <button
              key={range}
              type="button"
              onClick={() => actions.onRange(range)}
              className={cn(
                "h-6 rounded-md px-2 text-[9px] font-bold transition-colors",
                view.range === range ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70",
              )}
            >
              ±{range}%
            </button>
          ))}
        </div>
        {view.notice && <span className="min-w-0 truncate text-[10px] text-muted-foreground">{view.notice}</span>}
      </div>
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
  grid,
  zoom,
  onZoomChange,
  tempo,
  tempoActions,
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
  grid: { firstBeatSec: number; bpm: number; durationSec: number } | null;
  /** Waveform zoom shared by both decks (DJMode owns the value). */
  zoom: number;
  onZoomChange: (zoom: number) => void;
  tempo: DeckTempoView;
  tempoActions: DeckTempoActions;
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

      {/*
        Cover art with the deck's vertical waveform beside it — the two decks sit side by side,
        so their waveforms do too. The zoom controls under the strip drive the one zoom value both
        decks share.
      */}
      <div className="mb-4 flex items-center justify-center gap-3">
        <div className="relative grid size-32 shrink-0 place-items-center overflow-hidden rounded-xl bg-muted shadow-lg">
          {track?.artworkUrl ? (
            <TrackArtwork artworkUrl={track.artworkUrl} className="size-full" size={180} iconSize={30} />
          ) : <MusicNoteIcon size={34} className="text-muted-foreground" />}
          <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-white/10" />
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <DeckWaveform
            peaks={peaks}
            status={waveformStatus}
            positionSec={position}
            durationSec={duration}
            disabled={locked || !duration}
            grid={grid}
            cues={hotCues}
            zoom={zoom}
            onZoomChange={onZoomChange}
            onSeekFraction={(fraction) => onSeek(fraction * duration)}
          />
          <WaveformZoomControls zoom={zoom} onZoomChange={onZoomChange} />
        </div>
      </div>

      <div className="mb-3 rounded-xl bg-background/70 p-2">
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

      <TempoPanel side={side} view={tempo} actions={tempoActions} />
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
  onAddLocalFiles,
}: {
  deckAId: string | null;
  deckBId: string | null;
  playing: boolean;
  scrollRef: React.RefObject<HTMLElement | null>;
  onLoadA: (track: Track) => void;
  onLoadB: (track: Track) => void;
  onDragTarget: (target: DragTarget) => void;
  onAddLocalFiles: () => void;
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
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onAddLocalFiles}
            title="Pick audio files from your PC and add them to the queue"
            className="rounded-full bg-primary px-2.5 py-1 text-[9px] font-bold tracking-wider text-primary-foreground transition-colors hover:bg-primary/90"
          >
            + ADD FROM PC
          </button>
          <span className="rounded-full bg-muted px-2 py-1 text-[9px] font-bold text-muted-foreground">
            {queue.length} TRACKS
          </span>
        </div>
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

  // Waveform zoom is one value for both decks — zooming one deck's strip zooms the other's too —
  // and it is remembered across sessions.
  const [waveformZoom, setWaveformZoomState] = useState<number>(readWaveformZoom);
  const setWaveformZoom = useCallback((zoom: number) => {
    const clamped = clampWaveformZoom(zoom);
    setWaveformZoomState(clamped);
    try {
      window.localStorage.setItem(WAVEFORM_ZOOM_KEY, String(clamped));
    } catch {
      // Private mode or a full quota: the zoom just does not outlive the session.
    }
  }, []);

  // --- tempo: one hook owns the analysis, faders, BPM overrides, SYNC and the engine send ------
  const deckA = session.currentTrack;
  const djTempo = useDjTempo({
    playerController,
    deckA,
    deckB,
    deckAPlaying: session.status === "playing",
    deckBPlaying,
    setDeckBStartedAt,
  });
  const waveformA = djTempo.waveformA;
  const waveformB = djTempo.waveformB;
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
  const outputResetRef = useRef({ deckB, deckMixVolumes, playerController, reapplyTempos: djTempo.reapplyTempos });
  outputResetRef.current = { deckB, deckMixVolumes, playerController, reapplyTempos: djTempo.reapplyTempos };
  useEffect(() => {
    const onReset = () => {
      const { deckB: current, deckMixVolumes: volumes, playerController: controller, reapplyTempos } = outputResetRef.current;
      setDeckBPlaying(false);
      setDeckBStartedAt(null);
      if (!current) return;
      void controller.cueTrack(current).then((ready) => {
        if (!ready) return;
        setDeckBDuration(controller.getCuedDuration(current));
        void controller.setDjDeckVolumes(volumes[0], volumes[1]);
        reapplyTempos();
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
      // The faders are a DJ Mode thing: leaving must not leave the player running fast or slow.
      void exitingController.setDjDeckTempos(1, 1);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerController]);

  // Start with a known mixer state whenever DJ/Split Mode mounts.
  useEffect(() => {
    setDeckMixVolumes([1, 0]);
    void playerController.setDjDeckVolumes(1, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerController]);

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
      const elapsed = ((Date.now() - deckBStartedAt) / 1000) * djTempo.deckBRateRef.current;
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
      // A freshly loaded deck starts at its own speed; tell it where the fader is.
      djTempo.reapplyTempos();
    });
  }, [deckB, playerController, djTempo.reapplyTempos]);

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
        setDeckBStartedAt(djTempo.startedAtFor(deckBPosition));
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

  /*
   * The crossfader's levels live here, in `deckMixVolumes`; the engine only knows them because
   * they were sent. A track that starts on Deck A by any other route — the browse pane in Split
   * Mode, the queue list, the media keys, or playback moving on by itself — is loaded at the
   * engine's own full volume, ignoring the crossfader, so it blares over Deck B while the
   * crossfader says otherwise. Then the first pause/play re-sends the real levels and the deck
   * suddenly goes quiet until the crossfader is touched, which reads as Deck A breaking.
   * Re-sending whenever a track starts keeps the engine and the crossfader saying the same
   * thing. Not during a mix: the native fade owns the levels until it finishes.
   */
  useEffect(() => {
    if (isMixing || session.status !== "playing") return;
    void playerController.setDjDeckVolumes(deckMixVolumes[0], deckMixVolumes[1]);
    // Keyed on the track and on playback starting, not on deckMixVolumes: the crossfader and
    // trim handlers already send their own levels, and re-sending on every drag step would
    // just double each one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckA?.id, session.status === "playing"]);

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
      setDeckBStartedAt(djTempo.startedAtFor(deckBPosition));
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
   * "Add music from my PC": the OS file dialog picks audio files (or folders), the Rust scanner
   * reads their tags — the same `local_audio_scan` the local playlists use, which is Mixxx's
   * library-import step — and the resulting local tracks go straight onto the queue this panel
   * shows, ready to load on a deck with A / B or drag there.
   */
  const handleAddLocalFiles = useCallback(async () => {
    const selected = await openDialog({
      title: "Add music from your PC",
      multiple: true,
      directory: false,
      filters: [
        {
          name: "Audio files",
          // Mirrors `is_local_audio_file` on the Rust side.
          extensions: ["mp3", "m4a", "mp4", "aac", "flac", "wav", "ogg", "oga", "opus", "webm"],
        },
      ],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    if (!paths.length) return;
    const tracks = await scanLocalAudioPaths(paths);
    if (!tracks.length) return;
    playerController.addTracksToQueue(tracks);
  }, [playerController]);

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
            grid={djTempo.gridFor(waveformA, djTempo.bpmA)}
            zoom={waveformZoom}
            onZoomChange={setWaveformZoom}
            tempo={djTempo.tempoView("A")}
            tempoActions={djTempo.tempoActions("A")}
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
              if (deckBPlaying) setDeckBStartedAt(djTempo.startedAtFor(time));
            }}
            onSeek={(value) => {
              setDeckBPosition(value);
              if (deckB) {
                void playerController.seekCuedTrack(deckB, value);
                if (deckBPlaying) setDeckBStartedAt(djTempo.startedAtFor(value));
                const [volumeA, volumeB] = deckVolumes(crossfader / 100);
                setDeckMixVolumes([volumeA, volumeB]);
                void playerController.setDjDeckVolumes(volumeA, volumeB);
              }
            }}
            onHotCue={(i) => setCue("B", i)}
            onTrim={(value) => applyTrim("B", value)}
            hotCues={hotCuesB}
            dragState={dragTarget}
            grid={djTempo.gridFor(waveformB, djTempo.bpmB)}
            zoom={waveformZoom}
            onZoomChange={setWaveformZoom}
            tempo={djTempo.tempoView("B")}
            tempoActions={djTempo.tempoActions("B")}
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
            onAddLocalFiles={handleAddLocalFiles}
          />
        </div>
      </div>
    </div>
  );
}
