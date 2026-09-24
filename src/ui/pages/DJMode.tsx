import { useEffect, useMemo, useRef, useState } from "react";
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

function buildWave(seed: string, count = 180) {
  let n = 0;
  for (let i = 0; i < seed.length; i++) n = (n * 31 + seed.charCodeAt(i)) >>> 0;
  return Array.from({ length: count }, (_, i) => {
    n = (1664525 * n + 1013904223) >>> 0;
    const pulse = Math.abs(Math.sin(i * 0.19 + (n % 100) / 30));
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
  hotCues: (number | null)[];
}) {
  const waveform = useMemo(() => buildWave(`${track?.id ?? side}-${side}`), [track?.id, side]);
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
  const [deckB, setDeckB] = useState<Track | null>(session.queue[session.queueIndex + 1] ?? session.queue[0] ?? null);
  const [mixLength, setMixLength] = useState(4000);
  const [crossfader, setCrossfader] = useState(50);
  const [hotCuesA, setHotCuesA] = useState<(number | null)[]>([null, null, null, null]);
  const [hotCuesB, setHotCuesB] = useState<(number | null)[]>([null, null, null, null]);
  const [position, setPosition] = useState(session.positionSec);
  const lastTrackRef = useRef(session.currentTrack?.id);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPosition(playerController.getCurrentTime());
    }, 80);
    return () => window.clearInterval(timer);
  }, [playerController]);

  useEffect(() => {
    if (lastTrackRef.current !== session.currentTrack?.id) {
      lastTrackRef.current = session.currentTrack?.id;
      setPosition(0);
      setHotCuesA([null, null, null, null]);
    }
  }, [session.currentTrack?.id]);

  useEffect(() => {
    if (deckB) void playerController.cueTrack(deckB);
  }, [deckB, playerController]);

  const deckA = session.currentTrack;
  const durationA = deckA?.durationSec ?? playerController.getDuration();
  const durationB = deckB?.durationSec ?? 0;
  const nextTracks = session.queue.filter((track) => track.id !== deckA?.id).slice(0, 12);

  const mix = async () => {
    if (!deckB) return;
    const ok = await playerController.mixToTrack(deckB, mixLength);
    if (ok) {
      const oldA = deckA;
      setPosition(0);
      setDeckB(oldA ?? nextTracks[0] ?? null);
      if (oldA) void playerController.cueTrack(oldA);
    }
  };

  const setCue = (side: "A" | "B", index: number) => {
    const time = side === "A" ? position : 0;
    const setter = side === "A" ? setHotCuesA : setHotCuesB;
    setter((current) => current.map((value, i) => i === index ? (value == null ? time : null) : value));
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-[#0b0b0d] text-foreground">
      <header className="flex shrink-0 items-center justify-between border-b border-white/5 px-5 py-3">
        <div>
          <div className="text-[10px] font-bold tracking-[0.28em] text-primary">ZUNO DJ</div>
          <div className="text-xs text-muted-foreground">Two-deck performance mode</div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-[10px] text-muted-foreground">
            MIX {mixLength / 1000}s
            <input type="range" min={0} max={12000} step={500} value={mixLength} onChange={(e) => setMixLength(Number(e.target.value))} className="w-24 accent-[var(--color-primary)]" />
          </label>
          <button type="button" onClick={onClose} className="rounded-lg bg-white/5 px-3 py-2 text-xs hover:bg-white/10">Exit DJ</button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex-1 rounded-xl bg-white/5 px-4 py-3">
            <div className="text-[10px] font-bold tracking-widest text-muted-foreground">BPM</div>
            <div className="text-xl font-bold">128.0</div>
          </div>
          <button type="button" onClick={mix} disabled={!deckB} className="rounded-xl bg-primary px-6 py-3 text-xs font-black tracking-widest text-primary-foreground disabled:opacity-40">MIX A → B</button>
          <div className="flex-1 rounded-xl bg-white/5 px-4 py-3 text-right">
            <div className="text-[10px] font-bold tracking-widest text-muted-foreground">SYNC</div>
            <div className="text-xl font-bold">ON</div>
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-4 xl:flex-row">
          <Deck side="A" track={deckA} position={position} duration={durationA} playing={session.status === "playing"} onPlay={() => void playerController.play()} onCue={() => void playerController.seekTo(hotCuesA[0] ?? 0)} onSeek={(value) => { setPosition(value); void playerController.seekTo(value); }} onHotCue={(i) => setCue("A", i)} hotCues={hotCuesA} />
          <Deck side="B" track={deckB} position={0} duration={durationB} playing={false} onPlay={mix} onCue={() => { if (deckB) void playerController.cueTrack(deckB); }} onSeek={() => {}} onHotCue={(i) => setCue("B", i)} hotCues={hotCuesB} />
        </div>

        <div className="mt-4 rounded-2xl bg-card/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-xs font-bold tracking-widest">MIXER</div>
            <div className="text-[10px] text-muted-foreground">Crossfader</div>
          </div>
          <input aria-label="Crossfader" type="range" min={0} max={100} value={crossfader} onChange={(e) => setCrossfader(Number(e.target.value))} className="w-full accent-[var(--color-primary)]" />
          <div className="mt-1 flex justify-between text-[9px] font-bold text-muted-foreground"><span>DECK A</span><span>{crossfader}%</span><span>DECK B</span></div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {[["LOW", "A"], ["MID", "A"], ["HIGH", "A"]].map(([label, side]) => <div key={label + side} className="rounded-xl bg-background/60 p-3"><div className="mb-2 text-[9px] font-bold text-muted-foreground">{side} {label}</div><input type="range" min={-12} max={12} defaultValue={0} className="w-full accent-[var(--color-primary)]" /></div>)}
          </div>
        </div>

        <div className="mt-4 rounded-2xl bg-card/60 p-4">
          <div className="mb-3 text-xs font-bold tracking-widest">DECK B — QUEUE</div>
          <div className="grid gap-1">
            {nextTracks.map((track) => (
              <button key={track.id} type="button" onClick={() => setDeckB(track)} className={cn("flex items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-white/5", deckB?.id === track.id && "bg-primary/10") }>
                <TrackArtwork artworkUrl={track.artworkUrl} className="size-9 rounded-lg" size={48} iconSize={15} />
                <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{track.title}</span><span className="block truncate text-[10px] text-muted-foreground">{track.artist}</span></span>
                <SkipNextIcon size={14} className="text-muted-foreground" />
              </button>
            ))}
            {!nextTracks.length && <div className="py-6 text-center text-xs text-muted-foreground">Add more tracks to the queue to populate Deck B.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
