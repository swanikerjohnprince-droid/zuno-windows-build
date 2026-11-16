import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { PauseIcon, PlayIcon, SkipIcon } from "./icons";
import { cn } from "./ui";

/**
 * The app's mini player, on the page.
 *
 * A copy of `src/ui/components/mini-player/MiniPlayer.tsx` in shape and materials — same capsule,
 * same collapsed/expanded geometry, same progress ring around a spinning record, same glass. The
 * app's version exists to control a window: it drags, it hit-tests the cursor against the OS, it
 * resizes its own Tauri window to match the capsule. None of that has a meaning in a browser, so
 * what is left is the part a visitor can see — hover expands it, and the buttons drive an
 * `<audio>` element instead of an IPC bus.
 *
 * Expansion is CSS rather than state: the capsule is the hover target and every animated property
 * is a class on it, so nothing here re-renders on mouse-over.
 */

/* The demo track. One object, so swapping the song is one edit. */
const TRACK = {
  src: "./low-tide.mp3",
  title: "Low Tide",
  artist: "Tom Rhodes",
  /** The Zuno character loop stands in for cover art; the still tints the glass behind it. */
  avatar: "./zuno-character.mp4",
  artwork: "./logo.png",
};

/** Matching the app's capsule: 44px collapsed, 96px expanded. */
const COLLAPSED_HEIGHT = 44;
const PROGRESS_RING_WIDTH = 2;

/** Where it parks before anyone moves it: clear of the header, in from the left edge. */
const HOME = { x: 24, y: 88 };

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

const MINI_BUTTON =
  "flex size-7 shrink-0 items-center justify-center rounded-full text-neutral-300 transition-all " +
  "hover:bg-white/10 hover:text-white active:scale-90 disabled:opacity-40 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50";

export function MiniPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(HOME);
  const [dragging, setDragging] = useState(false);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  };

  const seek = (seconds: number) => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = seconds;
  };

  /* The element is the source of truth for `playing`: pausing can come from the OS media keys or
     from another tab taking the audio focus, neither of which goes through the button. */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const sync = () => setPlaying(!audio.paused);
    audio.addEventListener("play", sync);
    audio.addEventListener("pause", sync);

    return () => {
      audio.removeEventListener("play", sync);
      audio.removeEventListener("pause", sync);
    };
  }, []);

  /*
   * Drag, the browser's version.
   *
   * The app moves an OS window; here the capsule moves itself. Pointer capture is what makes the
   * grab survive the cursor outrunning the element, which it will — the capsule is small and the
   * pointer is not obliged to stay inside it.
   */
  const grabRef = useRef<{ x: number; y: number } | null>(null);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    // Buttons and the slider own their own presses; only the bare capsule is a handle.
    if (event.target instanceof Element && event.target.closest("button, input")) return;

    const box = event.currentTarget.getBoundingClientRect();
    grabRef.current = { x: event.clientX - box.left, y: event.clientY - box.top };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onDrag = (event: PointerEvent<HTMLDivElement>) => {
    const grab = grabRef.current;
    if (!grab) return;

    // Clamped so it can never be parked off-screen, where nothing would bring it back.
    const box = event.currentTarget.getBoundingClientRect();
    setPosition({
      x: clamp(event.clientX - grab.x, 8, window.innerWidth - box.width - 8),
      y: clamp(event.clientY - grab.y, 8, window.innerHeight - box.height - 8),
    });
  };

  const endDrag = () => {
    grabRef.current = null;
    setDragging(false);
  };

  const progress = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;

  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      {/*
        Silent until the play button is pressed.

        It used to autoplay, and fall back to starting on the first pointerdown or keydown
        anywhere on the document when the browser refused — so a visitor clicking a download
        link got music they never asked for, from a control they may not have noticed. `metadata`
        rather than `auto` for the same reason: nothing is fetched beyond the duration the
        progress ring needs until someone actually wants to hear it.
      */}
      <audio
        ref={audioRef}
        src={TRACK.src}
        preload="metadata"
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
      />

      {/*
        One capsule that morphs, rather than two stacked pills. Width and height are the animated
        properties, so the transport row is revealed by the container growing around it rather
        than by a second element appearing.
      */}
      <div
        className={cn(
          "group pointer-events-auto absolute flex h-11 w-40 flex-col overflow-hidden p-0",
          dragging ? "cursor-grabbing select-none" : "cursor-grab",
          "bg-neutral-900/80 ring-1 ring-white/10 backdrop-blur-xl",
          "transition-[height,width,padding,background-color] duration-200",
          "[transition-timing-function:cubic-bezier(0.32,0.72,0,1)]",
          /* h-11 → h-24 and w-40 → 260px are the app's 44/96 and 160/260, to the pixel. */
          "hover:h-24 hover:w-[260px] hover:p-1.5 hover:bg-neutral-900/95 hover:ring-white/15",
          "focus-within:h-24 focus-within:w-[260px] focus-within:p-1.5 focus-within:bg-neutral-900/95",
        )}
        /* Half the collapsed height: a true stadium collapsed, a squircle expanded. */
        style={{ left: position.x, top: position.y, borderRadius: COLLAPSED_HEIGHT / 2 }}
        onPointerDown={startDrag}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* Album-reactive backdrop: the artwork blown up and blurred past recognition, tinting
            the glass with the record's own palette. No extra request, no colour extraction. */}
        <span
          className="pointer-events-none absolute inset-0 -z-10 scale-150 bg-cover bg-center opacity-30 blur-2xl"
          style={{ backgroundImage: `url("${TRACK.artwork}")` }}
          aria-hidden="true"
        />

        {/* Specular top edge — the highlight a real glass material catches. */}
        <span
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent"
          aria-hidden="true"
        />

        {/* ── Identity row: always visible ─────────────────────────────── */}
        <div
          className="flex h-11 shrink-0 items-center gap-2 pl-1.5 pr-2 transition-[padding] duration-300 group-hover:pr-3"
        >
          <button
            type="button"
            onClick={toggle}
            className="group/art relative grid size-11 shrink-0 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            aria-label={playing ? "Pause" : "Play"}
          >
            {/* Position, drawn as a ring rather than a bar — the collapsed pill has no width to
                spend on one. The conic gradient fills the disc; a radial mask cuts the centre
                out, so thickness is one constant instead of a gap between two elements. */}
            <span
              className="absolute inset-0 rounded-full"
              style={{
                background: `conic-gradient(rgba(255,255,255,0.92) ${progress}%, rgba(255,255,255,0.16) 0)`,
                maskImage: `radial-gradient(closest-side, transparent calc(100% - ${PROGRESS_RING_WIDTH}px), #000 calc(100% - ${PROGRESS_RING_WIDTH}px))`,
                WebkitMaskImage: `radial-gradient(closest-side, transparent calc(100% - ${PROGRESS_RING_WIDTH}px), #000 calc(100% - ${PROGRESS_RING_WIDTH}px))`,
              }}
              aria-hidden="true"
            />
            {/* The character loop rather than a sleeve. It carries its own motion, so the app's
                record spin is left off — two rotations at once reads as a glitch. */}
            <video
              src={TRACK.avatar}
              className="relative size-[34px] shrink-0 rounded-full bg-neutral-800 object-cover transition-transform duration-300 group-hover/art:scale-90"
              autoPlay
              muted
              loop
              playsInline
              aria-hidden="true"
            />
          </button>

          {/* Takes whatever the chrome leaves. `min-w-0` is what lets it actually shrink. */}
          <div className="min-w-0 flex-1 overflow-hidden">
            <span className="block truncate text-[12px] font-semibold leading-tight tracking-[-0.01em] text-white">
              {TRACK.title}
            </span>
            <p className="truncate text-[10px] leading-tight text-white/55">{TRACK.artist}</p>
          </div>
        </div>

        {/* ── Control row ───────────────────────────────────────────────
            Collapsed it is clamped to zero width so it cannot hold the capsule open past the
            collapsed cap; expanding releases it and the capsule grows to fit. */}
        <div
          className={cn(
            "pointer-events-none flex h-10 w-0 items-center gap-2 overflow-hidden px-0 opacity-0",
            "transition-[opacity,width,padding] duration-300",
            "group-hover:pointer-events-auto group-hover:w-auto group-hover:px-3 group-hover:opacity-100 group-hover:delay-75",
          )}
        >
          <div className="flex shrink-0 items-center gap-0.5">
            {/* One track, so "previous" is a restart and "next" has nowhere to go. */}
            <button
              type="button"
              className={MINI_BUTTON}
              onClick={() => seek(0)}
              aria-label="Restart"
            >
              <SkipIcon back size={15} />
            </button>
            <button
              type="button"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white text-neutral-900 transition-transform duration-150 hover:scale-105 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              onClick={toggle}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <PauseIcon size={15} /> : <PlayIcon size={15} />}
            </button>
            <button type="button" className={MINI_BUTTON} disabled aria-label="Next">
              <SkipIcon size={15} />
            </button>
          </div>

          <input
            type="range"
            min={0}
            max={duration || 100}
            step="any"
            value={time}
            onChange={(event) => seek(Number(event.currentTarget.value))}
            aria-label="Song position"
            className="h-1 min-w-24 flex-1 cursor-pointer appearance-none rounded-full bg-transparent [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,#fff_var(--slider-progress),rgba(255,255,255,0.18)_var(--slider-progress))] [&::-webkit-slider-thumb]:-mt-[3px] [&::-webkit-slider-thumb]:size-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:transition-transform hover:[&::-webkit-slider-thumb]:scale-125"
            style={{ "--slider-progress": `${progress}%` } as CSSProperties}
          />
        </div>
      </div>
    </div>
  );
}
