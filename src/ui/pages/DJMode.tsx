import { useEffect, useMemo, useState } from "react";
import type { Track } from "../../datasource/types";
import type { PlayerControllerActions } from "../../player/playerStore";
import type { PlayerSession } from "../../player/PlayerController";
import { TrackArtwork } from "../components/TrackArtwork";
import { cn } from "@/lib/utils";
import { PlayIcon, PauseIcon, SkipNextIcon, MusicNoteIcon } from "@/ui/icons";

interface DJModeProps {
  session: PlayerSession;
  playerController: PlayerControllerActions;
  onClose: () => void;
}

function formatTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function buildWave(seed: string, count = 180, phase = 0) {
  let n = 0;
  for (let i = 0; i < seed.length; i++) n = (n * 31 + seed.charCodeAt(i)) >>> 0;
  return Array.from({ length: count }, (_, i) => {
    n = (1664525 * n + 1013904223) >>> 0;
    const pulse = Math.abs(Math.sin(i * 0.19 + (n % 100) / 30 + phase));
    return 0.18 + ((n % 100) / 100) * 0.48 + pulse * 0.28;
  });
}

function Deck({
  side,
  track,
  position,
  duration,
  playing,
  onPlay,
  onCue,
  onSeek,
  onHotCue,
  onLoad,
  hotCues,
}: {
  side: "A" | "B";
  track: Track | null;
  position: number;
  duration: number;
  playing: boolean;
  onPlay: () => void;
  onCue: () => void;
  onSeek: (value: number) => void;
  onHotCue: (index: number) => void;
  onLoad: () => void;
  hotCues: (number | null)[];
}) {
  const waveform = useMemo(
    () => buildWave(`${track?.id ?? side}-${side}`, 180, playing ? position * 3.2 : 0),
    [track?.id, side, playing, Math.floor(position * 10)],
  );
  const pct = duration ? Math.min(100, (position / duration) * 100) : 0;

  return (
    <section className="min-w-0 flex-1 rounded-2xl bg-card/80 p-4 shadow-2xl shadow-black/20">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-[10px] font-bold tracking-[0.22em] text-primary">DECK {side}</div>
          <div className="mt-1 truncate text-lg font-semibold">{track?.title ?? "Load a track"}</div>
          <div className="truncate text-xs text-muted-foreground">{track?.artist ?? "Choose a song from the library"}</div>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-semibold text-muted-foreground">
          <button type="button" onClick={onLoad} className="rounded-lg bg-primary/15 px-2 py-1 font-bold text-primary hover:bg-primary/25">
            LOAD
          </button>
          <span className="rounded-full bg-muted px-2 py-1">128 BPM</span>
          <span className="rounded-full bg-muted px-2 py-1">8A</span>
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
        <div className="relative flex h-20 items-center gap-[2px] overflow-hidden">
          {waveform.map((height, index) => (
            <div
              key={index}
              className={cn("w-1 shrink-0 rounded-full transition-opacity", index / waveform.length < pct / 100 ? "bg-primary" : "bg-muted-foreground/40")}
              style={{ height: `${Math.max(8, height * 100)}%` }}
            />
          ))}
          <div className="pointer-events-none absolute inset-y-0 w-px bg-foreground" style={{ left: `${pct}%` }} />
        </div>
        <input
          aria-label={`Deck ${side} position`}
          type="range"
          min={0}
          max={Math.max(0.01, duration)}
          step={0.01}
          value={Math.min(position, duration || 0)}
          onChange={(event) => onSeek(Number(event.target.value))}
          className="mt-2 w-full accent-[var(--color-primary)]"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>{formatTime(position)}</span><span>{formatTime(duration)}</span>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <button type="button" onClick={onCue} className="h-10 rounded-xl bg-muted text-xs font-bold hover:bg-muted/80">CUE</button>
        <button type="button" onClick={onPlay} className="grid size-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/20">
          {playing ? <PauseIcon size={19} /> : <PlayIcon size={19} />}
        </button>
        <div className="grid grid-cols-4 gap-1">
          {hotCues.map((cue, index) => (
            <button key={index} type="button" onClick={() => onHotCue(index)} className={cn("h-10 rounded-lg text-[10px] font-bold", cue == null ? "bg-muted text-muted-foreground" : "bg-primary/20 text-primary")}>
              {cue == null ? `C${index + 1}` : formatTime(cue)}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

export function DJMode({ session, playerController, onClose }: DJModeProps) {
  const [deckB, setDeckB] = useState<Track | null>(
    session.queue[session.queueIndex + 1] ?? session.queue.find((track) => track.id !== session.currentTrack?.id) ?? null,
  );
  const [crossfader, setCrossfader] = useState(0);
  const [deckBPlaying, setDeckBPlaying] = useState(false);
  const [deckBDuration, setDeckBDuration] = useState(0);
  const [deckBPosition, setDeckBPosition] = useState(0);
  const [deckBStartedAt, setDeckBStartedAt] = useState<number | null>(null);
  const [deckAPosition, setDeckAPosition] = useState(0);
  const [hotCuesA, setHotCuesA] = useState<(number | null)[]>([null, null, null, null]);
  const [hotCuesB, setHotCuesB] = useState<(number | null)[]>([null, null, null, null]);
  const [showDeckPicker, setShowDeckPicker] = useState<"A" | "B" | null>(null);

  const deckA = session.currentTrack;
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
    const timer = window.setInterval(tick, 50);
    return () => window.clearInterval(timer);
  }, [session.status, session.positionSec, playerController, deckA?.id]);

  // Keep Deck A tied to the real player session. This is deliberately derived from session
  // rather than copied into local state, so loading a song anywhere in Zuno immediately updates
  // the DJ deck.
  useEffect(() => {
    if (!deckB || deckB.id === deckA?.id) {
      const replacement = session.queue.find((track) => track.id !== deckA?.id) ?? null;
      setDeckB(replacement);
      setDeckBPlaying(false);
      setDeckBDuration(0);
      setDeckBPosition(0);
      setDeckBStartedAt(null);
    }
  }, [deckA?.id, session.queue, deckB]);

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
    }, 80);
    return () => window.clearInterval(timer);
  }, [deckBPlaying, deckBStartedAt, durationB]);

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

  const applyCrossfader = (value: number) => {
    const normalized = Math.max(0, Math.min(100, value)) / 100;
    setCrossfader(value);
    // Equal-power curve: the middle keeps both decks present instead of creating a volume dip.
    const angle = normalized * Math.PI / 2;
    void playerController.setDjDeckVolumes(
      Math.cos(angle),
      Math.sin(angle),
    );

    // Like a professional DJ app, moving toward a silent prepared deck can start that deck.
    if (deckB && normalized > 0 && !deckBPlaying) {
      void playerController.playCuedTrack(deckB, Math.sin(angle)).then((started) => {
        if (!started) return;
        setDeckBPlaying(true);
        setDeckBStartedAt(Date.now());
      });
    }
  };

  const playA = async () => {
    if (session.status === "playing") {
      await playerController.pause();
      return;
    }
    await playerController.play();
    void playerController.setDjDeckVolumes(
      Math.cos((crossfader / 100) * Math.PI / 2),
      Math.sin((crossfader / 100) * Math.PI / 2),
    );
  };

  const playB = async () => {
    if (!deckB) return;
    if (deckBPlaying) {
      const paused = await playerController.pauseCuedTrack(deckB);
      if (paused) {
        setDeckBPlaying(false);
        setDeckBStartedAt(null);
      }
      return;
    }
    const normalized = crossfader / 100;
    const started = await playerController.playCuedTrack(deckB, Math.sin(normalized * Math.PI / 2));
    if (started) {
      setDeckBPlaying(true);
      setDeckBStartedAt(Date.now() - deckBPosition * 1000);
    }
  };

  const setCue = (side: "A" | "B", index: number) => {
    const time = side === "A" ? session.positionSec : deckBPosition;
    const setter = side === "A" ? setHotCuesA : setHotCuesB;
    setter((current) => current.map((value, i) => i === index ? (value == null ? time : null) : value));
  };

  const selectDeckB = (track: Track) => {
    setDeckB(track);
    setCrossfader(100);
    void playerController.setDjDeckVolumes(1, 0);
  };

  const nextTracks = session.queue.filter((track) => track.id !== deckA?.id);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-[#0b0b0d] text-foreground">
      <header className="flex shrink-0 items-center justify-between border-b border-white/5 px-5 py-3">
        <div>
          <div className="text-[10px] font-bold tracking-[0.28em] text-primary">ZUNO DJ</div>
          <div className="text-xs text-muted-foreground">Two-deck performance mode</div>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg bg-white/5 px-3 py-2 text-xs hover:bg-white/10">Exit DJ</button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex-1 rounded-xl bg-white/5 px-4 py-3">
            <div className="text-[10px] font-bold tracking-widest text-muted-foreground">DECK A</div>
            <div className="truncate text-sm font-bold">{deckA?.title ?? "No track playing"}</div>
          </div>
          <div className="rounded-xl bg-white/5 px-4 py-3 text-center">
            <div className="text-[10px] font-bold tracking-widest text-muted-foreground">CROSSFADER</div>
            <div className="text-xl font-bold">{Math.round(crossfader)}%</div>
          </div>
          <div className="flex-1 rounded-xl bg-white/5 px-4 py-3 text-right">
            <div className="text-[10px] font-bold tracking-widest text-muted-foreground">DECK B</div>
            <div className="truncate text-sm font-bold">{deckB?.title ?? "Load a track"}</div>
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-4 xl:flex-row">
          <Deck
            side="A"
            track={deckA}
            position={deckAPosition}
            duration={durationA}
            playing={session.status === "playing"}
            onPlay={() => void playA()}
            onCue={() => void playerController.seekTo(hotCuesA[0] ?? 0)}
            onSeek={(value) => void playerController.seekTo(value)}
            onHotCue={(i) => setCue("A", i)}
            onLoad={() => setShowDeckPicker("A")}
            hotCues={hotCuesA}
          />
          <Deck
            side="B"
            track={deckB}
            position={deckBPosition}
            duration={durationB}
            playing={deckBPlaying}
            onPlay={() => void playB()}
            onCue={() => {
              if (deckB) void playerController.cueTrack(deckB);
            }}
            onSeek={(value) => {
              setDeckBPosition(value);
              if (deckB) {
                void playerController.seekCuedTrack(deckB, value);
                if (deckBPlaying) setDeckBStartedAt(Date.now() - value * 1000);
                void playerController.setDjDeckVolumes(
                  Math.cos((crossfader / 100) * Math.PI / 2),
                  Math.sin((crossfader / 100) * Math.PI / 2),
                );
              }
            }}
            onHotCue={(i) => setCue("B", i)}
            onLoad={() => setShowDeckPicker("B")}
            hotCues={hotCuesB}
          />
        </div>

        <div className="mt-4 rounded-2xl bg-card/60 p-5">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-bold tracking-widest">MIXER</div>
            <div className="text-[10px] text-muted-foreground">A ← Crossfader → B</div>
          </div>
          <input
            aria-label="Crossfader"
            type="range"
            min={0}
            max={100}
            value={crossfader}
            onChange={(event) => applyCrossfader(Number(event.target.value))}
            className="w-full accent-[var(--color-primary)]"
          />
          <div className="mt-1 flex justify-between text-[9px] font-bold text-muted-foreground">
            <span>DECK A</span><span>CENTER MIX</span><span>DECK B</span>
          </div>
          <p className="mt-3 text-[10px] text-muted-foreground">
            Both decks can play at the same time. Move the crossfader left/right to blend or switch between them.
          </p>
        </div>

        <div className="mt-4 rounded-2xl bg-card/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-xs font-bold tracking-widest">DECK A QUEUE</div>
              <div className="text-[10px] text-muted-foreground">Your main Zuno queue stays here while DJ Mode is open.</div>
            </div>
            <span className="rounded-full bg-muted px-2 py-1 text-[9px] font-bold text-muted-foreground">{session.queue.length} TRACKS</span>
          </div>
          <div className="max-h-56 overflow-auto pr-1">
            {session.queue.map((track, index) => (
              <button key={track.id} type="button"
                onClick={() => { void playerController.loadTrack(track, true); setDeckAPosition(0); }}
                className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-white/5", deckA?.id === track.id && "bg-primary/10 ring-1 ring-primary/20")}
              >
                <span className="w-5 text-center text-[10px] font-bold text-muted-foreground">{index + 1}</span>
                <TrackArtwork artworkUrl={track.artworkUrl} className="size-9 rounded-lg" size={48} iconSize={15} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{track.title}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">{track.artist}</span>
                </span>
                <span className="text-[9px] font-bold text-muted-foreground">{deckA?.id === track.id ? "PLAYING" : "LOAD"}</span>
              </button>
            ))}
            {!session.queue.length && <div className="py-6 text-center text-xs text-muted-foreground">Add tracks to the main Zuno queue.</div>}
          </div>
        </div>
        {showDeckPicker && (
          <div className="mt-4 rounded-2xl bg-card/60 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold tracking-widest">LOAD ON DECK {showDeckPicker}</div>
                <div className="text-[10px] text-muted-foreground">
                  {showDeckPicker === "A" ? "Load a track as the active deck" : "Choose a track to prepare"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDeckPicker(null)}
                className="rounded-lg bg-white/5 px-3 py-1 text-[10px] hover:bg-white/10"
              >
                CLOSE
              </button>
            </div>
            <div className="grid gap-1">
              {session.queue.map((track) => (
                <button
                  key={track.id}
                  type="button"
                  onClick={() => {
                    if (showDeckPicker === "A") {
                      void playerController.loadTrack(track, true);
                      setDeckAPosition(0);
                    } else {
                      selectDeckB(track);
                    }
                    setShowDeckPicker(null);
                  }}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-white/5",
                    ((showDeckPicker === "A" ? deckA?.id : deckB?.id) === track.id) && "bg-primary/10",
                  )}
                >
                  <TrackArtwork artworkUrl={track.artworkUrl} className="size-9 rounded-lg" size={48} iconSize={15} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{track.title}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">{track.artist}</span>
                  </span>
                  <span className="text-[9px] font-bold text-muted-foreground">
                    {showDeckPicker === "A" && deckA?.id === track.id ? "ACTIVE" : showDeckPicker === "B" && deckB?.id === track.id ? "CUED" : "LOAD"}
                  </span>
                </button>
              ))}
              {!session.queue.length && (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  Add tracks to the main Zuno queue first.
                </div>
              )}
            </div>
          </div>
        )}

        <div className="mt-4 rounded-2xl bg-card/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-xs font-bold tracking-widest">DECK B QUICK LOAD</div>
            <div className="text-[10px] text-muted-foreground">Choose a track to prepare</div>
          </div>
          <div className="grid gap-1">
            {nextTracks.map((track) => (
              <button
                key={track.id}
                type="button"
                onClick={() => selectDeckB(track)}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-white/5",
                  deckB?.id === track.id && "bg-primary/10",
                )}
              >
                <TrackArtwork artworkUrl={track.artworkUrl} className="size-9 rounded-lg" size={48} iconSize={15} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{track.title}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">{track.artist}</span>
                </span>
                <SkipNextIcon size={14} className="text-muted-foreground" />
              </button>
            ))}
            {!nextTracks.length && (
              <div className="py-6 text-center text-xs text-muted-foreground">Add more tracks to the queue to populate Deck B.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}