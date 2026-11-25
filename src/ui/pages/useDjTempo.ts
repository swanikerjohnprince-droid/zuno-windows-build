/**
 * DJ Mode's whole tempo system, owned by one hook (`useDjTempo`) instead of being spread across
 * the page component: the per-track analysis (waveform + BPM from Rust's single decode of the
 * track, cached by the controller), the per-track faders, the hand-set BPM overrides, SYNC /
 * tap / ½ / ×2, and the one path that tells the engine where the faders are.
 *
 * The design follows Mixxx's analyzer (src/analyzer/, GPL-2.0): a track is analysed once and the
 * result is stored and reused; the beat grid is drawn from the stored first-beat anchor at the
 * BPM currently in use; and SYNC moves your own fader until your heard BPM matches the other
 * deck's heard BPM (at ×1, ×2 or ×½, whichever needs the smallest move).
 */
import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { Track } from "../../datasource/types";
import { logInternalError } from "../../internal/logging";
import type { PlayerControllerActions } from "../../player/playerStore";
import type { TrackAnalysis } from "../../player/rustAudio";
import {
  DEFAULT_KEYLOCK,
  DEFAULT_TEMPO_RANGE,
  KEYLOCK_STORAGE_KEY,
  TEMPO_RANGES,
  clampPercent,
  doubleBpm,
  formatPercent,
  halveBpm,
  heardBpm,
  parseBpmOverrides,
  parseKeylock,
  registerTap,
  resolveBpm,
  serializeBpmOverrides,
  serializeKeylock,
  syncPercent,
  tempoRatio,
  type TempoRange,
} from "./djTempo";

/** Peaks requested per track: enough for a crisp full-width overview at 2x pixel density. */
export const WAVEFORM_BUCKETS = 1024;
export const BPM_OVERRIDES_KEY = "zuno.dj.bpmOverrides";

export type WaveformStatus = "empty" | "loading" | "ready" | "unavailable";

export interface DeckAnalysis {
  id: string | null;
  status: WaveformStatus;
  peaks: Uint8Array | null;
  bpm: number | null;
  bpmConfidence: number;
  firstBeatSec: number;
  durationSec: number;
}

const NOTHING_MEASURED = { peaks: null, bpm: null, bpmConfidence: 0, firstBeatSec: 0, durationSec: 0 };

/**
 * Waveform and tempo for a deck's track, from the one decode Rust does of it, cached by the
 * controller. Streaming tracks are analysed from the buffer their own playback is filling, so they
 * only have an analysis once they are actually loaded onto a deck — `retryKey` is how a deck says
 * "that has changed, ask again" (Deck A flips it when playback starts; Deck B when it is played).
 * A track with nothing to give is shown as having none, never as a generated stand-in: a made-up
 * waveform or BPM is worse than none, because a DJ beat-matches off them.
 */
function useTrackAnalysis(playerController: PlayerControllerActions, track: Track | null, retryKey: boolean): DeckAnalysis {
  const [result, setResult] = useState<DeckAnalysis>({ id: null, status: "empty", ...NOTHING_MEASURED });
  const resultRef = useRef(result);
  resultRef.current = result;
  const trackId = track?.id ?? null;

  useEffect(() => {
    if (!track) {
      setResult({ id: null, status: "empty", ...NOTHING_MEASURED });
      return;
    }
    // Already measured for this track: a retry signal must not blank a working waveform.
    if (resultRef.current.id === track.id && resultRef.current.status === "ready") return;
    let cancelled = false;
    setResult({ id: track.id, status: "loading", ...NOTHING_MEASURED });
    void playerController.getTrackAnalysis(track, WAVEFORM_BUCKETS).then((analysis: TrackAnalysis | null) => {
      if (cancelled) return;
      setResult(
        analysis
          ? {
              id: track.id,
              status: "ready",
              peaks: analysis.peaks,
              bpm: analysis.bpm,
              bpmConfidence: analysis.bpmConfidence,
              firstBeatSec: analysis.firstBeatSec,
              durationSec: analysis.durationSec,
            }
          : { id: track.id, status: "unavailable", ...NOTHING_MEASURED },
      );
    });
    return () => {
      cancelled = true;
    };
    // Keyed on the id: a new Track object for the same song must not trigger a second decode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, retryKey, playerController]);

  // A result for the previous track must never draw under the new one for even one frame.
  return result.id === trackId
    ? result
    : { id: trackId, status: trackId ? "loading" : "empty", ...NOTHING_MEASURED };
}

/** Everything a deck's tempo panel shows, worked out by `useDjTempo` so the panel is just a view. */
export interface DeckTempoView {
  /** The track's own BPM: the one set by hand if there is one, otherwise the measured one. */
  bpm: number | null;
  confidence: number;
  /** Still being measured. */
  analysing: boolean;
  overridden: boolean;
  /** Fader position, as a percent. */
  percent: number;
  range: TempoRange;
  /** Settings' playback speed, which multiplies with the fader. */
  globalRate: number;
  canSync: boolean;
  /** Keylock: the fader time-stretches instead of changing pitch. */
  keylock: boolean;
  notice: string | null;
}

export interface DeckTempoActions {
  onPercent: (percent: number) => void;
  onRange: (range: TempoRange) => void;
  onSync: () => void;
  onKeylock: () => void;
  onTap: () => void;
  onHalve: () => void;
  onDouble: () => void;
  onClearBpm: () => void;
}

/** The beat grid drawn on a deck's waveform: anchor from the measurement, spacing from the BPM in use. */
export interface DeckGrid {
  firstBeatSec: number;
  bpm: number;
  durationSec: number;
}

export interface DjTempo {
  waveformA: DeckAnalysis;
  waveformB: DeckAnalysis;
  /** Each deck's track BPM: the hand-set one if there is one, otherwise the measured one. */
  bpmA: number | null;
  bpmB: number | null;
  /** What is actually heard on each deck: track BPM × global rate × fader. */
  heardA: number | null;
  heardB: number | null;
  /**
   * How fast Deck B's playhead advances, in track seconds per wall second, as a ref: Deck B has
   * no position events from Rust, only a local clock, so the clock has to read the deck's real
   * speed or it drifts away from the audio the moment the tempo is not 1.
   */
  deckBRateRef: RefObject<number>;
  tempoView: (side: "A" | "B") => DeckTempoView;
  tempoActions: (side: "A" | "B") => DeckTempoActions;
  gridFor: (analysis: DeckAnalysis, inUse: number | null) => DeckGrid | null;
  /** Wall-clock time at which Deck B started playing, given the position it started at. */
  startedAtFor: (position: number) => number;
  /**
   * The one path that sends the faders to the engine. The effect below sends on every state change
   * that matters; this is for the loads that finish asynchronously (cueTrack, output device reset),
   * because the engine resets a deck's tempo to 1 when a track lands on it.
   */
  reapplyTempos: () => void;
}

export function useDjTempo({
  playerController,
  deckA,
  deckB,
  deckAPlaying,
  deckBPlaying,
  setDeckBStartedAt,
}: {
  playerController: PlayerControllerActions;
  deckA: Track | null;
  deckB: Track | null;
  deckAPlaying: boolean;
  deckBPlaying: boolean;
  setDeckBStartedAt: Dispatch<SetStateAction<number | null>>;
}): DjTempo {
  const waveformA = useTrackAnalysis(playerController, deckA, deckAPlaying);
  const waveformB = useTrackAnalysis(playerController, deckB, deckBPlaying);

  const [tempoRange, setTempoRange] = useState<TempoRange>(DEFAULT_TEMPO_RANGE);
  // Fader position per *track*, not per deck: a mix promotes Deck B to Deck A, and the track
  // keeps the tempo it was beat-matched at without anything having to be carried across.
  const [tempoByTrack, setTempoByTrack] = useState<Record<string, number>>({});
  // BPMs set by hand (tap, half, double), remembered across sessions. The measurement is always
  // re-done and never overwritten by these: clearing one goes back to what was measured.
  const [bpmOverrides, setBpmOverrides] = useState<Record<string, number>>(() => {
    try {
      return parseBpmOverrides(window.localStorage.getItem(BPM_OVERRIDES_KEY));
    } catch {
      return {};
    }
  });
  const [tempoNotice, setTempoNotice] = useState<{ A: string | null; B: string | null }>({ A: null, B: null });
  // Keylock per deck, remembered across sessions: with it on, the fader time-stretches and the
  // pitch stays put (Mixxx's keylock, on by default there too).
  const [keylock, setKeylock] = useState<[boolean, boolean]>(() => {
    try {
      return parseKeylock(window.localStorage.getItem(KEYLOCK_STORAGE_KEY));
    } catch {
      return [...DEFAULT_KEYLOCK];
    }
  });
  const tapsRef = useRef<{ A: number[]; B: number[] }>({ A: [], B: [] });
  const noticeTimers = useRef<{ A?: number; B?: number }>({});
  /** What the engine has last been told, readable from callbacks that outlive a render. */
  const temposRef = useRef<[number, number]>([1, 1]);
  const keylockRef = useRef<[boolean, boolean]>(keylock);
  const deckBRateRef = useRef(1);

  // --- tempo: what is heard, per deck ----------------------------------------------------------
  const globalRate = playerController.getPlaybackRate();
  const overrideA = deckA ? bpmOverrides[deckA.id] : undefined;
  const overrideB = deckB ? bpmOverrides[deckB.id] : undefined;
  const bpmA = resolveBpm(waveformA.bpm, overrideA);
  const bpmB = resolveBpm(waveformB.bpm, overrideB);
  const pctA = deckA ? (tempoByTrack[deckA.id] ?? 0) : 0;
  const pctB = deckB ? (tempoByTrack[deckB.id] ?? 0) : 0;
  const heardA = bpmA === null ? null : heardBpm(bpmA, pctA, globalRate);
  const heardB = bpmB === null ? null : heardBpm(bpmB, pctB, globalRate);
  const deckBRate = globalRate * tempoRatio(pctB);

  // Written in an effect, never during render: a ref assigned in the render body can be read one
  // render stale by a callback (output reset, deck load) that fires between the two.
  useEffect(() => {
    temposRef.current = [tempoRatio(pctA), tempoRatio(pctB)];
  });

  useEffect(() => {
    keylockRef.current = keylock;
  });

  // The single path that sends the faders and the keylock switches to the engine.
  const reapplyTempos = useCallback(() => {
    void playerController.setDjDeckTempos(temposRef.current[0], temposRef.current[1]).catch((error: unknown) => {
      /*
       * A tempo that cannot be sent is a tempo the DJ believes is applied and is not. Swallowing
       * the rejection leaves the fader looking set while the track plays at its own speed, which
       * is the one failure a DJ cannot see for themselves.
       */
      logInternalError("useDjTempo could not set the deck tempos", error);
    });
    void playerController.setDjDeckKeylock(keylockRef.current[0], keylockRef.current[1]).catch((error: unknown) => {
      logInternalError("useDjTempo could not set the deck keylock", error);
    });
  }, [playerController]);

  // Tell the engine on every change that can matter. Also when a deck starts playing: that is
  // when a track that was loaded since the last send has just come up at its own speed.
  useEffect(() => {
    reapplyTempos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pctA, pctB, keylock, deckA?.id, deckB?.id, deckAPlaying, deckBPlaying, reapplyTempos]);

  // The engine resets a deck's tempo when a track loads onto it, and the fader here is remembered
  // per track, so a track that is no longer on a deck must not keep a stale position: loading it
  // again would show the fader somewhere the engine is not.
  useEffect(() => {
    setTempoByTrack((current) => {
      let changed = false;
      const next: Record<string, number> = {};
      for (const [id, percent] of Object.entries(current)) {
        if (id === deckA?.id || id === deckB?.id) next[id] = percent;
        else changed = true;
      }
      return changed ? next : current;
    });
  }, [deckA?.id, deckB?.id]);

  const startedAtFor = useCallback((position: number) => Date.now() - (position * 1000) / deckBRateRef.current, []);

  // A tempo change must not move Deck B's playhead: what has played so far was played at the old
  // rate, so the clock's start is shifted to make the same position come out at the new one.
  useEffect(() => {
    const previous = deckBRateRef.current;
    if (previous === deckBRate) return;
    deckBRateRef.current = deckBRate;
    setDeckBStartedAt((started) =>
      started === null ? null : Date.now() - ((Date.now() - started) * previous) / deckBRate,
    );
  }, [deckBRate, setDeckBStartedAt]);

  useEffect(() => {
    try {
      window.localStorage.setItem(BPM_OVERRIDES_KEY, serializeBpmOverrides(bpmOverrides));
    } catch {
      // Private mode or a full quota: the overrides just do not outlive the session.
    }
  }, [bpmOverrides]);

  useEffect(() => {
    try {
      window.localStorage.setItem(KEYLOCK_STORAGE_KEY, serializeKeylock(keylock));
    } catch {
      // Private mode: the switch just does not outlive the session.
    }
  }, [keylock]);

  useEffect(() => () => {
    window.clearTimeout(noticeTimers.current.A);
    window.clearTimeout(noticeTimers.current.B);
  }, []);

  const flashNotice = (side: "A" | "B", text: string) => {
    setTempoNotice((current) => ({ ...current, [side]: text }));
    window.clearTimeout(noticeTimers.current[side]);
    noticeTimers.current[side] = window.setTimeout(
      () => setTempoNotice((current) => ({ ...current, [side]: null })),
      3500,
    );
  };

  const setTempoPercent = (side: "A" | "B", percent: number) => {
    const track = side === "A" ? deckA : deckB;
    if (!track) return;
    const clamped = clampPercent(percent, tempoRange);
    setTempoByTrack((current) => ({ ...current, [track.id]: clamped }));
  };

  const toggleKeylock = (side: "A" | "B") => {
    setKeylock((current) => {
      const next: [boolean, boolean] = [current[0], current[1]];
      next[side === "A" ? 0 : 1] = !next[side === "A" ? 0 : 1];
      return next;
    });
  };

  const changeTempoRange = (range: TempoRange) => {
    setTempoRange(range);
    setTempoByTrack((current) =>
      Object.fromEntries(Object.entries(current).map(([id, percent]) => [id, clampPercent(percent, range)])),
    );
  };

  const setBpmOverride = (trackId: string, bpm: number | null) => {
    setBpmOverrides((current) => {
      // Re-inserted at the end so insertion order stays recency, which is what the saved list keeps.
      const { [trackId]: _removed, ...rest } = current;
      return bpm === null ? rest : { ...rest, [trackId]: Math.round(bpm * 100) / 100 };
    });
  };

  const syncDeck = (side: "A" | "B") => {
    const track = side === "A" ? deckA : deckB;
    const own = side === "A" ? bpmA : bpmB;
    const target = side === "A" ? heardB : heardA;
    const other = side === "A" ? "B" : "A";
    if (!track || own === null || target === null) return;
    let range: TempoRange = tempoRange;
    let result = syncPercent(own, target, range, globalRate);
    if (result && !result.inRange) {
      // Widen to the narrowest range that reaches it, rather than stopping short and leaving the
      // decks audibly apart. Never narrows: that is for the person to do.
      const widest = TEMPO_RANGES[TEMPO_RANGES.length - 1];
      const wide = syncPercent(own, target, widest, globalRate);
      if (wide?.inRange) {
        range = TEMPO_RANGES.find((candidate) => candidate >= Math.abs(wide.percent)) ?? widest;
        setTempoRange(range);
        result = syncPercent(own, target, range, globalRate);
      }
    }
    if (!result) return;
    const percent = result.percent;
    setTempoByTrack((current) => ({ ...current, [track.id]: percent }));
    flashNotice(
      side,
      !result.inRange
        ? `Out of range — nearest is ${formatPercent(percent)}`
        : result.multiple === 1
          ? `Synced to Deck ${other}`
          : `Synced to Deck ${other} at ${result.multiple === 2 ? "double" : "half"} time`,
    );
  };

  const tapDeck = (side: "A" | "B") => {
    const track = side === "A" ? deckA : deckB;
    if (!track) return;
    const { taps, bpm } = registerTap(tapsRef.current[side], performance.now());
    tapsRef.current[side] = taps;
    if (bpm === null) {
      if (taps.length === 1) flashNotice(side, "Keep tapping along with the beat…");
      return;
    }
    // Taps follow what is heard, which includes the fader; the track's own BPM is what is stored.
    const percent = side === "A" ? pctA : pctB;
    setBpmOverride(track.id, bpm / (globalRate * tempoRatio(percent)));
  };

  const tempoView = (side: "A" | "B"): DeckTempoView => {
    const isA = side === "A";
    const analysis = isA ? waveformA : waveformB;
    const own = isA ? bpmA : bpmB;
    const otherHeard = isA ? heardB : heardA;
    return {
      bpm: own,
      confidence: analysis.bpmConfidence,
      analysing: analysis.status === "loading",
      overridden: (isA ? overrideA : overrideB) !== undefined,
      percent: isA ? pctA : pctB,
      range: tempoRange,
      globalRate,
      canSync: own !== null && otherHeard !== null,
      keylock: isA ? keylock[0] : keylock[1],
      notice: tempoNotice[side],
    };
  };

  const tempoActions = (side: "A" | "B"): DeckTempoActions => {
    const track = side === "A" ? deckA : deckB;
    const own = side === "A" ? bpmA : bpmB;
    return {
      onPercent: (percent) => setTempoPercent(side, percent),
      onRange: changeTempoRange,
      onSync: () => syncDeck(side),
      onKeylock: () => toggleKeylock(side),
      onTap: () => tapDeck(side),
      onHalve: () => {
        if (track && own !== null) setBpmOverride(track.id, halveBpm(own));
      },
      onDouble: () => {
        if (track && own !== null) setBpmOverride(track.id, doubleBpm(own));
      },
      onClearBpm: () => {
        if (track) setBpmOverride(track.id, null);
      },
    };
  };

  /**
   * The beat grid drawn on a deck's waveform, or null when there is nothing to anchor it to.
   * Like Mixxx's stored beat grid (src/analyzer/analyzerbeats.cpp), the anchor is the first beat
   * the measurement found and the spacing is the BPM in use — measured, or set by hand (tap /
   * ½ / ×2) — so the grid stays drawn after an override instead of vanishing, and the ½ / ×2
   * overrides land exactly on the measured grid's phase.
   */
  const gridFor = (analysis: DeckAnalysis, inUse: number | null): DeckGrid | null => {
    if (analysis.bpm === null || inUse === null || analysis.durationSec <= 0) return null;
    return { firstBeatSec: analysis.firstBeatSec, bpm: inUse, durationSec: analysis.durationSec };
  };

  return {
    waveformA,
    waveformB,
    bpmA,
    bpmB,
    heardA,
    heardB,
    deckBRateRef,
    tempoView,
    tempoActions,
    gridFor,
    startedAtFor,
    reapplyTempos,
  };
}
