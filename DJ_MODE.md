# Zuno DJ Mode

This branch adds a first DJ workstation layer to Zuno.

## Included

- DJ Mode button in the title bar.
- Two-deck DJ layout with artwork and a vertical waveform strip at the far end of each deck — the two strips sit side by side in the middle — plus transport, cue controls and hot-cue buttons.
- Deck B queue selection from the active Zuno queue.
- Native Rust standby-deck cueing through the existing two-deck audio engine.
- Real native crossfade when `MIX A → B` is pressed.
- Adjustable transition length.
- Position seeking and hot-cue storage on Deck A.
- Per-deck tempo system modeled on Mixxx (`src/analyzer/`): analyzed BPM with confidence, beat grid drawn on the waveform, tap / ½ / ×2 / clear BPM overrides (persisted in localStorage), ±8/16/50% tempo fader per deck, and SYNC between decks — all owned by `src/ui/pages/useDjTempo.ts`.
- Per-deck keylock (the `KEY` button on each tempo panel, on by default like Mixxx, persisted in localStorage as `zuno.dj.keylock`): with keylock on, the tempo fader time-stretches the track and the pitch stays put; with it off, the fader resamples and the pitch moves with speed, like a turntable. The stretch is a hand-rolled pure-Rust WSOLA in `src-tauri/src/keylock.rs`, inserted between the decoder and rodio's speed stage (`decoder → Counted → Keylock → Speed`), so position reporting and seeking keep working in track time. Only the Rust engine supports keylock; on the YouTube iframe / `<audio>` engines the fader always changes pitch (playbackRate resamples), so `KEY` is a no-op there.
- Crossfader gain curve ported verbatim from Mixxx (`xfadeGains()`).
- Vertical waveform strip at the far end of each deck (`DeckWaveform` in `src/ui/pages/DJMode.tsx`), so the two strips stand beside each other in the middle: time runs top to bottom, peaks mirrored around the centre line. Each element has its own colour — played part in the theme primary, unplayed part muted, Mixxx-style beat grid in blue (thin line per beat, heavy every fourth beat / bar), amber hot-cue triangles, white playhead with a primary halo; click/drag to seek. Zoom is one value shared by both decks (buttons under the strip, scroll or two-finger pinch on the strip, double-click to fit; persisted in localStorage as `zuno.dj.waveformZoom`) — above 1× the visible window follows the playhead. While zoomed in, the strip redraws every animation frame from the engine's live clock, extrapolated between the engine's 250 ms position pushes (the 100 ms display clock only drives the zoomed-out view), so it scrolls smoothly even at full zoom.

## Important

The real audio transition is powered by Zuno's existing Rust two-deck engine. For the full DJ feature set, the app should use the Rust/native audio engine. If Zuno is running its YouTube iframe engine, the mix action falls back to normal track playback.

Waveform peaks, BPM, confidence and a first-beat anchor are measured once per track by a single native Rust decode (`native_audio_waveform` → `src-tauri/src/tempo.rs`) and then reused for the readout and the grid; the beat grid is drawn at the BPM actually in use (after tap/½/×2 overrides and the tempo fader). Local files and downloads decode from disk; streaming tracks decode from the buffer their own playback fills; shemen tracks resolve through a `media` source reference back to the media server's in-process buffer, so they analyse and cue on a deck like any other source. Remaining gaps: true per-deck EQ/filter routing, loops, beat jump and MIDI control. (Pitch/time-stretching is the keylock feature above, Rust engine only.)
