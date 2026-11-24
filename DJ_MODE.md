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
- Crossfader gain curve ported verbatim from Mixxx (`xfadeGains()`).
- Vertical waveform strip at the far end of each deck (`DeckWaveform` in `src/ui/pages/DJMode.tsx`), so the two strips stand beside each other in the middle: time runs top to bottom, peaks mirrored around the centre line. Each element has its own colour — played part in the theme primary, unplayed part muted, Mixxx-style beat grid in blue (thin line per beat, heavy every fourth beat / bar), amber hot-cue triangles, white playhead with a primary halo; click/drag to seek. Zoom is one value shared by both decks (buttons under the strip, scroll or two-finger pinch on the strip, double-click to fit; persisted in localStorage as `zuno.dj.waveformZoom`) — above 1× the visible window follows the playhead.

## Important

The real audio transition is powered by Zuno's existing Rust two-deck engine. For the full DJ feature set, the app should use the Rust/native audio engine. If Zuno is running its YouTube iframe engine, the mix action falls back to normal track playback.

Waveform peaks, BPM, confidence and a first-beat anchor are measured once per track by a single native Rust decode (`native_audio_waveform` → `src-tauri/src/tempo.rs`) and then reused for the readout and the grid; the beat grid is drawn at the BPM actually in use (after tap/½/×2 overrides and the tempo fader). Remaining gaps: true per-deck EQ/filter routing, pitch/time-stretching, loops, beat jump and MIDI control.
